/**
 * AR Snapshot at any historical date.
 *
 * GET /api/reports/ar-snapshot?asOf=YYYY-MM-DD
 *
 * For each invoice + credit memo in the org, projects what its balance was
 * on the given date by walking payment_applications and including only those
 * applied via payments that had `txn_date <= asOf`.
 *
 * Returns an array shaped exactly like rows from the invoices table, with
 * `paid`, `qboBalance`, `paymentStatus`, `paidAt` recomputed for that date.
 * The existing AgingByCustomer / AgingByProject / AgingByRep / RegionalReport
 * components consume this directly — no client changes needed.
 *
 * Limitations (acceptable for v1):
 *   - Direct credit-memo applications (QBO LinkedTxn on the CM itself,
 *     without a Payment intermediary) aren't yet captured in the data layer.
 *     CMs are projected using their current balance only — this means CM
 *     unapplied amounts in historical views are approximate. Will be tightened
 *     when CM->Invoice direct applications are added in Phase 2.
 *   - Journal Entries hitting AR aren't yet captured (Phase 3 work).
 */

import { db } from "@/db";
import { invoices, payments, paymentApplications } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, lte } from "drizzle-orm";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const asOf = url.searchParams.get("asOf");
  if (!asOf || !/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    return bad("asOf=YYYY-MM-DD required");
  }

  // Load all invoices + CMs that existed by asOf
  const allInvs = await db.select().from(invoices)
    .where(and(eq(invoices.orgId, orgId!), lte(invoices.invoiceDate, asOf)));

  if (allInvs.length === 0) return ok([]);

  // Load all payments dated on or before asOf, with their applications
  const validPayments = await db
    .select({ id: payments.id, txnDate: payments.txnDate })
    .from(payments)
    .where(and(eq(payments.orgId, orgId!), lte(payments.txnDate, asOf)));

  if (validPayments.length === 0) {
    // No payments by asOf → every invoice still has its full balance
    return ok(allInvs.map(inv => projectInvoice(inv, 0, null)));
  }

  const validPaymentIds = new Set(validPayments.map(p => p.id));
  const paymentDateById = new Map(validPayments.map(p => [p.id, p.txnDate]));

  // Load applications for these payments
  const allApps = await db
    .select()
    .from(paymentApplications)
    .where(eq(paymentApplications.orgId, orgId!));

  // Filter to applications where the payment is dated <= asOf
  // and group by invoiceId
  type AppForInv = { amountApplied: number; paymentDate: string };
  const appsByInvoiceId = new Map<string, AppForInv[]>();
  for (const app of allApps) {
    if (!app.invoiceId) continue;
    if (!validPaymentIds.has(app.paymentId)) continue;
    const paymentDate = paymentDateById.get(app.paymentId);
    if (!paymentDate) continue;
    const arr = appsByInvoiceId.get(app.invoiceId) || [];
    arr.push({ amountApplied: app.amountApplied, paymentDate });
    appsByInvoiceId.set(app.invoiceId, arr);
  }

  // Project each invoice's state at asOf
  const projected = allInvs.map(inv => {
    const apps = appsByInvoiceId.get(inv.id) || [];
    const totalApplied = apps.reduce((s, a) => s + a.amountApplied, 0);
    // Date of the LAST payment that closed the invoice (if fully paid)
    const isFullyPaid = totalApplied >= inv.total - 0.005;
    const paidAt = isFullyPaid && apps.length > 0
      ? apps.reduce((latest, a) => (a.paymentDate > latest ? a.paymentDate : latest), apps[0].paymentDate)
      : null;
    return projectInvoice(inv, totalApplied, paidAt);
  });

  return ok(projected);
}

function projectInvoice(inv: any, totalApplied: number, paidAt: string | null) {
  const balance = Math.max(0, inv.total - totalApplied);
  const paid = Math.min(inv.total, totalApplied);
  const paymentStatus =
    balance < 0.005 ? "Paid"
    : paid > 0.005 ? "Partially Paid"
    : "Unpaid";

  return {
    ...inv,
    paid,
    qboBalance: balance,
    paymentStatus,
    paidAt,
    // Collection stage: if fully paid by asOf, treat as Closed; otherwise preserve
    collectionStage: paymentStatus === "Paid" ? "Closed" : inv.collectionStage,
  };
}
