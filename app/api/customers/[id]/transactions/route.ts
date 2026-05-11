/**
 * Unified transactions for a customer.
 * Aggregates every AR-affecting event (invoices, credit memos, payments,
 * refund receipts) into a single chronological feed — modelled on QBO's
 * Customer → Transactions tab.
 *
 * GET /api/customers/[id]/transactions
 */

import { db } from "@/db";
import { customers, invoices, payments, refundReceipts } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, desc } from "drizzle-orm";

export type CustomerTxn = {
  id: string;
  refId: string;          // route param for opening detail (invoice id, etc.)
  txnDate: string;        // YYYY-MM-DD
  type: "Invoice" | "Credit Memo" | "Payment" | "Refund Receipt";
  number: string | null;  // invoice number, payment ref, etc.
  amount: number;         // signed: positive = increases AR, negative = decreases AR
  balance: number;        // open balance (invoice unpaid, CM/payment unapplied) — always >= 0
  currency: string;
  status: string;         // "Paid" | "Partially Paid" | "Unpaid" | "Voided" | "Closed" | ...
  memo: string | null;
  meta?: Record<string, any>;
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  // Verify customer belongs to active org
  const [cust] = await db.select({ id: customers.id, currency: customers.currency })
    .from(customers)
    .where(and(eq(customers.id, params.id), eq(customers.orgId, orgId!)))
    .limit(1);
  if (!cust) return bad("Customer not found", 404);

  // Fetch all four entity types in parallel
  const [invs, pmts, refs] = await Promise.all([
    db.select().from(invoices).where(and(eq(invoices.orgId, orgId!), eq(invoices.customerId, cust.id))),
    db.select().from(payments).where(and(eq(payments.orgId, orgId!), eq(payments.customerId, cust.id))),
    db.select().from(refundReceipts).where(and(eq(refundReceipts.orgId, orgId!), eq(refundReceipts.customerId, cust.id))),
  ]);

  const rows: CustomerTxn[] = [];

  // Invoices + Credit Memos (both live in invoices table, distinguished by txnType)
  for (const inv of invs) {
    const isCm = inv.txnType === "CreditMemo";
    // Open balance:
    //   - Invoice: total - paid (or qbo_balance if QBO reported it)
    //   - Credit Memo: unapplied portion = absolute value of qboBalance
    const balance = isCm
      ? Math.abs(inv.qboBalance ?? inv.total)
      : Math.max(0, inv.qboBalance ?? (inv.total - (inv.paid || 0)));
    rows.push({
      id: `inv-${inv.id}`,
      refId: inv.id,
      txnDate: inv.invoiceDate,
      type: isCm ? "Credit Memo" : "Invoice",
      number: inv.invoiceNumber,
      amount: isCm ? -Math.abs(inv.total) : inv.total,
      balance,
      currency: inv.currency,
      status: inv.paymentStatus === "Paid" ? "Paid"
            : inv.collectionStage === "Closed" ? "Closed"
            : inv.paymentStatus,
      memo: inv.notes,
      meta: {
        dueDate: inv.dueDate,
        paid: inv.paid,
        collectionStage: inv.collectionStage,
      },
    });
  }

  // Payments — balance is the unapplied portion
  for (const p of pmts) {
    rows.push({
      id: `pay-${p.id}`,
      refId: p.id,
      txnDate: p.txnDate,
      type: "Payment",
      number: p.paymentRef,
      amount: -p.totalAmount,
      balance: p.unappliedAmount || 0,
      currency: p.currency,
      status: p.unappliedAmount > 0.005 ? "Partially Applied" : "Applied",
      memo: p.privateNote,
      meta: {
        method: p.paymentMethod,
        depositAccount: p.depositAccountName,
      },
    });
  }

  // Refund Receipts — balance is 0 (already paid out)
  for (const r of refs) {
    rows.push({
      id: `ref-${r.id}`,
      refId: r.id,
      txnDate: r.txnDate,
      type: "Refund Receipt",
      number: null,
      amount: r.totalAmount,
      balance: 0,
      currency: r.currency,
      status: "Closed",
      memo: r.privateNote,
      meta: {
        method: r.paymentMethod,
        fromAccount: r.refundFromAccountName,
      },
    });
  }

  // Chronological — newest first
  rows.sort((a, b) => (a.txnDate < b.txnDate ? 1 : a.txnDate > b.txnDate ? -1 : 0));

  return ok({
    rows,
    counts: {
      total: rows.length,
      Invoice: rows.filter(r => r.type === "Invoice").length,
      "Credit Memo": rows.filter(r => r.type === "Credit Memo").length,
      Payment: rows.filter(r => r.type === "Payment").length,
      "Refund Receipt": rows.filter(r => r.type === "Refund Receipt").length,
    },
  });
}
