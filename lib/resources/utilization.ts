/**
 * Per-resource capacity vs planned vs actual — pure, no `db`. The route
 * (app/api/resources/utilization/route.ts) does all the fetching; this is
 * the computation, extracted so it's actually testable (same reasoning as
 * lib/portal-response.ts / lib/ar-email.ts's appendPayButton — "to test
 * route logic, extract it, don't import the route").
 */

import { overlaps } from "@/lib/resources/assignable";
import { workingDaysInRange, DEFAULT_WORKING_DAYS } from "@/lib/resources/capacity";

export type UtilizationResource = {
  id: string; name: string; type: string;
  dailyCapacity: number;
  workingDays: number[] | null;
  holidayCalendarId: string | null;
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
  const workingDays = resource.workingDays && resource.workingDays.length ? resource.workingDays : DEFAULT_WORKING_DAYS;
  const workingDayCount = workingDaysInRange(from, to, workingDays, holidaySet);

  const resourceEntries = entries.filter(e => e.resourceId === resource.id);
  let leaveHours = 0, actualHours = 0, billableHours = 0;
  for (const e of resourceEntries) {
    const type = typesById.get(e.timesheetTypeId);
    if (type?.category === "leave") leaveHours += e.hours;
    else if (type?.category === "work") { actualHours += e.hours; if (type.billable) billableHours += e.hours; }
  }

  const capacity = Math.max(0, workingDayCount * resource.dailyCapacity - leaveHours);

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
  };
}
