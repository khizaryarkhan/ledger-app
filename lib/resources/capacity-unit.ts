/**
 * How an organisation states a person's capacity (pure, client-safe).
 *
 * STORAGE never changes: `resources.daily_capacity` is hours per working day,
 * and every engine (utilisation, compliance, planned hours, timesheets) reads
 * it that way. The organisation's unit only decides how the number is ENTERED
 * and SHOWN, converted through that person's own working days:
 *   per week  = per day × working days in the week
 *   per month = per week × 52 / 12   (the average month, not a calendar one)
 * A person working 4 days at 8h shows as 32h a week, not 40 — the unit follows
 * the person's pattern rather than assuming a 5-day week.
 */

export type CapacityUnit = "day" | "week" | "month";
export const CAPACITY_UNITS: readonly CapacityUnit[] = ["day", "week", "month"];

export const CAPACITY_UNIT_LABEL: Record<CapacityUnit, string> = {
  day: "Hours per day",
  week: "Hours per week",
  month: "Hours per month",
};

const WEEKS_PER_MONTH = 52 / 12;

export function isCapacityUnit(v: unknown): v is CapacityUnit {
  return typeof v === "string" && (CAPACITY_UNITS as readonly string[]).includes(v);
}

function daysPerWeek(workingDays: readonly number[] | null | undefined): number {
  const n = Array.isArray(workingDays) && workingDays.length ? new Set(workingDays).size : 5;
  return Math.min(7, Math.max(1, n));
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;

/** Stored hours/day → the figure shown in `unit`. */
export function fromDaily(daily: number, unit: CapacityUnit, workingDays?: readonly number[] | null): number {
  const d = Number(daily) || 0;
  if (unit === "day") return round(d, 2);
  const weekly = d * daysPerWeek(workingDays);
  // One decimal: daily_capacity is stored at 2dp, so 40h over 3 days comes back
  // as 39.99 — showing 40.0 is the figure that was entered, not a new one.
  return round(unit === "week" ? weekly : weekly * WEEKS_PER_MONTH, 1);
}

/** A figure entered in `unit` → hours/day for storage (6dp so a round trip is exact). */
export function toDaily(value: number, unit: CapacityUnit, workingDays?: readonly number[] | null): number {
  const v = Number(value) || 0;
  if (unit === "day") return round(v, 6);
  const weekly = unit === "week" ? v : v / WEEKS_PER_MONTH;
  return round(weekly / daysPerWeek(workingDays), 6);
}
