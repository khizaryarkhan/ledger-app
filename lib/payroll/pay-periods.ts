/**
 * Payroll posting cadence — pure date math, no `db`. "Weekly" alone is
 * ambiguous (which day do weeks end on?), so each frequency carries only the
 * one anchor it actually needs: weekly/biweekly need a week-ending day,
 * biweekly additionally needs one known period-end to fix which alternating
 * week is week 1, semi-monthly needs the first-half cutoff day, monthly needs
 * its own cutoff day (null = calendar month-end).
 *
 * suggestNextPeriod() is a DEFAULT, not a lock — "Post timesheets" always
 * lets the admin override the range (same rule as every other "as at" date
 * picker in this app: give a sensible default, never force it).
 *
 * All dates are plain YYYY-MM-DD strings, compared/added with explicit
 * calendar arithmetic — never via `new Date(dateString)`, which this
 * codebase learned the hard way parses as UTC midnight and drifts a day
 * under local getters (see CLAUDE.md "A date is a date"). The UTC epoch used
 * internally here is only ever round-tripped through literal Y/M/D
 * components, so no wall-clock timezone ever enters the arithmetic.
 */

export type PayrollFrequency = "weekly" | "biweekly" | "semi_monthly" | "monthly";

export type PayrollSettings = {
  payrollFrequency: PayrollFrequency | null;
  payrollWeekEndDay: number | null;         // ISO weekday 1=Mon..7=Sun
  payrollBiweeklyAnchor: string | null;      // YYYY-MM-DD, a known period-end date
  payrollSemimonthlyCutoff: number | null;   // day-of-month ending the first half
  payrollMonthCutoff: number | null;         // day-of-month; null = calendar month-end
};

export type PayPeriod = { start: string; end: string };

type YMD = { y: number; m: number; d: number };

function parseISO(s: string): YMD {
  const [y, m, d] = s.split("-").map(Number);
  return { y, m, d };
}
function fmt(p: YMD): string {
  return `${p.y.toString().padStart(4, "0")}-${p.m.toString().padStart(2, "0")}-${p.d.toString().padStart(2, "0")}`;
}
function toEpochDay(p: YMD): number {
  return Math.floor(Date.UTC(p.y, p.m - 1, p.d) / 86400000);
}
function fromEpochDay(e: number): YMD {
  const dt = new Date(e * 86400000);
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
function addDays(s: string, n: number): string {
  return fmt(fromEpochDay(toEpochDay(parseISO(s)) + n));
}
/** ISO weekday: 1=Monday .. 7=Sunday. */
function isoWeekday(s: string): number {
  const dt = new Date(toEpochDay(parseISO(s)) * 86400000);
  const js = dt.getUTCDay(); // 0=Sun..6=Sat
  return js === 0 ? 7 : js;
}
function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate(); // day 0 of next month = last day of this one
}
function nextMonth(y: number, m: number) { return m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 }; }
function prevMonth(y: number, m: number) { return m === 1 ? { y: y - 1, m: 12 } : { y, m: m - 1 }; }

function suggestWeekly(weekEndDay: number, lastPeriodEnd: string | null, today: string): PayPeriod {
  if (lastPeriodEnd) {
    const start = addDays(lastPeriodEnd, 1);
    return { start, end: addDays(start, 6) };
  }
  // Most recent weekEndDay on/before today.
  let end = today;
  while (isoWeekday(end) !== weekEndDay) end = addDays(end, -1);
  return { start: addDays(end, -6), end };
}

function suggestBiweekly(weekEndDay: number, anchor: string | null, lastPeriodEnd: string | null, today: string): PayPeriod {
  if (lastPeriodEnd) {
    const start = addDays(lastPeriodEnd, 1);
    return { start, end: addDays(start, 13) };
  }
  if (!anchor) {
    // No anchor configured yet — fall back to a single week so there is
    // always a usable suggestion; the admin should set the anchor.
    return suggestWeekly(weekEndDay, null, today);
  }
  const diff = toEpochDay(parseISO(today)) - toEpochDay(parseISO(anchor));
  const k = Math.floor(diff / 14);
  const end = addDays(anchor, k * 14);
  return { start: addDays(end, -13), end };
}

