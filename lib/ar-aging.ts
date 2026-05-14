/**
 * AR Aging engine — point-in-time receivables calculation.
 *
 * Implements the QBO-style Report Date aging method:
 *   - Includes only transactions dated on or before reportDate
 *   - Reduces balances only by payments/credits applied on or before reportDate
 *   - Buckets by daysPastDue = reportDate - dueDate
 *
 * Inputs the engine uses (all org-scoped):
 *   - invoices (incl. credit memos via txnType='CreditMemo')
 *   - payments + payment_applications
 *
 * Known limitations (vs. QBO's exact aging):
 *   - Direct CreditMemo → Invoice applications via QBO's LinkedTxn on the CM
 *     itself (no Payment intermediary) are not yet captured. The historical
 *     net AR may differ from QBO by the amount of such direct CM applications.
 *   - Journal Entries hitting AR are not yet captured.
 *   - Refund Receipts are not yet linked back to specific invoices.
 *   - Voided/deleted transactions: QBO returns voided invoices with Balance=0,
 *     so they naturally drop out, but we don't track explicit void status yet.
 *
 * For most small/medium businesses these limitations produce a <1% variance.
 * The reconciliation card surfaces any gap so users can investigate.
 */

import { db } from "@/db";
import { invoices, payments, paymentApplications, journalEntryArLines } from "@/db/schema";
import { and, eq, lte } from "drizzle-orm";

export type AgingBucket = "Current" | "1-30" | "31-60" | "61-90" | "91+";
export const BUCKETS: AgingBucket[] = ["Current", "1-30", "31-60", "61-90", "91+"];

export type AppliedTxn = {
  paymentId: string;
  paymentQboId: string | null;
  paymentDate: string;
  amount: number;
};

export type DetailRow = {
  customerId: string;
  customerQboId: string | null;
  projectId: string | null;
  txnType: "Invoice" | "Credit Memo" | "Journal Entry";
  txnNumber: string;
  txnId: string;            // our internal ID
  qboId: string | null;
  txnDate: string;
  dueDate: string;
  originalAmount: number;   // gross face value (signed: invoices positive, CMs/JE credits negative)
  applied: AppliedTxn[];    // payments/credits applied on or before reportDate
  totalApplied: number;     // sum of amountApplied across applied[]
  openBalance: number;      // remaining open as of reportDate (signed)
  daysPastDue: number;      // reportDate − dueDate; <=0 means current
  bucket: AgingBucket;
  currency: string;
  flags: string[];          // e.g., 'missing-due-date', 'unapplied-credit', 'negative-balance', 'journal-entry'
};

export type SummaryRow = {
  customerId: string;
  customerQboId: string | null;
  buckets: Record<AgingBucket, number>;
  total: number;
};

export type AgingResult = {
  asOf: string;
  detail: DetailRow[];
  summary: SummaryRow[];
  grandTotals: Record<AgingBucket, number> & { total: number };
  flags: {
    missingDueDate: number;
    negativeCustomerBalances: string[]; // customerIds with overall negative AR
    unappliedCredits: number;            // count of CMs with open negative balance
    voidedSuspected: number;             // invoices with Balance=0 and Total=0 (likely voided)
  };
  meta: {
    invoiceCount: number;
    creditMemoCount: number;
    paymentCount: number;
    applicationCount: number;
  };
};

function bucketFor(daysPastDue: number): AgingBucket {
  if (daysPastDue <= 0)   return "Current";
  if (daysPastDue <= 30)  return "1-30";
  if (daysPastDue <= 60)  return "31-60";
  if (daysPastDue <= 90)  return "61-90";
  return "91+";
}

function daysBetween(later: string, earlier: string): number {
  const a = new Date(later  + "T00:00:00Z").getTime();
  const b = new Date(earlier + "T00:00:00Z").getTime();
  return Math.floor((a - b) / 86400000);
}

function emptyBuckets(): Record<AgingBucket, number> {
  return { "Current": 0, "1-30": 0, "31-60": 0, "61-90": 0, "91+": 0 };
}

/**
 * Compute AR Aging as of a specific date for an org.
 *
 * @param includeClosed - when true, also returns transactions whose computed
 *   open balance is 0 (paid invoices, fully-applied CMs, applied payments).
 *   Useful for diagnosing why a customer's total differs from QBO.
 *
 * Methodology:
 *   - For TODAY: trusts the invoice's sync snapshot (qbo_balance / paid)
 *     as the source of truth. Captures closures we don't have event data for
 *     (direct CM-to-Invoice applications, write-offs, refund receipts, etc.).
 *   - For HISTORICAL dates: walks payment_applications to reconstruct the
 *     state at that date. Best accuracy where we have event data.
 */
