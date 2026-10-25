/**
 * Pure period math for the financial-statement report UI: report-period
 * shortcut presets, "Display columns by" sub-period splitting, and Compare-to
 * period derivation. No `db` import — safe for client components, same split
 * as account-roles.ts / account-roles-server.ts.
 *
 * Every date in and out is a plain YYYY-MM-DD string, read/written literally
 * (never through `new Date(...)` getters) — see CLAUDE.md "A date is a date".
 */

export type BucketSize = "total" | "month" | "quarter" | "year";
export type CompareMode = "none" | "previous_period" | "previous_year";

export type NamedRange = { key: string; label: string; from: string; to: string };
export type NamedAsOf = { key: string; label: string; asOf: string };

function pad2(n: number) { return String(n).padStart(2, "0"); }
function ymd(y: number, m: number, d: number) { return `${y}-${pad2(m)}-${pad2(d)}`; }
function parse(dateStr: string): { y: number; m: number; d: number } {
  const [y, m, d] = dateStr.split("-").map(Number);
  return { y, m, d };
}
function daysInMonth(y: number, m: number) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }

export function addMonthsToDate(dateStr: string, n: number): string {
  const { y, m, d } = parse(dateStr);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12), nm = (total % 12) + 1;
  return ymd(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}
export function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
export const dayBeforeDate = (dateStr: string) => addDays(dateStr, -1);

export function startOfMonth(dateStr: string): string { const { y, m } = parse(dateStr); return ymd(y, m, 1); }
export function endOfMonth(dateStr: string): string { const { y, m } = parse(dateStr); return ymd(y, m, daysInMonth(y, m)); }
export function startOfQuarter(dateStr: string): string { const { y, m } = parse(dateStr); return ymd(y, Math.floor((m - 1) / 3) * 3 + 1, 1); }
export function endOfQuarter(dateStr: string): string { return endOfMonth(addMonthsToDate(startOfQuarter(dateStr), 2)); }

/** First day of the fiscal year containing `dateStr`, for a FY starting in month `fym` (1-12). */
export function fyStart(dateStr: string, fym: number): string {
  const { y, m } = parse(dateStr);
  return ymd(m < fym ? y - 1 : y, fym, 1);
}
export function fyEnd(dateStr: string, fym: number): string {
  return endOfMonth(addMonthsToDate(fyStart(dateStr, fym), 11));
}

export type RangePresetKey =
  | "this_month" | "last_month" | "this_quarter" | "last_quarter"
  | "this_fy_to_date" | "last_fy" | "this_calendar_year_to_date" | "last_calendar_year" | "custom";

export const RANGE_PRESETS: { value: RangePresetKey; label: string }[] = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "last_quarter", label: "Last quarter" },
  { value: "this_fy_to_date", label: "This fiscal year to date" },
  { value: "last_fy", label: "Last fiscal year" },
  { value: "this_calendar_year_to_date", label: "This year to date" },
  { value: "last_calendar_year", label: "Last year" },
  { value: "custom", label: "Custom" },
];

/** null for "custom" — the caller keeps whatever from/to is already in state. */
export function rangeForPreset(preset: RangePresetKey, today: string, fym: number): NamedRange | null {
  switch (preset) {
    case "this_month": return { key: preset, label: "This month", from: startOfMonth(today), to: today };
    case "last_month": { const a = addMonthsToDate(today, -1); return { key: preset, label: "Last month", from: startOfMonth(a), to: endOfMonth(a) }; }
    case "this_quarter": return { key: preset, label: "This quarter", from: startOfQuarter(today), to: today };
    case "last_quarter": { const a = addMonthsToDate(startOfQuarter(today), -1); return { key: preset, label: "Last quarter", from: startOfQuarter(a), to: endOfQuarter(a) }; }
    case "this_fy_to_date": return { key: preset, label: "This fiscal year to date", from: fyStart(today, fym), to: today };
    case "last_fy": { const a = dayBeforeDate(fyStart(today, fym)); return { key: preset, label: "Last fiscal year", from: fyStart(a, fym), to: fyEnd(a, fym) }; }
    case "this_calendar_year_to_date": { const { y } = parse(today); return { key: preset, label: "This year to date", from: ymd(y, 1, 1), to: today }; }
    case "last_calendar_year": { const { y } = parse(today); return { key: preset, label: "Last year", from: ymd(y - 1, 1, 1), to: ymd(y - 1, 12, 31) }; }
    default: return null;
  }
}

export type AsOfPresetKey = "today" | "end_of_last_month" | "end_of_last_quarter" | "end_of_last_fy" | "custom";

export const AS_OF_PRESETS: { value: AsOfPresetKey; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "end_of_last_month", label: "End of last month" },
  { value: "end_of_last_quarter", label: "End of last quarter" },
  { value: "end_of_last_fy", label: "End of last fiscal year" },
  { value: "custom", label: "Custom" },
];

