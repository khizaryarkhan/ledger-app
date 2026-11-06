/**
 * Per-resource capacity vs planned vs actual — pure, no `db`. The route
 * (app/api/resources/utilization/route.ts) does all the fetching; this is
 * the computation, extracted so it's actually testable (same reasoning as
 * lib/portal-response.ts / lib/ar-email.ts's appendPayButton — "to test
 * route logic, extract it, don't import the route").
 */

import { overlaps } from "@/lib/resources/assignable";
import { capacityOver, hasDatedHours, leaveOffCapacity, type WorkingHoursRow } from "@/lib/resources/working-hours";

export type UtilizationResource = {
  id: string; name: string; type: string;
  dailyCapacity: number;
  workingDays: number[] | null;
  holidayCalendarId: string | null;
  /** Dated contracted hours (Phase B). Optional: with none, capacity is what it was. */
  workingHours?: readonly WorkingHoursRow[];
};

export type UtilizationAssignment = {
  resourceId: string; startDate: string; endDate: string | null; status: string; allocationPercent: number;
};

export type UtilizationEntry = {
  resourceId: string; timesheetTypeId: string; hours: number;
  /** The entry's date; entries outside [from, to] are ignored. */
  date: string;
};

export type TimesheetTypeInfo = { category: string; billable: boolean };

export type UtilizationRow = {
  resourceId: string; name: string; type: string;
  capacity: number; plannedHours: number; plannedPercent: number;
  actualHours: number; billableHours: number; leaveHours: number;
  utilizationPercent: number; billableUtilizationPercent: number;
  /**
   * Did dated contracted hours decide this capacity, or did it fall back to
   * the resource's current-value column? A percentage is only as trustworthy
   * as its denominator, so the caller can say which it is instead of
   * presenting both with equal confidence.
   */
  capacityOnRecord: boolean;
};

export function computeResourceUtilization(
  resource: UtilizationResource,
  from: string, to: string,
  defaultCalendarId: string | null,
  holidaysByCalendar: ReadonlyMap<string, ReadonlySet<string>>,
  assignments: readonly UtilizationAssignment[],
  entries: readonly UtilizationEntry[],
  typesById: ReadonlyMap<string, TimesheetTypeInfo>,
): UtilizationRow {
  const calendarId = resource.holidayCalendarId ?? defaultCalendarId ?? null;
  const holidaySet = calendarId ? (holidaysByCalendar.get(calendarId) ?? new Set<string>()) : new Set<string>();
  const rows = resource.workingHours ?? [];
  // Only the chosen window: the route used to pass every entry ever logged.
  const resourceEntries = entries.filter(e => e.resourceId === resource.id && e.date >= from && e.date <= to);
  let leaveHours = 0, actualHours = 0, billableHours = 0;
  const leaveDays: { date: string; hours: number }[] = [];
  for (const e of resourceEntries) {
    const type = typesById.get(e.timesheetTypeId);
    if (type?.category === "leave") { leaveHours += e.hours; leaveDays.push(e); continue; }
    // Actual = every non-leave hour (work AND internal), the same rule as the
    // Employee report, so one person never has two utilisation figures.
    actualHours += e.hours;
    if (type?.category === "work" && type.billable) billableHours += e.hours;
  }

  // Booked leave is capacity the person does not have, so it comes off the
  // contracted total — but only up to what each day was worth, so a public
  // holiday (already 0 h on the calendar) is not taken off twice.
  const gross = capacityOver(from, to, rows, resource, holidaySet);
  const capacity = Math.max(0, gross - leaveOffCapacity(leaveDays, rows, resource, holidaySet));

  // Planned = allocation x capacity over the days each booking and the window
  // share — the same rule as plannedHours() in reports.ts. A 2-day booking is
  // 2 days of hours, not the whole window's.
  let plannedHours = 0;
  for (const a of assignments) {
    if (a.resourceId !== resource.id || a.status === "cancelled" || !overlaps(a.startDate, a.endDate, from, to)) continue;
    const start = a.startDate > from ? a.startDate : from;
    const end = a.endDate && a.endDate < to ? a.endDate : to;
    if (start > end) continue;
    plannedHours += ((a.allocationPercent || 0) / 100) * capacityOver(start, end, rows, resource, holidaySet);
  }
  plannedHours = Math.round(plannedHours * 100) / 100;
  const plannedPercent = gross > 0 ? Math.round((plannedHours / gross) * 10000) / 100 : 0;

  return {
    resourceId: resource.id, name: resource.name, type: resource.type,
    capacity: Math.round(capacity * 100) / 100,
    plannedHours, plannedPercent,
    actualHours: Math.round(actualHours * 100) / 100,
    billableHours: Math.round(billableHours * 100) / 100,
    leaveHours: Math.round(leaveHours * 100) / 100,
    utilizationPercent: capacity > 0 ? Math.round((actualHours / capacity) * 10000) / 100 : 0,
    billableUtilizationPercent: capacity > 0 ? Math.round((billableHours / capacity) * 10000) / 100 : 0,
    capacityOnRecord: hasDatedHours(rows, from, to),
  };
}
