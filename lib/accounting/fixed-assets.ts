/**
 * Fixed assets, straight-line — pure, client-safe, no `db`.
 *
 * Rules (the whole of them, so the server and the screen cannot disagree):
 *  - Monthly charge = (cost - salvage) / life, rounded to cents. The LAST month
 *    absorbs the rounding, so total depreciation is exactly cost - salvage.
 *  - Depreciation starts in the month of purchase (a full month, whatever the day).
 *  - A disposed asset is depreciated up to the month BEFORE its disposal month
 *    ("stops at disposal"); a fully depreciated asset stops by itself.
 *  - Periods are 'YYYY-MM' strings; dates are 'YYYY-MM-DD'. No Date objects —
 *    "a date is a date".
 */

export type AssetTerms = {
  purchaseDate: string;       // YYYY-MM-DD
  cost: number;
  salvageValue: number;
  usefulLifeMonths: number;
  disposedDate?: string | null;
};

export type ScheduleRow = {
  period: string;             // YYYY-MM
  amount: number;
  accumulated: number;        // after this month
  netBookValue: number;       // after this month
};

const round2 = (n: number) => Math.round(n * 100) / 100;

export const isPeriod = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);

export const periodOf = (date: string): string => date.slice(0, 7);

export function addMonths(period: string, n: number): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7)) - 1 + n;
  const yy = y + Math.floor(m / 12);
  const mm = ((m % 12) + 12) % 12 + 1;
  return `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}`;
}

/** Last calendar day of a period, as YYYY-MM-DD. */
export function periodEndDate(period: string): string {
  const y = Number(period.slice(0, 4));
  const m = Number(period.slice(5, 7));
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return `${period}-${String(days).padStart(2, "0")}`;
}

/** What validation of a new asset's terms says, or null when they are fine. */
export function termsError(t: AssetTerms): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t.purchaseDate)) return "Purchase date must be YYYY-MM-DD.";
  if (!isPeriod(periodOf(t.purchaseDate))) return "Purchase date is not a valid date.";
  if (!isFinite(t.cost) || t.cost <= 0) return "Cost must be greater than zero.";
  if (!isFinite(t.salvageValue) || t.salvageValue < 0) return "Salvage value cannot be negative.";
  if (t.salvageValue >= t.cost) return "Salvage value must be less than cost.";
  if (!Number.isInteger(t.usefulLifeMonths) || t.usefulLifeMonths < 1 || t.usefulLifeMonths > 1200) {
    return "Useful life must be a whole number of months between 1 and 1200.";
  }
  return null;
}

/** The full life of the asset, ignoring disposal. */
export function fullSchedule(t: AssetTerms): ScheduleRow[] {
  const depreciable = round2(t.cost - t.salvageValue);
  const monthly = round2(depreciable / t.usefulLifeMonths);
  const start = periodOf(t.purchaseDate);
  const rows: ScheduleRow[] = [];
  let acc = 0;
  for (let i = 0; i < t.usefulLifeMonths; i++) {
    const last = i === t.usefulLifeMonths - 1;
    const amount = last ? round2(depreciable - acc) : monthly;
    acc = round2(acc + amount);
    rows.push({ period: addMonths(start, i), amount, accumulated: acc, netBookValue: round2(t.cost - acc) });
  }
  return rows;
}

/** The schedule that will actually be charged: cut off before the disposal month. */
export function scheduleFor(t: AssetTerms): ScheduleRow[] {
  const all = fullSchedule(t);
  if (!t.disposedDate) return all;
  const stopAt = periodOf(t.disposedDate);
  return all.filter(r => r.period < stopAt);
}

/** Accumulated depreciation as at a date (inclusive of that date's month). */
export function accumulatedAsAt(t: AssetTerms, asAt: string): number {
  const p = periodOf(asAt);
  let acc = 0;
  for (const r of scheduleFor(t)) if (r.period <= p) acc = r.accumulated;
  return acc;
}

/** Net book value as at a date. Before the purchase month it is zero (not yet owned). */
export function netBookValueAsAt(t: AssetTerms, asAt: string): number {
  if (periodOf(asAt) < periodOf(t.purchaseDate)) return 0;
  return round2(t.cost - accumulatedAsAt(t, asAt));
}

/** Schedule rows due up to and including `through` ('YYYY-MM') not yet posted. */
export function unpostedPeriods(
  t: AssetTerms,
  posted: ReadonlySet<string> | readonly string[],
  through: string,
): ScheduleRow[] {
  const done = posted instanceof Set ? posted : new Set(posted as readonly string[]);
  return scheduleFor(t).filter(r => r.period <= through && !done.has(r.period));
}
