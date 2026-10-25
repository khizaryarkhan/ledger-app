/**
 * Pure scheduling math for recurring document templates (QBO form-parity,
 * Phase 6 "Make Recurring") — no `db` import, same client-safe split as
 * account-roles.ts / report-periods.ts. Every date in and out is a plain
 * YYYY-MM-DD string (CLAUDE.md "A date is a date") — reuses report-
 * periods.ts's addDays/addMonthsToDate rather than a second date-math
 * implementation.
 */
import { addDays, addMonthsToDate } from "./report-periods";

export type RecurFrequency = "daily" | "weekly" | "monthly" | "yearly";
export type RecurEndType = "never" | "after" | "on";

/** Document types with a stable, reconstructible PostDocInput — the same set
 *  app/(app)/accounting/transactions/[id]/page.tsx calls LINE_EDITABLE.
 *  Payment/BillPayment/Deposit/Transfer/Manual are excluded: their "amount"
 *  varies occurrence to occurrence in a way that makes a templated copy
 *  misleading rather than useful. Shared between the client (the "Make
 *  recurring" button's own gating) and the API route (server-side
 *  enforcement), so the two can never drift apart. */
export const RECURRABLE_TYPES = new Set(["Invoice", "SalesReceipt", "CreditNote", "RefundReceipt", "Bill", "Expense", "VendorCredit"]);

/** The next occurrence date after `dateStr`, every `interval` <frequency> units. */
export function nextOccurrence(dateStr: string, frequency: RecurFrequency, interval: number): string {
  const n = Math.max(1, Math.trunc(interval) || 1);
  switch (frequency) {
    case "daily":   return addDays(dateStr, n);
    case "weekly":  return addDays(dateStr, 7 * n);
    case "monthly": return addMonthsToDate(dateStr, n);
    case "yearly":  return addMonthsToDate(dateStr, 12 * n);
  }
}

/**
 * Whether a template should stop generating further occurrences, evaluated
 * AFTER an occurrence has just been created (occurrencesCreated already
 * incremented, nextRunDate already advanced to what WOULD be the next run).
 */
export function isTemplateFinished(args: {
  endType: RecurEndType;
  endAfterCount?: number | null;
  endOnDate?: string | null;
  occurrencesCreated: number;
  nextRunDate: string;
}): boolean {
  if (args.endType === "after") {
    return args.endAfterCount != null && args.occurrencesCreated >= args.endAfterCount;
  }
  if (args.endType === "on") {
    return !!args.endOnDate && args.nextRunDate > args.endOnDate;
  }
  return false;
}
