/**
 * Capacity = working days in a range, minus public holidays — pure, no `db`.
 * Used by the Utilization report to turn a calendar range into "how many
 * hours could this resource actually have worked", before comparing it to
 * planned (resource_assignments) or actual (time_entries) hours.
 */

function isoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0=Sun..6=Sat
  return js === 0 ? 7 : js;
}

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${dt.getUTCFullYear().toString().padStart(4, "0")}-${(dt.getUTCMonth() + 1).toString().padStart(2, "0")}-${dt.getUTCDate().toString().padStart(2, "0")}`;
}

export const DEFAULT_WORKING_DAYS = [1, 2, 3, 4, 5]; // Mon-Fri

/** Count of working days in [from, to] inclusive, excluding dates in holidayDates. */
export function workingDaysInRange(from: string, to: string, workingDays: readonly number[], holidayDates: ReadonlySet<string>): number {
  const days = workingDays.length ? workingDays : DEFAULT_WORKING_DAYS;
  let count = 0;
  let cursor = from;
  while (cursor <= to) {
    if (days.includes(isoWeekday(cursor)) && !holidayDates.has(cursor)) count++;
    cursor = addDays(cursor, 1);
  }
  return count;
}
