/**
 * Unified transactions for a project.
 * Same shape as the customer endpoint, but scoped to a single project.
 *
 * - Invoices/CMs: filtered by projects.id directly (invoices.projectId)
 * - Payments: included if any of their applications target an invoice in this project
 * - Refund receipts: not linked to projects in QBO — omitted at project scope
 *
 * GET /api/projects/[id]/transactions
 */

import { db } from "@/db";
import { projects, invoices, payments, paymentApplications } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, inArray } from "drizzle-orm";
import type { CustomerTxn } from "@/app/api/customers/[id]/transactions/route";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [proj] = await db.select({ id: projects.id })
    .from(projects)
    .where(and(eq(projects.id, params.id), eq(projects.orgId, orgId!)))
    .limit(1);
  if (!proj) return bad("Project not found", 404);

  // Invoices + CMs for this project
  const invs = await db.select().from(invoices)
    .where(and(eq(invoices.orgId, orgId!), eq(invoices.projectId, proj.id)));

  // Find payments that applied to any of these invoices
  const invoiceIds = invs.map(i => i.id);
  let projectPayments: typeof payments.$inferSelect[] = [];
  if (invoiceIds.length > 0) {
    const appRows = await db
      .select({ paymentId: paymentApplications.paymentId })
      .from(paymentApplications)
      .where(and(
        eq(paymentApplications.orgId, orgId!),
        inArray(paymentApplications.invoiceId, invoiceIds),
      ));
    const paymentIds = [...new Set(appRows.map(a => a.paymentId))];
    if (paymentIds.length > 0) {
      projectPayments = await db
        .select()
        .from(payments)
        .where(and(eq(payments.orgId, orgId!), inArray(payments.id, paymentIds)));
    }
  }

  const rows: CustomerTxn[] = [];

  for (const inv of invs) {
    const isCm = inv.txnType === "CreditMemo";
    rows.push({
      id: `inv-${inv.id}`,
      refId: inv.id,
      txnDate: inv.invoiceDate,
      type: isCm ? "Credit Memo" : "Invoice",
      number: inv.invoiceNumber,
      amount: isCm ? -Math.abs(inv.total) : inv.total,
      currency: inv.currency,
      status: inv.paymentStatus === "Paid" ? "Paid"
            : inv.collectionStage === "Closed" ? "Closed"
            : inv.paymentStatus,
      memo: inv.notes,
      meta: {
        dueDate: inv.dueDate,
        paid: inv.paid,
        balance: inv.qboBalance ?? Math.max(0, inv.total - (inv.paid || 0)),
        collectionStage: inv.collectionStage,
      },
    });
  }

  for (const p of projectPayments) {
    rows.push({
      id: `pay-${p.id}`,
      refId: p.id,
      txnDate: p.txnDate,
      type: "Payment",
      number: p.paymentRef,
      amount: -p.totalAmount,
      currency: p.currency,
      status: p.unappliedAmount > 0.005 ? "Partially Applied" : "Applied",
      memo: p.privateNote,
      meta: {
        method: p.paymentMethod,
        depositAccount: p.depositAccountName,
        unapplied: p.unappliedAmount,
      },
    });
  }

  rows.sort((a, b) => (a.txnDate < b.txnDate ? 1 : a.txnDate > b.txnDate ? -1 : 0));

  return ok({
    rows,
    counts: {
      total: rows.length,
      Invoice: rows.filter(r => r.type === "Invoice").length,
      "Credit Memo": rows.filter(r => r.type === "Credit Memo").length,
      Payment: rows.filter(r => r.type === "Payment").length,
      "Refund Receipt": 0,
    },
  });
}
