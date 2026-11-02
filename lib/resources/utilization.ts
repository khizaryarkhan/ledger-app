/**
 * Per-resource capacity vs planned vs actual — pure, no `db`. The route
 * (app/api/resources/utilization/route.ts) does all the fetching; this is
 * the computation, extracted so it's actually testable (same reasoning as
 * lib/portal-response.ts / lib/ar-email.ts's appendPayButton — "to test
 * route logic, extract it, don't import the route").
 */

import { overlaps } from "@/lib/resources/assignable";
import { capacityOver, hasDatedHours, type WorkingHoursRow } from "@/lib/resources/working-hours";

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
  const resourceEntries = entries.filter(e => e.resourceId === resource.id);
  let leaveHours = 0, actualHours = 0, billableHours = 0;
  for (const e of resourceEntries) {
    const type = typesById.get(e.timesheetTypeId);
    if (type?.category === "leave") leaveHours += e.hours;
    else if (type?.category === "work") { actualHours += e.hours; if (type.billable) billableHours += e.hours; }
  }

  // Booked leave is capacity the person does not have, so it comes off the
  // contracted total rather than counting against them as idle time.
  const capacity = Math.max(0, capacityOver(from, to, rows, resource, holidaySet) - leaveHours);

  const overlapping = assignments.filter(a => a.resourceId === resource.id && a.status !== "cancelled" && overlaps(a.startDate, a.endDate, from, to));
  const plannedPercent = overlapping.reduce((s, a) => s + (a.allocationPercent || 0), 0);
  const plannedHours = Math.round((capacity * plannedPercent) / 100 * 100) / 100;

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
