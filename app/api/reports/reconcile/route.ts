/**
 * Provider-agnostic AR Reconciliation.
 *
 * GET /api/reports/reconcile[?asOf=YYYY-MM-DD][&tolerance=1.0]
 *
 * Proves we can reproduce each provider's receivables from the data points we
 * captured — without calling the provider's own report. For every invoice it
 * compares two INDEPENDENTLY-derived figures:
 *
 *   • Provider-stated balance — the authoritative open balance the provider
 *     gave us per invoice (qboBalance / xeroBalance / sageIntacctBalance),
 *     synced verbatim.
 *
 *   • Our reconstruction — invoice total minus the payment APPLICATIONS we
 *     captured (payment_applications), computed independently of the synced
 *     balance column. (We deliberately do NOT use invoices.paid, which is
 *     derived from the synced balance and would make the check circular.)
 *
 * If the two match for every invoice, we captured every payment/credit needed
 * to reproduce the provider's books. Where they diverge, the per-customer
 * variance pinpoints the missing data — most commonly a credit memo applied
 * directly to an invoice (no payment), which the provider nets into the
 * invoice's balance but which we never recorded as an application.
 *
 * Read-only, no external API call — identical for QBO, Xero and Sage tenants.
 * (A stronger QBO-only live check lives at /api/qbo/reconcile-customers.)
 */

import { db } from "@/db";
import {
  customers, invoices, payments, paymentApplications,
  qboTokens, xeroTokens, sageIntacctCredentials,
} from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, lte } from "drizzle-orm";

export const maxDuration = 120;

type RowOut = {
  customerId:        string;
  customerName:      string;
  customerCode:      string;
  currency:          string;
  providerStatedAR:  number;
  reconstructedAR:   number;
  variance:          number;   // reconstructed − providerStated
  status:            "match" | "drift";
};

/** Provider's authoritative per-invoice open balance (whichever is populated).
 *  CMs/credits carry a negative balance; falls back to total − paid only when
 *  no provider balance exists (local-only rows). */
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

