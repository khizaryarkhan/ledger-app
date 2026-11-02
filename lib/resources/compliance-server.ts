/**
 * The db half of the timesheet-compliance report.
 *
 * Expected hours come from Phase B's dated contracted hours via the same
 * `capacityOver` every other capacity figure uses, so this report and the
 * Utilization report can never disagree about what a person's week was.
 */

import { db } from "@/db";
import { resources, timeEntries, timesheetTypes } from "@/db/schema";
import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { addDays } from "@/lib/accounting/report-periods";
import { weekStartOf } from "./time-entry-rules";
import { loadCalendars } from "./reports-server";
import { capacityOver, hasDatedHours } from "./working-hours";
import {
  buildCompliance, weekKey, ACTIVE_WITHIN_WEEKS,
  type ComplianceResult, type Expected, type ComplianceEntry,
} from "./compliance";

/** Bounded because the expected figure walks days per person per week. */
export const MAX_WEEKS = 26;
export const DEFAULT_WEEKS = 6;

const weekEndOf = (weekStart: string): string => addDays(weekStart, 6);

/** The `n` Mondays ending with the week containing `endDate`, oldest first. */
export function weeksEndingAt(endDate: string, n: number): string[] {
  const last = weekStartOf(endDate);
  return Array.from({ length: n }, (_, i) => addDays(last, -7 * (n - 1 - i)));
}

export async function loadCompliance(
  orgId: string,
  visible: ReadonlySet<string> | "all",
  endDate: string,
  weeksBack: number,
): Promise<ComplianceResult & { weeks: string[] }> {
  const weeks = weeksEndingAt(endDate, Math.min(Math.max(1, weeksBack), MAX_WEEKS));
  const from = weeks[0];
  const to = weekEndOf(weeks[weeks.length - 1]);
  // Activity reaches further back than the report itself, so somebody who was
  // simply on a long holiday is not mistaken for a leaver.
  const activeFrom = addDays(to, -7 * ACTIVE_WITHIN_WEEKS);
  const queryFrom = activeFrom < from ? activeFrom : from;

  const peopleRows = await db.select({ id: resources.id, name: resources.name }).from(resources)
    .where(and(eq(resources.orgId, orgId), eq(resources.type, "person"), eq(resources.status, "active")));
  const people = peopleRows
    .filter((p) => visible === "all" || visible.has(p.id))
    .map((p) => ({ resourceId: p.id, name: p.name }));
  if (people.length === 0) return { rows: [], dormant: [], clear: 0, weeks };

  const ids = people.map((p) => p.resourceId);

  const [entryRows, startedRows, { calendars }] = await Promise.all([
    db.select({
      resourceId: timeEntries.resourceId, date: timeEntries.date, hours: timeEntries.hours,
      status: timeEntries.status, isPublicHoliday: timesheetTypes.isPublicHoliday,
    }).from(timeEntries)
      .innerJoin(timesheetTypes, eq(timesheetTypes.id, timeEntries.timesheetTypeId))
      .where(and(
        eq(timeEntries.orgId, orgId), inArray(timeEntries.resourceId, ids),
        gte(timeEntries.date, queryFrom), lte(timeEntries.date, to),
      )),
    // First ever logged day, over ALL history — not just this window. Taking
    // the window's own earliest entry would quietly excuse a long-tenured
    // person for every week before they next happened to log something.
    db.select({ resourceId: timeEntries.resourceId, first: sql<string>`min(${timeEntries.date})` })
      .from(timeEntries)
      .where(and(eq(timeEntries.orgId, orgId), inArray(timeEntries.resourceId, ids)))
      .groupBy(timeEntries.resourceId),
    loadCalendars(orgId, ids),
  ]);

  const entries: ComplianceEntry[] = entryRows.map((e) => ({
    resourceId: e.resourceId, date: e.date, hours: Number(e.hours) || 0,
    status: e.status, isPublicHoliday: !!e.isPublicHoliday,
  }));

  const startedOn = new Map<string, string | null>(startedRows.map((r) => [r.resourceId, r.first ?? null]));

  const expected = new Map<string, Expected>();
  for (const id of ids) {
    const cal = calendars.get(id);
    if (!cal) continue;
    const rows = cal.workingHours ?? [];
    for (const weekStart of weeks) {
      const weekEnd = weekEndOf(weekStart);
      expected.set(weekKey(id, weekStart), {
        hours: capacityOver(weekStart, weekEnd, rows, cal, cal.holidays),
        onRecord: hasDatedHours(rows, weekStart, weekEnd),
      });
    }
  }

  const result = buildCompliance({ weeks, weekEndOf, people, entries, expected, startedOn, activeFrom });
  return { ...result, weeks };
}