export function asOfForPreset(preset: AsOfPresetKey, today: string, fym: number): NamedAsOf | null {
  switch (preset) {
    case "today": return { key: preset, label: "Today", asOf: today };
    case "end_of_last_month": return { key: preset, label: "End of last month", asOf: endOfMonth(addMonthsToDate(today, -1)) };
    case "end_of_last_quarter": return { key: preset, label: "End of last quarter", asOf: endOfQuarter(addMonthsToDate(startOfQuarter(today), -1)) };
    case "end_of_last_fy": return { key: preset, label: "End of last fiscal year", asOf: fyEnd(dayBeforeDate(fyStart(today, fym)), fym) };
    default: return null;
  }
}

export const COLUMN_BUCKETS: { value: BucketSize; label: string }[] = [
  { value: "total", label: "Total only" },
  { value: "month", label: "Months" },
  { value: "quarter", label: "Quarters" },
  { value: "year", label: "Years" },
];

export const COMPARE_MODES: { value: CompareMode; label: string }[] = [
  { value: "none", label: "None" },
  { value: "previous_period", label: "Previous period" },
  { value: "previous_year", label: "Previous year" },
];

const MONTH_ABBR = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Display columns by" — tile [from, to] into labeled sub-ranges, clipped to the window. Always returns at least one column. */
export function splitRangeByBucket(from: string, to: string, bucket: BucketSize): NamedRange[] {
  if (bucket === "total" || from > to) return [{ key: "total", label: "Total", from, to }];
  const out: NamedRange[] = [];
  let cursor = bucket === "month" ? startOfMonth(from) : bucket === "quarter" ? startOfQuarter(from) : `${parse(from).y}-01-01`;
  let i = 0;
  while (cursor <= to && i < 60) {
    const bucketEnd = bucket === "month" ? endOfMonth(cursor) : bucket === "quarter" ? endOfQuarter(cursor) : `${parse(cursor).y}-12-31`;
    const segFrom = cursor > from ? cursor : from;
    const segTo = bucketEnd < to ? bucketEnd : to;
    // Month labels are built from the parsed YYYY-MM string directly — never
    // through `new Date(...).toLocaleDateString()` — same "a date is a date"
    // rule as lib/format.ts: no Date object ever needs to touch a date-only
    // value just to read its own month/year back out.
    const label = bucket === "month"
      ? `${MONTH_ABBR[parse(cursor).m - 1]} ${parse(cursor).y}`
      : bucket === "quarter" ? `Q${Math.floor((parse(cursor).m - 1) / 3) + 1} ${parse(cursor).y}` : String(parse(cursor).y);
    out.push({ key: `${bucket}-${i}`, label, from: segFrom, to: segTo });
    cursor = bucket === "month" ? addMonthsToDate(cursor, 1) : bucket === "quarter" ? addMonthsToDate(cursor, 3) : `${parse(cursor).y + 1}-01-01`;
    i++;
  }
  return out;
}

/** Same idea for as-at statements: a snapshot at the end of each bucket, clipped to `to`. */
export function splitAsOfByBucket(from: string, to: string, bucket: BucketSize): NamedAsOf[] {
  if (bucket === "total") return [{ key: "total", label: "As at", asOf: to }];
  return splitRangeByBucket(from, to, bucket).map((r) => ({ key: r.key, label: r.label, asOf: r.to }));
}

/** The comparison period for a RANGE report, given the primary [from, to]. null for "none". */
export function compareRange(from: string, to: string, mode: CompareMode): NamedRange | null {
  if (mode === "previous_period") {
    const days = Math.round((new Date(to + "T00:00:00Z").getTime() - new Date(from + "T00:00:00Z").getTime()) / 86400000);
    const pTo = dayBeforeDate(from);
    return { key: "compare", label: "Previous period", from: addDays(pTo, -days), to: pTo };
  }
  if (mode === "previous_year") {
    const shiftY = (s: string) => { const { y, m, d } = parse(s); return ymd(y - 1, m, d); };
    return { key: "compare", label: "Previous year", from: shiftY(from), to: shiftY(to) };
  }
  return null;
}

/** The comparison "as at" date for a point-in-time report. null for "none". */
export function compareAsOf(asOf: string, mode: CompareMode): NamedAsOf | null {
  if (mode === "previous_period") return { key: "compare", label: "Previous month-end", asOf: endOfMonth(addMonthsToDate(asOf, -1)) };
  if (mode === "previous_year") { const { y, m, d } = parse(asOf); return { key: "compare", label: "Previous year", asOf: ymd(y - 1, m, d) }; }
  return null;
}