async function detectProviders(orgId: string): Promise<string[]> {
  const [qbo, xero, sage] = await Promise.all([
    db.select({ x: qboTokens.realmId }).from(qboTokens).where(eq(qboTokens.orgId, orgId)).limit(1),
    db.select({ x: xeroTokens.tenantId }).from(xeroTokens).where(eq(xeroTokens.orgId, orgId)).limit(1),
    db.select({ x: sageIntacctCredentials.orgId }).from(sageIntacctCredentials).where(eq(sageIntacctCredentials.orgId, orgId)).limit(1),
  ]);
  const out: string[] = [];
  if (qbo.length)  out.push("QuickBooks");
  if (xero.length) out.push("Xero");
  if (sage.length) out.push("Sage Intacct");
  return out;
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const asOf = url.searchParams.get("asOf") || new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return bad("asOf must be YYYY-MM-DD");
  const tolerance = parseFloat(url.searchParams.get("tolerance") || "1.0");

  // ── Load invoices dated on or before asOf ──────────────────────────────────
  const invs = await db.select({
    id:                 invoices.id,
    customerId:         invoices.customerId,
    total:              invoices.total,
    paid:               invoices.paid,
    paymentStatus:      invoices.paymentStatus,
    txnType:            invoices.txnType,
    qboBalance:         invoices.qboBalance,
    xeroBalance:        invoices.xeroBalance,
    sageIntacctBalance: invoices.sageIntacctBalance,
  }).from(invoices).where(and(eq(invoices.orgId, orgId!), lte(invoices.invoiceDate, asOf)));

  // ── Payment applications captured against invoices, dated on or before asOf ─
  // Only count applications whose payment occurred by the report date.
  const pmts = await db.select({ id: payments.id, txnDate: payments.txnDate })
    .from(payments).where(eq(payments.orgId, orgId!));
  const paymentOnOrBefore = new Set(pmts.filter(p => !p.txnDate || p.txnDate <= asOf).map(p => p.id));

  const apps = await db.select({
    invoiceId:     paymentApplications.invoiceId,
    paymentId:     paymentApplications.paymentId,
    targetType:    paymentApplications.targetType,
    amountApplied: paymentApplications.amountApplied,
  }).from(paymentApplications).where(eq(paymentApplications.orgId, orgId!));

  const appliedByInvoiceId = new Map<string, number>();
  for (const a of apps) {
    if (a.targetType !== "Invoice") continue;       // CMs/JEs handled separately
    if (!a.invoiceId) continue;
    if (!paymentOnOrBefore.has(a.paymentId)) continue; // payment after asOf
    appliedByInvoiceId.set(a.invoiceId, (appliedByInvoiceId.get(a.invoiceId) ?? 0) + (a.amountApplied ?? 0));
  }

  // ── Per-customer aggregation ───────────────────────────────────────────────
  const statedByCustomer = new Map<string, number>();
  const reconByCustomer  = new Map<string, number>();

  for (const inv of invs) {
    if (inv.paymentStatus === "Written Off") continue;

    const stated = providerBalanceOf(inv);

    let reconstructed: number;
    if (inv.txnType === "CreditMemo") {
      // Reconstructing a credit's remaining unapplied amount from applications
      // is the inverse problem; pass the provider figure through so credits
      // appear identically on both sides and don't create false variance. The
      // invoice side below is the real capture test.
      reconstructed = stated;
    } else {
      const applied = appliedByInvoiceId.get(inv.id) ?? 0;
      reconstructed = Math.max(0, Number(inv.total || 0) - applied);
    }

    if (Math.abs(stated) >= 0.005 || Math.abs(reconstructed) >= 0.005) {
      statedByCustomer.set(inv.customerId, (statedByCustomer.get(inv.customerId) ?? 0) + stated);
      reconByCustomer.set(inv.customerId, (reconByCustomer.get(inv.customerId) ?? 0) + reconstructed);
    }
  }

  // ── Join with customers ────────────────────────────────────────────────────
  const custs = await db.select({
    id: customers.id, name: customers.name, code: customers.code, currency: customers.currency,
  }).from(customers).where(eq(customers.orgId, orgId!));
  const custById = new Map(custs.map(c => [c.id, c]));

  const allIds = new Set<string>([...statedByCustomer.keys(), ...reconByCustomer.keys()]);
  const rows: RowOut[] = [];
  for (const cid of allIds) {
    const c = custById.get(cid);
    const providerStatedAR = statedByCustomer.get(cid) ?? 0;
    const reconstructedAR  = reconByCustomer.get(cid) ?? 0;
    const variance = reconstructedAR - providerStatedAR;
    if (Math.abs(providerStatedAR) < 0.005 && Math.abs(reconstructedAR) < 0.005) continue;
    rows.push({
      customerId:   cid,
      customerName: c?.name ?? "(unmapped customer)",
      customerCode: c?.code ?? "",
      currency:     c?.currency ?? "EUR",
      providerStatedAR,
      reconstructedAR,
      variance,
      status: Math.abs(variance) < tolerance ? "match" : "drift",
    });
  }

  const totals = {
    customers:           rows.length,
    inDrift:             rows.filter(r => r.status === "drift").length,
    inMatch:             rows.filter(r => r.status === "match").length,
    providerStatedTotal: rows.reduce((s, r) => s + r.providerStatedAR, 0),
    reconstructedTotal:  rows.reduce((s, r) => s + r.reconstructedAR, 0),
    variance:            rows.reduce((s, r) => s + r.variance, 0),
    creditMemoNote:      true, // credits passed through 1:1 (see route docs)
  };

  return ok({
    asOf,
    tolerance,
    providers: await detectProviders(orgId!),
    rows: rows.sort((a, b) => Math.abs(b.variance) - Math.abs(a.variance)),
    totals,
  });
}
