/**
 * Accounting data points (0116) — pure, client-safe, no `db`.
 *
 * Why a credit or a manual journal was raised is a FIXED code, so revenue
 * leakage and adjustments can be counted rather than read out of memos. Which
 * list applies is decided by the document type, never by the caller.
 */

import { daysBetween, isIsoDate } from "@/lib/inventory/delivery-performance";

export type ReasonDef = { code: string; label: string };

/** Credit note, refund receipt, vendor credit. */
export const CREDIT_REASONS: readonly ReasonDef[] = [
  { code: "price_adjustment", label: "Price adjustment" },
  { code: "goods_returned",   label: "Goods returned" },
  { code: "damaged",          label: "Damaged / defective" },
  { code: "wrong_item",       label: "Wrong item supplied" },
  { code: "short_delivery",   label: "Short delivery" },
  { code: "billing_error",    label: "Billing error / duplicate" },
  { code: "discount",         label: "Discount / rebate" },
  { code: "goodwill",         label: "Goodwill" },
  { code: "other",            label: "Other" },
];

/** Manual journal entries. */
export const JOURNAL_REASONS: readonly ReasonDef[] = [
  { code: "accrual",        label: "Accrual" },
  { code: "prepayment",     label: "Prepayment" },
  { code: "depreciation",   label: "Depreciation" },
  { code: "provision",      label: "Provision" },
  { code: "reclass",        label: "Reclassification" },
  { code: "correction",     label: "Error correction" },
  { code: "payroll",        label: "Payroll" },
  { code: "fx_revaluation", label: "FX revaluation" },
  { code: "write_off",      label: "Write-off" },
  { code: "other",          label: "Other" },
];

export const CREDIT_TYPES = new Set(["CreditNote", "RefundReceipt", "VendorCredit"]);
/** Purchase documents whose arrival date is worth knowing. */
export const RECEIVED_DATE_TYPES = new Set(["Bill", "Expense", "VendorCredit"]);

export function reasonsFor(sourceType: string): readonly ReasonDef[] | null {
  if (CREDIT_TYPES.has(sourceType)) return CREDIT_REASONS;
  if (sourceType === "Manual") return JOURNAL_REASONS;
  return null;
}

export function reasonLabel(sourceType: string, code: string | null | undefined): string {
  if (!code) return "Not recorded";
  return reasonsFor(sourceType)?.find(r => r.code === code)?.label ?? code;
}

/**
 * Validate a reason for a document type. Returns the code to store (null when
 * the type takes no reason, or none was given and none is required); throws
 * with a user-facing message otherwise.
 */
export function checkReason(sourceType: string, v: unknown, opts: { required?: boolean } = {}): string | null {
  const list = reasonsFor(sourceType);
  if (!list) return null;
  if (v === undefined || v === null || v === "") {
    if (opts.required) throw new Error(CREDIT_TYPES.has(sourceType) ? "Choose why this credit is being given." : "Choose what this journal is for.");
    return null;
  }
  if (typeof v !== "string" || !list.some(r => r.code === v)) throw new Error("Unknown reason.");
  return v;
}

/**
 * When the supplier's document arrived. Only for purchase documents; never
 * before the document's own date, never after `today`.
 */
export function checkReceivedDate(sourceType: string, v: unknown, docDate: string, today: string): string | null {
  if (!RECEIVED_DATE_TYPES.has(sourceType)) return null;
  if (v === undefined || v === null || v === "") return null;
  if (!isIsoDate(v)) throw new Error("Received date must be a valid date (YYYY-MM-DD).");
  if (v < docDate) throw new Error("A bill can't be received before its own date.");
  if (v > today) throw new Error("Received date can't be in the future.");
  return v;
}

/** Days between the supplier dating a bill and it reaching us (capture lag). */
export function captureLagDays(docDate: string, receivedDate: string | null): number | null {
  return receivedDate && isIsoDate(docDate) && isIsoDate(receivedDate) ? daysBetween(docDate, receivedDate) : null;
}
