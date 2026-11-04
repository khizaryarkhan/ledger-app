// How a QuickBooks Payment becomes rows in our `payments` and
// `payment_applications` tables. Pure: no db, no network.
//
// Shared by the full/incremental sync (STEP 7.6 in lib/qbo-sync.ts) and the
// webhook path (syncTargetedEntities). They used to differ: the webhook only
// refreshed the invoices a payment settled and never wrote the payment itself,
// so a payment received in the morning was missing from the payments list until
// the nightly sync (reported by EDC on 2026-11-04, payments 72871 and 72873).
// One mapping means the two paths cannot disagree about what a payment row is.

/** The kinds of document a payment line can settle that we record. */
export const APPLIED_TARGET_TYPES = ["Invoice", "CreditMemo", "JournalEntry"] as const;

export type QboPaymentRow = {
  orgId: string;
  qboId: string;
  customerId: string | null;
  qboCustomerId: string | null;
  txnDate: string;
  totalAmount: number;
  unappliedAmount: number;
  currency: string;
  exchangeRate: number | null;
  paymentMethod: string | null;
  paymentRef: string | null;
  depositAccountId: string | null;
  depositAccountName: string | null;
  privateNote: string | null;
  qboSyncedAt: Date;
  updatedAt: Date;
};

export type QboPaymentApplication = {
  orgId: string;
  paymentId: string;
  invoiceId: string | null;
  targetQboId: string;
  targetType: string;
  targetLineId: string | null;
  amountApplied: number;
};

/**
 * The `payments` row for one QuickBooks Payment, or the reason it cannot be
 * stored. `custByQboId` maps a QuickBooks customer id to our customer id; an
 * unknown customer is stored as null rather than refusing the payment.
 */
export function paymentRowFromQbo(
  orgId: string,
  qpay: any,
  custByQboId: Map<string, string>,
  now: Date = new Date(),
): { ok: true; row: QboPaymentRow } | { ok: false; qboId: string; reason: string } {
  if (!qpay?.Id) return { ok: false, qboId: "?", reason: "Missing Id" };
  if (!qpay.TxnDate) return { ok: false, qboId: String(qpay.Id), reason: "Missing TxnDate" };

  const qboCustId = qpay.CustomerRef?.value as string | undefined;
  return {
    ok: true,
    row: {
      orgId,
      qboId: String(qpay.Id),
      customerId: qboCustId ? (custByQboId.get(qboCustId) ?? null) : null,
      qboCustomerId: qboCustId ?? null,
      txnDate: qpay.TxnDate,
      totalAmount: parseFloat(qpay.TotalAmt) || 0,
      unappliedAmount: parseFloat(qpay.UnappliedAmt) || 0,
      currency: qpay.CurrencyRef?.value || "EUR",
      exchangeRate: qpay.ExchangeRate ? parseFloat(qpay.ExchangeRate) : null,
      paymentMethod: qpay.PaymentMethodRef?.name || null,
      paymentRef: qpay.PaymentRefNum || null,
      depositAccountId: qpay.DepositToAccountRef?.value || null,
      depositAccountName: qpay.DepositToAccountRef?.name || null,
      privateNote: qpay.PrivateNote || null,
      qboSyncedAt: now,
      updatedAt: now,
    },
  };
}

/**
 * Every document one payment settles, as `payment_applications` rows.
 *
 * Every LinkedTxn on every line is kept, zero-amount payments included: QuickBooks
 * uses a zero payment to apply a credit memo or journal entry against an invoice,
 * and the application is the only record that the credit was used. Credit memos
 * are held in `invoices` under `CM-<id>`, so they resolve through `cmByRawId`; a
 * journal entry has no row of its own and keeps only its QuickBooks id.
 */
export function applicationsFromQboPayment(
  orgId: string,
  paymentRowId: string,
  qpay: any,
  invByQboId: Map<string, string>,
  cmByRawId: Map<string, string>,
): QboPaymentApplication[] {
  const apps: QboPaymentApplication[] = [];
  for (const line of qpay?.Line || []) {
    const amount = parseFloat(line.Amount) || 0;
    for (const l of line.LinkedTxn || []) {
      const targetType = l.TxnType as string;
      const targetQboId = l.TxnId as string;
      if (!targetQboId || !targetType) continue;
      if (!(APPLIED_TARGET_TYPES as readonly string[]).includes(targetType)) continue;
      const invoiceId =
        targetType === "Invoice" ? (invByQboId.get(targetQboId) ?? null)
        : targetType === "CreditMemo" ? (cmByRawId.get(targetQboId) ?? null)
        : null;
      apps.push({
        orgId,
        paymentId: paymentRowId,
        invoiceId,
        targetQboId,
        targetType,
        // Which line of the target was settled. Needed for a journal entry that
        // carries A/R lines for several customers; absent on some payloads.
        targetLineId: (l.TxnLineId as string | undefined) ?? null,
        amountApplied: amount,
      });
    }
  }
  return apps;
}

/** Credit memos live in `invoices` with qboId `CM-<id>`: map the raw QuickBooks id to our row. */
export function creditMemoIndex(rows: { id: string; qboId: string | null }[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of rows) if (r.qboId?.startsWith("CM-")) m.set(r.qboId.slice(3), r.id);
  return m;
}
