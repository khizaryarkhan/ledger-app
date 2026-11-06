/**
 * Contracted hours that know WHEN they applied — pure, no `db`.
 *
 * `resources.dailyCapacity` / `workingDays` are a current-value pair: change
 * them and every past figure silently restates itself, so last quarter's
 * utilisation becomes a different number than it was. These dated rows fix
 * that, and the columns stay as the fallback so nobody loses capacity they
 * already had.
 *
 * Two rules worth stating, because both have an obvious wrong answer:
 *
 *   OVERLAP TAKES THE HIGHEST, NEVER THE SUM. Two rows covering one day
 *   describe the same person's week twice; adding them would invent a
 *   sixteen-hour day out of two eight-hour contracts.
 *
 *   CAPACITY IS WALKED PER DAY, not derived from a day count times one rate.
 *   A person who moves from four days to five mid-quarter has two different
 *   patterns inside one window, and a single multiplication cannot express
 *   that — it has to pick one of them and be wrong for the rest of the range.
 *
 * Dates are YYYY-MM-DD strings compared as strings ("a date is a date").
 */

import { DEFAULT_WORKING_DAYS, isoWeekday } from "./capacity";
import { addDays } from "@/lib/accounting/report-periods";

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface WorkingHoursRow {
  hoursPerDay: number;
  /** null = fall back to the resource's own pattern, then to Mon-Fri. */
  workingDays: readonly number[] | null;
  effectiveFrom: string;
  /** null = still in force. */
  effectiveTo: string | null;
}

/** What `resources` itself says — used for any day no dated row covers. */
export interface CapacityFallback {
  dailyCapacity: number;
  workingDays: readonly number[] | null;
}

export interface Pattern {
  hoursPerDay: number;
  workingDays: readonly number[];
  /** true when a dated row decided this, false when it came from the fallback. */
  dated: boolean;
}

const pattern = (workingDays: readonly number[] | null | undefined, fallback: CapacityFallback): readonly number[] =>
  workingDays && workingDays.length
    ? workingDays
    : fallback.workingDays && fallback.workingDays.length
      ? fallback.workingDays
      : DEFAULT_WORKING_DAYS;

/**
 * The pattern in force on `date`.
 *
 * A dated row with no working days of its own inherits the resource's pattern
 * rather than the org default: the resource's own setting is the more specific
 * statement about that person, and a row that only changes the hours should
 * not quietly also change which days they work.
 */
export function patternOn(
  date: string,
  rows: readonly WorkingHoursRow[],
  fallback: CapacityFallback,
): Pattern {
  let best: WorkingHoursRow | null = null;
  for (const row of rows) {
    if (row.effectiveFrom > date) continue;
    if (row.effectiveTo && row.effectiveTo < date) continue;
    if (!best || row.hoursPerDay > best.hoursPerDay) best = row;
  }
  if (best) return { hoursPerDay: best.hoursPerDay, workingDays: pattern(best.workingDays, fallback), dated: true };
  return { hoursPerDay: fallback.dailyCapacity, workingDays: pattern(null, fallback), dated: false };
}

/** Capacity hours on ONE date: zero on a public holiday or a non-working day. */
export function hoursOn(
  date: string,
  rows: readonly WorkingHoursRow[],
  fallback: CapacityFallback,
  holidays: ReadonlySet<string>,
): number {
  if (holidays.has(date)) return 0;
  const p = patternOn(date, rows, fallback);
  return p.workingDays.includes(isoWeekday(date)) ? p.hoursPerDay : 0;
}

/**
 * Capacity over [from, to] inclusive.
 *
 * Walks the days (as `workingDaysInRange` already does) so a pattern change
 * inside the window is counted exactly rather than approximated.
 */
export function capacityOver(
  from: string,
  to: string,
  rows: readonly WorkingHoursRow[],
  fallback: CapacityFallback,
  holidays: ReadonlySet<string>,
): number {
  if (from > to) return 0;
  let total = 0;
  let cursor = from;
  while (cursor <= to) {
    total += hoursOn(cursor, rows, fallback, holidays);
    cursor = addDays(cursor, 1);
  }
  return r2(total);
}

/**
 * Is any of this window covered by a dated row?
 *
 * This is what "capacity on record" means in the coverage counts. Someone
 * without one still gets a figure — their fallback column — but they are
 * counted separately, so a denominator nobody has confirmed is visible rather
 * than quietly folded into the total.
 */
export function hasDatedHours(rows: readonly WorkingHoursRow[], from: string, to: string): boolean {
  return rows.some((r) => r.effectiveFrom <= to && (!r.effectiveTo || r.effectiveTo >= from));
}

export interface Coverage { known: number; counted: number }

/** How many of these people have dated hours covering the window. */
export function coverageOf(
  people: readonly { resourceId: string }[],
  rowsByResource: ReadonlyMap<string, readonly WorkingHoursRow[]>,
  from: string,
  to: string,
): Coverage {
  let known = 0;
  for (const p of people) if (hasDatedHours(rowsByResource.get(p.resourceId) ?? [], from, to)) known++;
  return { known, counted: people.length };
}

/**
 * How much contracted capacity booked leave actually takes away: per day, the
 * leave logged that day capped at what the day was worth. A public-holiday
 * line on a calendar holiday (already 0 h) or leave logged on a weekend takes
 * nothing, so a bank holiday is not removed from capacity twice — once by the
 * calendar and again by the "Public holiday" timesheet line.
 */
export function leaveOffCapacity(
  leave: readonly { date: string; hours: number }[],
  rows: readonly WorkingHoursRow[],
  fallback: CapacityFallback,
  holidays: ReadonlySet<string>,
): number {
  const byDay = new Map<string, number>();
  for (const e of leave) byDay.set(e.date, (byDay.get(e.date) ?? 0) + e.hours);
  let total = 0;
  for (const [date, hours] of byDay) total += Math.min(hours, hoursOn(date, rows, fallback, holidays));
  return Math.round(total * 100) / 100;
}
