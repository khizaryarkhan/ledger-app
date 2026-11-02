/**
 * Machine utilisation — pure, no `db`.
 *
 * Utilisation is hours run ÷ hours the machine was available. The numerator is
 * derived from completed runs (`machine.ts`); this file owns the denominator and
 * the two figures that sit beside it.
 *
 * THE DENOMINATOR IS NOT `resources.daily_capacity`. For equipment that column
 * is SLOTS per day (default 1, "how many jobs at once"), not hours; read as
 * hours it would call every machine 1 hour a day and report absurd utilisation.
 * Available hours come only from dated working-hours rows
 * (`resource_working_hours`), and a day no dated row covers contributes ZERO
 * rather than a guess. A figure is then given only when EVERY day of the window
 * is covered: partial coverage silently shrinks the denominator and inflates the
 * percentage, which is worse than showing none.
 *
 * Cost and depreciation are returned side by side and never summed: the
 * work-centre rate is what production absorbs into stock for running the
 * machine, depreciation is what the asset costs to own, and adding them would
 * count the same machine twice.
 *
 * Dates are YYYY-MM-DD strings compared as strings.
 */

import { addDays } from "@/lib/accounting/report-periods";
import { patternOn, capacityOver, type WorkingHoursRow } from "./working-hours";
import { scheduleFor, periodOf, type AssetTerms } from "@/lib/accounting/fixed-assets";

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface AvailableHours {
  /** Hours the machine could have run, counting only days a dated row covers. */
  hours: number;
  /** Days in the window, and how many of them a dated row covers. */
  days: number;
  coveredDays: number;
  /** True only when every day in the window is covered. */
  complete: boolean;
}

/**
 * Hours available over [from, to].
 *
 * `workingDays` is the machine's own pattern (usually null); a dated row with
 * none of its own inherits it, then Mon-Fri. Undated days are zero: the
 * fallback's hours-per-day is forced to 0 so the slots column can never leak in.
 */
export function availableHours(
  from: string,
  to: string,
  rows: readonly WorkingHoursRow[],
  workingDays: readonly number[] | null,
  holidays: ReadonlySet<string>,
): AvailableHours {
  if (from > to) return { hours: 0, days: 0, coveredDays: 0, complete: false };
  const fallback = { dailyCapacity: 0, workingDays };
  let days = 0;
  let coveredDays = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days++;
    if (patternOn(d, rows, fallback).dated) coveredDays++;
  }
  return {
    hours: capacityOver(from, to, rows, fallback, holidays),
    days, coveredDays, complete: days > 0 && coveredDays === days,
  };
}

export interface Utilisation {
  /** Run hours ÷ available hours, as a percentage. Null when it cannot be stated honestly. */
  pct: number | null;
  /** Why it is null, for the screen to say rather than leave a blank. */
  reason: "ok" | "no-hours-on-record" | "partly-on-record" | "no-available-hours";
}

export function utilisation(runHours: number, available: AvailableHours): Utilisation {
  if (available.coveredDays === 0) return { pct: null, reason: "no-hours-on-record" };
  if (!available.complete) return { pct: null, reason: "partly-on-record" };
  // Fully covered but nothing to work (every day a holiday or a day off).
  if (available.hours <= 0) return { pct: null, reason: "no-available-hours" };
  return { pct: r2((runHours / available.hours) * 100), reason: "ok" };
}

/**
 * Depreciation charged for the months touched by [from, to].
 *
 * A month counts whole, as the straight-line schedule charges it: a window that
 * starts on the 20th still takes that month's full charge. `scheduleFor` already
 * stops at disposal and at full depreciation.
 */
export function depreciationInWindow(terms: AssetTerms, from: string, to: string): number {
  const a = periodOf(from);
  const b = periodOf(to);
  let total = 0;
  for (const r of scheduleFor(terms)) if (r.period >= a && r.period <= b) total += r.amount;
  return r2(total);
}

/** What running the machine is absorbed at: the work centre's own hourly rates × hours run. */
export function runningCost(runHours: number, labourRate: number, overheadRate: number): { labour: number; overhead: number; total: number } {
  const labour = r2(runHours * (Number.isFinite(labourRate) ? labourRate : 0));
  const overhead = r2(runHours * (Number.isFinite(overheadRate) ? overheadRate : 0));
  return { labour, overhead, total: r2(labour + overhead) };
}
