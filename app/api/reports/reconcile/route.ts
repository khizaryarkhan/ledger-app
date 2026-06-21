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
  customers, invoices, payments,
  qboTokens, xeroTokens, sageIntacctCredentials,
} from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, lte } from "drizzle-orm";
import { fetchQboAging } from "@/lib/qbo-aging-report";
import { computeArAging } from "@/lib/ar-aging";

export const maxDuration = 60;

type RowOut = {
  customerId:   string;
  customerName: string;
  customerCode: string;
  currency:     string;
  syncedAR:     number;   // provider's authoritative open balance, summed
};

/** Canonical transaction-type label so the provider's labels and ours line up. */
function normaliseTxnType(raw: string): string {
  const t = raw.toLowerCase();
  if (t.includes("journal")) return "Journal Entry";
  if (t.includes("credit"))  return "Credit Memo";
  if (t.includes("invoice")) return "Invoice";
  if (t.includes("deposit")) return "Deposit";
  if (t.includes("refund"))  return "Refund Receipt";
  if (t.includes("payment")) return "Unapplied Payment";
  return raw || "Other";
}

type TypeAgg = { providerCount: number; providerAmount: number; ourCount: number; ourAmount: number };
function emptyTypeAgg(): TypeAgg { return { providerCount: 0, providerAmount: 0, ourCount: 0, ourAmount: 0 }; }

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
    txnType:            invoices.txnType,
    qboBalance:         invoices.qboBalance,
    xeroBalance:        invoices.xeroBalance,
    sageIntacctBalance: invoices.sageIntacctBalance,
  }).from(invoices).where(and(eq(invoices.orgId, orgId!), lte(invoices.invoiceDate, asOf)));

  // ── Our open AR contribution, grouped by transaction type ──────────────────
  const ourByType = new Map<string, TypeAgg>();
  const addOur = (type: string, amount: number) => {
    const k = normaliseTxnType(type);
    const a = ourByType.get(k) ?? emptyTypeAgg();
    a.ourCount += 1; a.ourAmount += amount;
    ourByType.set(k, a);
  };

  const syncedByCustomer = new Map<string, number>();
  for (const inv of invs) {
    if (inv.paymentStatus === "Written Off") continue;
    const bal = providerBalanceOf(inv);
    if (Math.abs(bal) < 0.005) continue;
    syncedByCustomer.set(inv.customerId, (syncedByCustomer.get(inv.customerId) ?? 0) + bal);
    addOur(inv.txnType === "CreditMemo" ? "Credit Memo" : "Invoice", bal);
  }

  // Journal Entries & AR-account Deposits: use the engine's NET-OPEN figure
  // (gross JE/deposit lines netted by the applications/payments against them),
  // NOT the raw table sum — otherwise we'd compare every historical AR-JE line
  // against QBO's single net-open position. The engine maps AR-debit deposits
  // to "Journal Entry" too, and nets negative deposit credits into the customer
  // summary, mirroring QBO's aged report.
  let engine: Awaited<ReturnType<typeof computeArAging>> | null = null;
  try {
    engine = await computeArAging(orgId!, asOf);
    for (const d of engine.detail) {
      if (d.txnType !== "Journal Entry") continue;       // invoices/CMs come from the synced balances above
      if (Math.abs(d.openBalance) < 0.005) continue;
      addOur("Journal Entry", d.openBalance);
    }
  } catch { /* engine failure shouldn't break the reconciliation */ }

  // Unapplied payments are deducted in the engine summary (not detail), so read
  // them straight from the payments table.
  const payRows = await db.select({ unappliedAmount: payments.unappliedAmount })
    .from(payments).where(eq(payments.orgId, orgId!));
  for (const p of payRows) { if ((p.unappliedAmount ?? 0) >= 0.005) addOur("Unapplied Payment", -(p.unappliedAmount ?? 0)); }

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

  // ── Independent provider check (QBO live report total + by-type) ───────────
  const providers = await detectProviders(orgId!);
  let providerReportTotal: number | null = null;
  let providerReportSource: string | null = null;
  let providerCheckError: string | null = null;
  const providerByType = new Map<string, TypeAgg>();
  let providerDiag: any = null;
  if (providers.qbo) {
    try {
      const qbo = await fetchQboAging(orgId!, asOf);
      providerReportTotal = qbo.grandTotals.total;
      providerReportSource = "QuickBooks AgedReceivableDetail";
      // Group the provider's open AR rows by QBO's raw transaction type
      // (stashed as a `qbotype:` flag on each detail row).
      for (const d of qbo.detail) {
        if (Math.abs(d.openBalance) < 0.005) continue;
        const rawFlag = d.flags.find(f => f.startsWith("qbotype:"));
        const raw = rawFlag ? rawFlag.slice("qbotype:".length) : (d.txnType || "Other");
        const k = normaliseTxnType(raw);
        const a = providerByType.get(k) ?? emptyTypeAgg();
        a.providerCount += 1; a.providerAmount += d.openBalance;
        providerByType.set(k, a);
      }
      // ── Diagnostic: does the detail tie to QBO's own grand total? ───────────
      // If the sum of parsed detail rows ≠ QBO's grand-total row, our parser is
      // misreading the report (e.g. picking up a subtotal/section line as a
      // transaction). Surface that so a phantom row can't masquerade as a gap.
      const detailSum = qbo.detail.reduce((s, d) => s + d.openBalance, 0);
      const nameFromFlags = (flags: string[]) => {
        const f = flags.find(x => x.startsWith("qbo-name:"));
        return f ? f.slice("qbo-name:".length) : null;
      };
      const bigRows = qbo.detail
        .filter(d => Math.abs(d.openBalance) >= 0.005)
        .map(d => ({
          type: d.txnType,
          rawType: (d.flags.find(f => f.startsWith("qbotype:")) || "qbotype:").slice("qbotype:".length),
          num: d.txnNumber,
          date: d.txnDate,
          dueDate: d.dueDate,
          amount: d.openBalance,
          customer: custById.get(d.customerId)?.name ?? nameFromFlags(d.flags) ?? d.customerQboId ?? "—",
        }))
        .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
        .slice(0, 40);
      providerDiag = {
        grandTotal: providerReportTotal,
        detailSum,
        detailCount: qbo.detail.length,
        tiesOut: Math.abs(detailSum - (providerReportTotal ?? detailSum)) < Math.max(1, Math.abs(providerReportTotal ?? 0) * 0.005),
        // Every Journal Entry row QBO returned — so we can see if the big JE is real.
        journalEntries: qbo.detail
          .filter(d => d.txnType === "Journal Entry" && Math.abs(d.openBalance) >= 0.005)
          .map(d => ({
            num: d.txnNumber, date: d.txnDate, amount: d.openBalance,
            customer: custById.get(d.customerId)?.name ?? nameFromFlags(d.flags) ?? d.customerQboId ?? "—",
          })),
        topRows: bigRows,
      };
    } catch (e: any) {
      providerCheckError = e?.message || String(e);
    }
  }

  // ── Merge into a single by-transaction-type gap table ──────────────────────
  const allTypes = new Set<string>([...ourByType.keys(), ...providerByType.keys()]);
  const byType = [...allTypes].map(type => {
    const ours = ourByType.get(type) ?? emptyTypeAgg();
    const prov = providerByType.get(type) ?? emptyTypeAgg();
    const providerAmount = prov.providerAmount;
    const ourAmount = ours.ourAmount;
    return {
      type,
      providerCount: prov.providerCount,
      providerAmount,
      ourCount: ours.ourCount,
      ourAmount,
      // gap = what the provider shows minus what we carry for this type.
      gap: providerAmount - ourAmount,
      // QBO's aged report doesn't surface every type (e.g. deposits/refunds it
      // nets silently); flag types we have but the provider report never listed.
      providerListsType: providerByType.has(type),
    };
  }).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

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
    byType,
    providerDiag,
    rows: rows.sort((a, b) => Math.abs(b.syncedAR) - Math.abs(a.syncedAR)),
  });
}
