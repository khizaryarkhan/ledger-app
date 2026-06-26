// The state machine that keeps every company in exactly ONE place:
//
//   selling        → Pipeline only (lead/deal in a sales stage)
//   won_unbilled   → Accounts action queue ("create invoice/subscription") + Won column
//   customer       → Customers book (billed; an invoice OR subscription exists)
//   payment_failed → Accounts action queue ("fix payment") — a billed customer whose auto-pay failed
//
// "Billed" = the account has firstInvoicedAt set OR a subscription row exists.

export type BillingBucket = "selling" | "won_unbilled" | "customer" | "payment_failed";

export interface BucketInput {
  leadStatus?: string | null;     // pipeline stage (landing_page_requests.status)
  lifecycleStage?: string | null; // crm_accounts.lifecycle_stage
  firstInvoicedAt?: Date | string | null;
  hasSubscription?: boolean;      // a subscriptions row exists for the org
  paymentFailed?: boolean;        // subscription lastPaymentStatus failed / past_due / unpaid
}

const isWon = (i: BucketInput) =>
  i.leadStatus === "converted" || i.lifecycleStage === "customer";

export function billingBucket(i: BucketInput): BillingBucket {
  const billed = !!i.firstInvoicedAt || !!i.hasSubscription;
  if (billed) return i.paymentFailed ? "payment_failed" : "customer";
  if (isWon(i)) return "won_unbilled";
  return "selling";
}

// Does a subscription's payment state count as "failed" (needs action)?
export function isPaymentFailed(subStatus?: string | null, lastPaymentStatus?: string | null): boolean {
  if (lastPaymentStatus === "failed") return true;
  return subStatus === "past_due" || subStatus === "unpaid" || subStatus === "incomplete";
}
