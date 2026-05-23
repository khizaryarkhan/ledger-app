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
 * All data is read from our local PostgreSQL database (synced from QBO via
 * webhooks/manual sync). We never call the QBO API at request time — this
 * keeps the response fast and consistent with every other report in the app.
 */

import { db } from "@/db";
import {
  customers, invoices, payments, journalEntryArLines, deposits, paymentApplications,
} from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";

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
      id: journalEntryArLines.id,
      qboJournalId: journalEntryArLines.qboJournalId,
      qboLineId: journalEntryArLines.qboLineId,
      amount: journalEntryArLines.amount,
      voided: journalEntryArLines.voided,
    })
      .from(journalEntryArLines)
      .where(and(eq(journalEntryArLines.orgId, orgId!), eq(journalEntryArLines.customerId, cust.id))),
    db.select({ amount: deposits.amount })
      .from(deposits)
      .where(and(eq(deposits.orgId, orgId!), eq(deposits.customerId, cust.id))),
    // Applications targeting JEs. Captures the partial-applied case: a
    // zero-amount payment with Payment.Line.LinkedTxn pointing at the JE and
    // Payment.Line.Amount equal to the applied portion. TxnLineId may be
    // present (best) or absent (falls back to header-level netting).
    db.select({
      targetQboId:   paymentApplications.targetQboId,
      targetLineId:  paymentApplications.targetLineId,
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

  // JE open amount per LINE (not per header). Match applications via
  // (qboJournalId, qboLineId) when available; fall back to a proportional
  // share of header-level applications when QBO omits TxnLineId.
  const appliedByJeLine   = new Map<string, number>();
  const appliedByJeHeader = new Map<string, number>();
  for (const a of jeApps) {
    if (!a.targetQboId) continue;
    if (a.targetLineId) {
      const k = `${a.targetQboId}|${a.targetLineId}`;
      appliedByJeLine.set(k, (appliedByJeLine.get(k) ?? 0) + (a.amountApplied ?? 0));
    } else {
      appliedByJeHeader.set(a.targetQboId, (appliedByJeHeader.get(a.targetQboId) ?? 0) + (a.amountApplied ?? 0));
    }
  }
  // Pre-distribute header-level applied amounts across this customer's JE
  // lines under the same JE header (proportional to |amount|).
  const headerAllocationByJe = new Map<string, number>();
  if (appliedByJeHeader.size > 0) {
    const linesByHeader = new Map<string, { id: string; abs: number }[]>();
    for (const j of jes) {
      if ((j as any).voided) continue;
      const abs = Math.abs(j.amount ?? 0);
      if (abs < 0.005) continue;
      const arr = linesByHeader.get(j.qboJournalId) ?? [];
      arr.push({ id: (j as any).id ?? "", abs });
      linesByHeader.set(j.qboJournalId, arr);
    }
    for (const [header, totalApplied] of appliedByJeHeader.entries()) {
      const lines = linesByHeader.get(header);
      if (!lines || lines.length === 0) continue;
      const sumAbs = lines.reduce((s, l) => s + l.abs, 0);
      if (sumAbs < 0.005) continue;
      let remaining = totalApplied;
      for (let i = 0; i < lines.length; i++) {
        const share = i === lines.length - 1 ? remaining : (lines[i].abs / sumAbs) * totalApplied;
        if (lines[i].id) headerAllocationByJe.set(lines[i].id, share);
        remaining -= share;
      }
    }
  }
  const jeBalance = jes
    .filter(j => !(j as any).voided)
    .reduce((s, j) => {
      let applied = 0;
      if (j.qboLineId) applied = appliedByJeLine.get(`${j.qboJournalId}|${j.qboLineId}`) ?? 0;
      if (applied === 0) applied = headerAllocationByJe.get((j as any).id) ?? 0;
      const openMagnitude = Math.max(0, Math.abs(j.amount ?? 0) - applied);
      return s + Math.sign(j.amount ?? 0) * openMagnitude;
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
    source: "local",     // always local DB — never a live QBO call
  });
}
