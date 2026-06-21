/**
 * Provider-agnostic AR Reconciliation.
 *
 * GET /api/reports/reconcile[?asOf=YYYY-MM-DD]
 *
 * Confirms the receivables we DISPLAY are reproduced from the data points we
 * captured, and reconciles them to the provider's own books.
 *
 * Two figures:
 *   • Our AR (synced)  — sum of each provider's authoritative per-invoice open
 *     balance (qboBalance / xeroBalance / sageIntacctBalance). This is exactly
 *     what the dashboard and AR reports display. Each balance is a captured
 *     data point that already encodes every payment and credit the provider
 *     applied — so we don't need to re-derive it from individual transactions
 *     (which incremental sync doesn't fully retain for historical periods).
 *
 *   • Provider report total — fetched live from the provider's own aged-
 *     receivables report (QuickBooks AgedReceivableDetail). One call, used only
 *     as an independent check that our synced balances still tie to the source.
 *     Available for QuickBooks; Xero/Sage tenants reconcile against their synced
 *     authoritative balances (the per-invoice figure those providers give us).
 *
 * Read-only. For a per-customer live check against QBO Customer.Balance, use
 * /api/qbo/reconcile-customers (the "deep-check").
 */

import { db } from "@/db";
import {
  customers, invoices,
  qboTokens, xeroTokens, sageIntacctCredentials,
} from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, lte } from "drizzle-orm";
import { fetchQboAging } from "@/lib/qbo-aging-report";

export const maxDuration = 60;

type RowOut = {
  customerId:   string;
  customerName: string;
  customerCode: string;
  currency:     string;
  syncedAR:     number;   // provider's authoritative open balance, summed
};

/** Provider's authoritative per-invoice open balance (whichever is populated).
 *  CMs/credits carry a negative balance; falls back to total − paid for
 *  local-only rows. */
function providerBalanceOf(inv: {
  qboBalance: number | null;
  xeroBalance: number | null;
  sageIntacctBalance: number | null;
  total: number;
  paid: number;
}): number {
  if (inv.qboBalance != null) return inv.qboBalance;
  if (inv.xeroBalance != null) return inv.xeroBalance;
  if (inv.sageIntacctBalance != null) return inv.sageIntacctBalance;
  return Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));
}

async function detectProviders(orgId: string): Promise<{ qbo: boolean; xero: boolean; sage: boolean }> {
  const [qbo, xero, sage] = await Promise.all([
    db.select({ x: qboTokens.realmId }).from(qboTokens).where(eq(qboTokens.orgId, orgId)).limit(1),
    db.select({ x: xeroTokens.tenantId }).from(xeroTokens).where(eq(xeroTokens.orgId, orgId)).limit(1),
    db.select({ x: sageIntacctCredentials.orgId }).from(sageIntacctCredentials).where(eq(sageIntacctCredentials.orgId, orgId)).limit(1),
  ]);
  return { qbo: !!qbo.length, xero: !!xero.length, sage: !!sage.length };
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const asOf = url.searchParams.get("asOf") || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return bad("asOf must be YYYY-MM-DD");

  // ── Our synced AR (what we display), per customer ──────────────────────────
  const invs = await db.select({
    customerId:         invoices.customerId,
    total:              invoices.total,
    paid:               invoices.paid,
    paymentStatus:      invoices.paymentStatus,
    qboBalance:         invoices.qboBalance,
    xeroBalance:        invoices.xeroBalance,
    sageIntacctBalance: invoices.sageIntacctBalance,
  }).from(invoices).where(and(eq(invoices.orgId, orgId!), lte(invoices.invoiceDate, asOf)));

  const syncedByCustomer = new Map<string, number>();
  for (const inv of invs) {
    if (inv.paymentStatus === "Written Off") continue;
    const bal = providerBalanceOf(inv);
    if (Math.abs(bal) < 0.005) continue;
    syncedByCustomer.set(inv.customerId, (syncedByCustomer.get(inv.customerId) ?? 0) + bal);
  }

  const custs = await db.select({
    id: customers.id, name: customers.name, code: customers.code, currency: customers.currency,
  }).from(customers).where(eq(customers.orgId, orgId!));
  const custById = new Map(custs.map(c => [c.id, c]));

  const rows: RowOut[] = [];
  for (const [cid, syncedAR] of syncedByCustomer) {
    if (Math.abs(syncedAR) < 0.005) continue;
    const c = custById.get(cid);
    rows.push({
      customerId:   cid,
      customerName: c?.name ?? "(unmapped customer)",
      customerCode: c?.code ?? "",
      currency:     c?.currency ?? "EUR",
      syncedAR,
    });
  }
  const syncedTotal = rows.reduce((s, r) => s + r.syncedAR, 0);

  // ── Independent provider check (QBO live report total) ─────────────────────
  const providers = await detectProviders(orgId!);
  let providerReportTotal: number | null = null;
  let providerReportSource: string | null = null;
  let providerCheckError: string | null = null;
  if (providers.qbo) {
    try {
      const qbo = await fetchQboAging(orgId!, asOf);
      providerReportTotal = qbo.grandTotals.total;
      providerReportSource = "QuickBooks AgedReceivableDetail";
    } catch (e: any) {
      providerCheckError = e?.message || String(e);
    }
  }

  const variance = providerReportTotal != null ? syncedTotal - providerReportTotal : null;

  const providerNames = [
    providers.qbo && "QuickBooks",
    providers.xero && "Xero",
    providers.sage && "Sage Intacct",
  ].filter(Boolean) as string[];

  return ok({
    asOf,
    providers: providerNames,
    syncedTotal,
    providerReportTotal,
    providerReportSource,
    providerCheckError,
    variance,
    reconciled: variance == null ? null : Math.abs(variance) < Math.max(1, syncedTotal * 0.005),
    rows: rows.sort((a, b) => Math.abs(b.syncedAR) - Math.abs(a.syncedAR)),
  });
}