function suggestSemimonthly(cutoff: number, lastPeriodEnd: string | null, today: string): PayPeriod {
  if (lastPeriodEnd) {
    const start = parseISO(addDays(lastPeriodEnd, 1));
    const end: YMD = start.d <= cutoff ? { ...start, d: cutoff } : { ...start, d: lastDayOfMonth(start.y, start.m) };
    return { start: fmt(start), end: fmt(end) };
  }
  const t = parseISO(today);
  if (t.d <= cutoff) return { start: fmt({ ...t, d: 1 }), end: fmt({ ...t, d: cutoff }) };
  return { start: fmt({ ...t, d: cutoff + 1 }), end: fmt({ ...t, d: lastDayOfMonth(t.y, t.m) }) };
}

function monthlyPeriodEnd(y: number, m: number, cutoff: number | null): YMD {
  const last = lastDayOfMonth(y, m);
  return { y, m, d: cutoff == null ? last : Math.min(cutoff, last) };
}

function suggestMonthly(cutoff: number | null, lastPeriodEnd: string | null, today: string): PayPeriod {
  if (lastPeriodEnd) {
    const start = parseISO(addDays(lastPeriodEnd, 1));
    if (cutoff == null) return { start: fmt(start), end: fmt({ ...start, d: lastDayOfMonth(start.y, start.m) }) };
    // The next period-end is whichever is later: the (possibly clamped)
    // cutoff in start's OWN month, if start hasn't already passed it (this
    // happens when the previous cutoff was itself a month-end, so `start`
    // rolls into day 1 of the following month) — otherwise the next month's.
    let end = monthlyPeriodEnd(start.y, start.m, cutoff);
    if (fmt(end) < fmt(start)) { const nm = nextMonth(start.y, start.m); end = monthlyPeriodEnd(nm.y, nm.m, cutoff); }
    return { start: fmt(start), end: fmt(end) };
  }
  const t = parseISO(today);
  if (cutoff == null) return { start: fmt({ ...t, d: 1 }), end: fmt({ ...t, d: lastDayOfMonth(t.y, t.m) }) };
  const thisEnd = monthlyPeriodEnd(t.y, t.m, cutoff);
  if (today <= fmt(thisEnd)) {
    const pm = prevMonth(t.y, t.m);
    return { start: addDays(fmt(monthlyPeriodEnd(pm.y, pm.m, cutoff)), 1), end: fmt(thisEnd) };
  }
  const nm = nextMonth(t.y, t.m);
  return { start: addDays(fmt(thisEnd), 1), end: fmt(monthlyPeriodEnd(nm.y, nm.m, cutoff)) };
}

/**
 * The next pay period to suggest in the "Post timesheets" range picker.
 * `lastPeriodEnd` is the end date of the most recent posted timesheet_batch
 * for this org (null if none yet). `today` must be the caller's local
 * calendar date (e.g. `localToday()` from lib/format.ts) — never computed
 * here, so this function stays pure and fully deterministic in tests.
 */
export function suggestNextPeriod(org: PayrollSettings, lastPeriodEnd: string | null, today: string): PayPeriod {
  switch (org.payrollFrequency) {
    case "weekly":
      return suggestWeekly(org.payrollWeekEndDay ?? 7, lastPeriodEnd, today);
    case "biweekly":
      return suggestBiweekly(org.payrollWeekEndDay ?? 7, org.payrollBiweeklyAnchor, lastPeriodEnd, today);
    case "semi_monthly":
      return suggestSemimonthly(org.payrollSemimonthlyCutoff ?? 15, lastPeriodEnd, today);
    case "monthly":
    default:
      return suggestMonthly(org.payrollMonthCutoff ?? null, lastPeriodEnd, today);
  }
}
