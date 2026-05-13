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
  customers, invoices, payments, journalEntryArLines, deposits, paymentApplications,
} from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { getValidToken } from "@/lib/qbo-sync";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [cust] = await db.select({
    id: customers.id, currency: customers.currency, qboId: customers.qboId,
  })
    .from(customers)
    .where(and(eq(customers.id, params.id), eq(customers.orgId, orgId!)))
    .limit(1);
  if (!cust) return bad("Customer not found", 404);

  // Authoritative path: ask QBO directly. We return BalanceWithJobs (parent
  // customer's open AR + every sub-customer's open AR) because in our ledger
  // a customer record aggregates its sub-customers via projects.customerId.
  // The plain Customer.Balance is parent-only and would understate the
  // customer's true exposure whenever AR lives on a sub-customer / project.
  if (cust.qboId) {
    try {
      const token = await getValidToken(orgId!);
      if (token) {
        const res = await fetch(
          `https://quickbooks.api.intuit.com/v3/company/${token.realmId}/customer/${cust.qboId}?minorversion=65`,
          { headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" } },
        );
        if (res.ok) {
          const data = await res.json();
          const c = data.Customer || data;
          const qboBalance         = parseFloat(c.Balance)         || 0;
          const qboBalanceWithJobs = parseFloat(c.BalanceWithJobs) || qboBalance;
          return ok({
            currency:           cust.currency,
            openInvoiceBalance: 0,
            openInvoiceCount:   0,
            cmCredit:           0,
            paymentCredit:      0,
            jeBalance:          0,
            depositCredit:      0,
            netBalance:         qboBalanceWithJobs, // parent + sub-customers
            qboBalanceParentOnly: qboBalance,       // exposed for diagnostics
            netBalanceWithJobs:   qboBalanceWithJobs,
            source:             "qbo-live",
            qboCheckedAt:       new Date().toISOString(),
          });
        }
      }
    } catch (e) {
      // Fall through to local reconstruction below
    }
  }

  const [invs, pmts, jes, deps, jeApps] = await Promise.all([
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
    db.select({
      qboJournalId: journalEntryArLines.qboJournalId,
      amount: journalEntryArLines.amount,
      voided: journalEntryArLines.voided,
    })
      .from(journalEntryArLines)
      .where(and(eq(journalEntryArLines.orgId, orgId!), eq(journalEntryArLines.customerId, cust.id))),
    db.select({ amount: deposits.amount })
      .from(deposits)
      .where(and(eq(deposits.orgId, orgId!), eq(deposits.customerId, cust.id))),
    // Applications targeting JEs — captures zero-amount payments that QBO uses
    // to apply a JE to an invoice. Once we see one for a JE, that JE has been
    // closed and should not contribute to AR.
    db.select({
      targetQboId:   paymentApplications.targetQboId,
      amountApplied: paymentApplications.amountApplied,
    })
      .from(paymentApplications)
      .where(and(
        eq(paymentApplications.orgId, orgId!),
        eq(paymentApplications.targetType, "JournalEntry"),
      )),
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

  // JE open amount = signed amount reduced by the magnitude of any applications
  // captured in payment_applications (zero-amount payments that linked the JE
  // to an offsetting transaction). A fully-applied JE contributes zero.
  const appliedByJeQboId = new Map<string, number>();
  for (const a of jeApps) {
    if (!a.targetQboId) continue;
    appliedByJeQboId.set(a.targetQboId, (appliedByJeQboId.get(a.targetQboId) ?? 0) + (a.amountApplied ?? 0));
  }
  const jeBalance = jes
    .filter(j => !(j as any).voided)
    .reduce((s, j) => {
      const applied = appliedByJeQboId.get(j.qboJournalId) ?? 0;
      const openMagnitude = Math.max(0, Math.abs(j.amount ?? 0) - applied);
      const openAmount    = Math.sign(j.amount ?? 0) * openMagnitude;
      return s + openAmount;
    }, 0);

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
