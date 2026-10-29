/**
 * The date-period filter every record list offers ("Invoice date: Last Month").
 *
 * This used to be copy-pasted — verbatim — into the Invoices page and the
 * Payables purchase-order page. Pure, no React and no `db`, so a list on any
 * module filters by the same rule and it can be tested without a browser.
 *
 * A window is a pair of YYYY-MM-DD strings, inclusive at both ends. A
 * document's own date is never turned into a Date: `new Date("2026-09-30")` is
 * UTC midnight and reads as the 29th west of Greenwich (CLAUDE.md, "A date is
 * a date"). Comparing the strings is exact and timezone-free.
 */

import { ymd } from "@/lib/format";

export type PeriodId = "this-month" | "last-month" | "last-3m" | "last-6m" | "all" | "custom";

export const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "this-month", label: "This Month" },
  { id: "last-month", label: "Last Month" },
  { id: "last-3m",    label: "Last 3M" },
  { id: "last-6m",    label: "Last 6M" },
  { id: "all",        label: "All Time" },
  { id: "custom",     label: "Custom" },
];

export type DateWindow = { from: string; to: string };

const EVERYTHING: DateWindow = { from: "0000-01-01", to: "9999-12-31" };

export const periodLabel = (id: PeriodId): string => PERIODS.find((p) => p.id === id)?.label ?? "Custom";

/** The inclusive date window for a period. `now` is injectable for tests. */
export function periodWindow(id: PeriodId, custom: DateWindow, now: Date = new Date()): DateWindow {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (id) {
    case "this-month": return { from: ymd(new Date(y, m, 1)),     to: ymd(new Date(y, m + 1, 0)) };
    case "last-month": return { from: ymd(new Date(y, m - 1, 1)), to: ymd(new Date(y, m, 0)) };
    case "last-3m":    return { from: ymd(new Date(y, m - 3, 1)), to: ymd(now) };
    case "last-6m":    return { from: ymd(new Date(y, m - 6, 1)), to: ymd(now) };
    case "custom":     return custom;
    default:           return EVERYTHING;
  }
}

/**
 * Is this document inside the window? A row with no date is always kept —
 * absence of a date is not evidence that a document is out of range, and
 * dropping it would silently hide real records.
 */
export function inWindow(date: string | null | undefined, w: DateWindow): boolean {
  if (!date) return true;
  const d = date.slice(0, 10);
  return d >= w.from && d <= w.to;
}