export async function computeArAging(orgId: string, asOf: string, includeClosed = false): Promise<AgingResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
    throw new Error("asOf must be YYYY-MM-DD");
  }
  const today = new Date().toISOString().slice(0, 10);
  const isToday = asOf >= today;

  // 1. Load all invoices + credit memos dated on or before asOf
  const allInvs = await db.select().from(invoices)
    .where(and(eq(invoices.orgId, orgId), lte(invoices.invoiceDate, asOf)));

  // 2. Load all payments dated on or before asOf
  const validPayments = await db
    .select({
      id: payments.id,
      qboId: payments.qboId,
      txnDate: payments.txnDate,
      customerId: payments.customerId,
      unappliedAmount: payments.unappliedAmount,
    })
    .from(payments)
    .where(and(eq(payments.orgId, orgId), lte(payments.txnDate, asOf)));
  const paymentById = new Map(validPayments.map(p => [p.id, p]));

  // 3. Load applications and group by invoiceId, filtered to payments dated <= asOf
  const allApps = await db.select().from(paymentApplications)
    .where(eq(paymentApplications.orgId, orgId));

  const appsByInvoiceId = new Map<string, AppliedTxn[]>();
  for (const app of allApps) {
    if (!app.invoiceId) continue;
    const pay = paymentById.get(app.paymentId);
    if (!pay) continue; // payment is after asOf
    const arr = appsByInvoiceId.get(app.invoiceId) || [];
    arr.push({
      paymentId: pay.id,
      paymentQboId: pay.qboId,
      paymentDate: pay.txnDate,
      amount: app.amountApplied,
    });
    appsByInvoiceId.set(app.invoiceId, arr);
  }

  // 3b. Load every Journal Entry AR line dated on or before asOf (both today
  // and historical). Earlier versions of this engine skipped JEs for today on
  // the (wrong) assumption that the invoice snapshot already accounted for
  // their effect — it doesn't. The JE is a separate AR-posting transaction
  // and must be summed in its own right.
  const jeArRows = await db.select().from(journalEntryArLines)
    .where(and(
      eq(journalEntryArLines.orgId, orgId),
      lte(journalEntryArLines.txnDate, asOf),
      eq(journalEntryArLines.voided, false),
    ));

  // 3c. Load payment_applications that target Journal Entries. QBO's
  // "zero-amount payment" mechanism applies a JE to an invoice and records
  // BOTH sides as LinkedTxn entries on the same payment line. We capture
  // them during sync. Each JE's open amount is its gross signed amount
  // reduced (in magnitude) by the sum of applications targeting it.
  const jeApps = await db
    .select({
      targetQboId:   paymentApplications.targetQboId,
      amountApplied: paymentApplications.amountApplied,
      paymentId:     paymentApplications.paymentId,
    })
    .from(paymentApplications)
    .where(and(
      eq(paymentApplications.orgId, orgId),
      eq(paymentApplications.targetType, "JournalEntry"),
    ));
  const appliedByJeQboId = new Map<string, number>();
  for (const a of jeApps) {
    // Only count applications whose underlying payment is dated <= asOf — a
    // future-dated application shouldn't reduce the JE's open amount as of
    // a historical report date.
    const pay = paymentById.get(a.paymentId);
    if (!pay) continue;
    if (!a.targetQboId) continue;
    appliedByJeQboId.set(
      a.targetQboId,
      (appliedByJeQboId.get(a.targetQboId) ?? 0) + (a.amountApplied ?? 0),
    );
  }

  // 4. Build detail rows
  const detail: DetailRow[] = [];
  let missingDueDate = 0, voidedSuspected = 0, unappliedCredits = 0;

  for (const inv of allInvs) {
    const isCm = inv.txnType === "CreditMemo";

    // Skip suspected voids (Total=0 AND Balance=0)
    if (inv.total === 0 && (inv.qboBalance ?? 0) === 0 && !isCm) {
      voidedSuspected++;
      continue;
    }

    // Compute open balance:
    //   Today:      qboBalance (QBO snapshot) — captures write-offs, direct CM
    //               applications, and refund receipts that have no application rows.
    //   Historical: paidAt shortcut for fully-paid invoices (more reliable than
    //               payment_applications completeness); applications-based for
    //               partial/open invoices. CMs reconstructed from payment_applications
    //               if available, otherwise fall back to current qboBalance.
    let openBalance: number;
    let totalApplied = 0;
    const applied: AppliedTxn[] = [];

    if (isCm) {
      // CM's stored qboBalance is the CURRENT unapplied amount (negative).
      // For today: trust the QBO snapshot directly.
      // For historical: reconstruct using payment_applications dated <= asOf,
      // falling back to qboBalance if no applications exist for this CM.
      if (isToday) {
        openBalance = inv.qboBalance ?? inv.total; // negative
      } else {
        const cmApps = appsByInvoiceId.get(inv.id) || [];
        applied.push(...cmApps);
        totalApplied = cmApps.reduce((s, a) => s + a.amount, 0);
        // CM total is negative; applications reduce the unapplied credit toward 0.
        // If no application records exist, fall back to current qboBalance.
        openBalance = cmApps.length > 0
          ? Math.min(0, inv.total + totalApplied)
          : (inv.qboBalance ?? inv.total);
      }
      if (openBalance < -0.005) unappliedCredits++;
    } else {
      const apps = appsByInvoiceId.get(inv.id) || [];
      applied.push(...apps);
      totalApplied = apps.reduce((s, a) => s + a.amount, 0);

      if (isToday) {
        // For today's view use qboBalance directly — it is the QBO source of
        // truth and captures closures not yet in payment_applications
        // (direct CM applications, refund receipts, write-offs, etc.).
        const snapshotOpen = inv.qboBalance ?? Math.max(0, inv.total - (inv.paid || 0));
        const isSnapshotClosed = (snapshotOpen < 0.005) ||
                                 inv.paymentStatus === "Paid" ||
                                 inv.collectionStage === "Closed";
        openBalance = isSnapshotClosed ? 0 : snapshotOpen;
      } else {
        // Historical reconstruction.
        // paidAt is the authoritative payment receipt date from QBO. If it falls
        // on or before asOf the invoice was fully settled by the report date.
        // This is more reliable than payment_applications completeness.
        const fullyPaidByDate =
          (inv.paymentStatus === "Paid" || inv.collectionStage === "Closed") &&
          inv.paidAt != null &&
          inv.paidAt <= asOf;

        if (fullyPaidByDate) {
          openBalance = 0;
        } else if (
          (inv.paymentStatus === "Paid" || inv.collectionStage === "Closed") &&
          inv.paidAt == null &&
          totalApplied < 0.005
        ) {
          // Invoice is definitively closed in QBO (paymentStatus=Paid) but we have
          // no payment date (paidAt=null) and no application records. This happens
          // for invoices settled via credit memo or journal entry where no cash
          // Payment transaction exists. We cannot determine the historical close
          // date until the next QBO sync (which will populate paidAt via LinkedTxn).
          // Exclude from ALL historical dates to avoid ghost AR — the next sync will
          // backfill paidAt and restore accurate point-in-time reporting.
          openBalance = 0;
        } else {
          // Partially paid or unpaid: reconstruct from payment_applications.
          openBalance = Math.max(0, inv.total - totalApplied);
        }
      }
    }

    // Exclude fully-closed items from the detail (open balance = 0)
    // unless caller asked for them (diagnostic mode).
    if (!includeClosed && Math.abs(openBalance) < 0.005) continue;

    // Due date and aging
    const effectiveDueDate = inv.dueDate || inv.invoiceDate;
    const flags: string[] = [];
    if (!inv.dueDate) { flags.push("missing-due-date"); missingDueDate++; }
    if (isCm && openBalance < 0) flags.push("unapplied-credit");

    const dpd = daysBetween(asOf, effectiveDueDate);
    const bucket = bucketFor(dpd);

    detail.push({
      customerId: inv.customerId,
      customerQboId: inv.qboCustomerId,
      projectId: inv.projectId,
      txnType: isCm ? "Credit Memo" : "Invoice",
      txnNumber: inv.invoiceNumber,
      txnId: inv.id,
      qboId: inv.qboId,
      txnDate: inv.invoiceDate,
      dueDate: effectiveDueDate,
      originalAmount: inv.total,
      applied,
      totalApplied,
      openBalance,
      daysPastDue: dpd,
      bucket,
      currency: inv.currency,
      flags,
    });
  }

  // 4b. Add Journal Entry AR lines as their own detail rows, NET of any
  // applications captured during sync (zero-amount payments that linked the
  // JE to an offsetting invoice or other transaction).
  //
  // open amount = signed amount with magnitude reduced by applications.
  // Examples:
  //   JE -€1,000,000, no applications      → open = -€1,000,000 (fully open credit)
  //   JE -€1,000,000, €400,000 applied     → open = -€600,000   (partially applied)
  //   JE -€1,000,000, €1,000,000 applied   → open = €0          (fully applied; row dropped)
  //   JE +€500,000,  no applications       → open = +€500,000   (fully open debit)
  for (const je of jeArRows) {
    if (!je.customerId) continue;
    if (Math.abs(je.amount) < 0.005) continue;

    const appliedAmount  = appliedByJeQboId.get(je.qboJournalId) ?? 0;
    const openMagnitude  = Math.max(0, Math.abs(je.amount) - appliedAmount);
    const jeOpenBalance  = Math.sign(je.amount) * openMagnitude;
    if (!includeClosed && Math.abs(jeOpenBalance) < 0.005) continue;

    const dpd = daysBetween(asOf, je.txnDate);
    const bucket = bucketFor(dpd);
    const flags = ["journal-entry"];
    if (appliedAmount > 0.005 && openMagnitude > 0.005) flags.push("partially-applied");

    detail.push({
      customerId: je.customerId,
      customerQboId: je.qboCustomerId,
      projectId: null,
      txnType: "Journal Entry",
      txnNumber: je.docNumber || `JE-${je.qboJournalId}`,
      txnId: je.id,
      qboId: je.qboJournalId,
      txnDate: je.txnDate,
      dueDate: je.txnDate, // JEs are immediately "due"
      originalAmount: je.amount, // keep the gross for transparency
      applied: [],
      totalApplied: appliedAmount,
      openBalance: jeOpenBalance,
      daysPastDue: dpd,
      bucket,
      currency: je.currency,
      flags,
    });
  }

  // 5. Build per-customer summary
  const byCustomer = new Map<string, SummaryRow>();
  for (const row of detail) {
    let s = byCustomer.get(row.customerId);
    if (!s) {
      s = {
        customerId: row.customerId,
        customerQboId: row.customerQboId,
        buckets: emptyBuckets(),
        total: 0,
      };
      byCustomer.set(row.customerId, s);
    }
    s.buckets[row.bucket] += row.openBalance;
    s.total += row.openBalance;
  }
  const summary = [...byCustomer.values()].sort((a, b) => Math.abs(b.total) - Math.abs(a.total));

  // 5b. Deduct unapplied payment amounts per customer.
  //
  // Matches PBI methodology: payments received but not yet applied to any
  // invoice reduce the customer's net AR balance. QBO records these as
  // UnappliedAmt on the Payment. We deduct them from the Current bucket
  // first, then spill into older buckets — the customer overpaid or paid
  // early and the credit sits on account.
  const unappliedByCustomer = new Map<string, number>();
  for (const p of validPayments) {
    if (!p.customerId || (p.unappliedAmount ?? 0) < 0.005) continue;
    unappliedByCustomer.set(
      p.customerId,
      (unappliedByCustomer.get(p.customerId) ?? 0) + (p.unappliedAmount ?? 0),
    );
  }
  for (const s of summary) {
    let remaining = unappliedByCustomer.get(s.customerId) ?? 0;
    if (remaining < 0.005) continue;
    // Apply credit to Current bucket first, then 1-30, 31-60, 61-90, 91+
    for (const b of BUCKETS) {
      if (remaining < 0.005) break;
      const reduce = Math.min(remaining, Math.max(0, s.buckets[b]));
      s.buckets[b] -= reduce;
      s.total      -= reduce;
      remaining    -= reduce;
    }
  }

  // 6. Grand totals
  const grandTotals = { ...emptyBuckets(), total: 0 };
  for (const s of summary) {
    for (const b of BUCKETS) grandTotals[b] += s.buckets[b];
    grandTotals.total += s.total;
  }

  // 7. Flag customers with net negative AR (more credits than invoices)
  const negativeCustomerBalances = summary
    .filter(s => s.total < -0.005)
    .map(s => s.customerId);

  return {
    asOf,
    detail,
    summary,
    grandTotals,
    flags: {
      missingDueDate,
      negativeCustomerBalances,
      unappliedCredits,
      voidedSuspected,
    },
    meta: {
      invoiceCount: detail.filter(r => r.txnType === "Invoice").length,
      creditMemoCount: detail.filter(r => r.txnType === "Credit Memo").length,
      paymentCount: validPayments.length,
      applicationCount: allApps.length,
      journalEntryCount: detail.filter(r => r.txnType === "Journal Entry").length,
    } as any,
  };
}
