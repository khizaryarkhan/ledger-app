/**
 * Customer net AR balance — includes every AR-affecting transaction type.
 *
 * GET /api/customers/[id]/balance
 *
 * Returns the customer's current net AR balance combining:
 *   - Open invoice balances        (positive)
 *   - Unapplied credit memos       (negative)
 *   - Unapplied payments on file   (negative)
 *   - Journal entry AR lines       (signed)
 *   - Deposit AR lines             (signed; negative for customer credits)
 *
 * This mirrors how QBO computes Customer.Balance and is what the customer
 * detail card should display so the number ties to QBO's customer register.
 */

import { db } from "@/db";
import {
  customers, invoices, payments, journalEntryArLines, deposits,
} from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [cust] = await db.select({ id: customers.id, currency: customers.currency })
    .from(customers)
    .where(and(eq(customers.id, params.id), eq(customers.orgId, orgId!)))
    .limit(1);
  if (!cust) return bad("Customer not found", 404);

  const [invs, pmts, jes, deps] = await Promise.all([
    db.select({
      total:           invoices.total,
      paid:            invoices.paid,
      qboBalance:      invoices.qboBalance,
      paymentStatus:   invoices.paymentStatus,
      collectionStage: invoices.collectionStage,
      txnType:         invoices.txnType,
    }).from(invoices).where(and(eq(invoices.orgId, orgId!), eq(invoices.customerId, cust.id))),
    db.select({
      unappliedAmount: payments.unappliedAmount,
    }).from(payments).where(and(eq(payments.orgId, orgId!), eq(payments.customerId, cust.id))),
    db.select({ amount: journalEntryArLines.amount, voided: journalEntryArLines.voided })
      .from(journalEntryArLines)
      .where(and(eq(journalEntryArLines.orgId, orgId!), eq(journalEntryArLines.customerId, cust.id))),
    db.select({ amount: deposits.amount })
      .from(deposits)
      .where(and(eq(deposits.orgId, orgId!), eq(deposits.customerId, cust.id))),
  ]);

  // Open invoices: sum (total - paid) for invoices not Paid/Closed and not CMs
  let openInvoiceBalance = 0;
  let cmCredit = 0;
  let openInvoiceCount = 0;
  for (const inv of invs) {
    if (inv.txnType === "CreditMemo") {
      // qboBalance is negative for unapplied CMs
      const bal = inv.qboBalance ?? 0;
      if (bal < -0.005) cmCredit += bal;
    } else {
      const isClosed = inv.paymentStatus === "Paid" || inv.collectionStage === "Closed";
      if (isClosed) continue;
      const remaining = inv.qboBalance ?? Math.max(0, (inv.total ?? 0) - (inv.paid ?? 0));
      if (remaining > 0.005) {
        openInvoiceBalance += remaining;
        openInvoiceCount++;
      }
    }
  }

  const paymentCredit = -pmts.reduce((s, p) => s + (p.unappliedAmount ?? 0), 0);
  const jeBalance     = jes.filter(j => !(j as any).voided).reduce((s, j) => s + (j.amount ?? 0), 0);
  const depositCredit = deps.reduce((s, d) => s + (d.amount ?? 0), 0);

  const netBalance =
    openInvoiceBalance +
    cmCredit +
    paymentCredit +
    jeBalance +
    depositCredit;

  return ok({
    currency: cust.currency,
    openInvoiceBalance,
    openInvoiceCount,
    cmCredit,            // <= 0
    paymentCredit,       // <= 0
    jeBalance,           // signed
    depositCredit,       // typically <= 0
    netBalance,          // sum of the above; matches QBO Customer.Balance
  });
}
