/**
 * GET /api/resources/utilization?from=&to=[&resourceId=]
 *   → per resource: capacity (working days in range, minus that resource's
 *     calendar's public holidays, minus approved leave hours), planned hours
 *     (from resource_assignments, forward-looking), actual hours and
 *     billable hours (from time_entries, backward-looking).
 */

import { db } from "@/db";
import { resources, resourceAssignments, timeEntries, timesheetTypes, holidayCalendars, publicHolidays } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, inArray } from "drizzle-orm";
import { overlaps } from "@/lib/resources/assignable";
import { workingDaysInRange, DEFAULT_WORKING_DAYS } from "@/lib/resources/capacity";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const resourceId = searchParams.get("resourceId");
  if (!from || !to) return bad("from and to are required");

  const resConds = [eq(resources.orgId, orgId!), eq(resources.status, "active")];
  if (resourceId) resConds.push(eq(resources.id, resourceId));
  const resourceRows = await db.select().from(resources).where(and(...resConds));
  if (!resourceRows.length) return ok([]);
  const resourceIds = resourceRows.map(r => r.id);

  const [assignments, entries, types, calendars] = await Promise.all([
    db.select().from(resourceAssignments).where(and(eq(resourceAssignments.orgId, orgId!), inArray(resourceAssignments.resourceId, resourceIds))),
    db.select().from(timeEntries).where(and(eq(timeEntries.orgId, orgId!), inArray(timeEntries.resourceId, resourceIds), inArray(timeEntries.status, ["approved", "posted"]))),
    db.select({ id: timesheetTypes.id, category: timesheetTypes.category, billable: timesheetTypes.billable }).from(timesheetTypes).where(eq(timesheetTypes.orgId, orgId!)),
    db.select().from(holidayCalendars).where(eq(holidayCalendars.orgId, orgId!)),
  ]);
  const typeById = new Map(types.map(t => [t.id, t]));
  const defaultCalendar = calendars.find(c => c.isDefault) ?? null;
  const calendarIds = [...new Set([...calendars.map(c => c.id)])];
  const holidays = calendarIds.length
    ? await db.select({ calendarId: publicHolidays.calendarId, date: publicHolidays.date }).from(publicHolidays)
        .where(and(eq(publicHolidays.orgId, orgId!), inArray(publicHolidays.calendarId, calendarIds)))
    : [];
  const holidaysByCalendar = new Map<string, Set<string>>();
  for (const h of holidays) {
    if (!holidaysByCalendar.has(h.calendarId)) holidaysByCalendar.set(h.calendarId, new Set());
    holidaysByCalendar.get(h.calendarId)!.add(h.date);
  }

  const rows = resourceRows.map(r => {
    const calendarId = r.holidayCalendarId ?? defaultCalendar?.id ?? null;
    const holidaySet = calendarId ? holidaysByCalendar.get(calendarId) ?? new Set<string>() : new Set<string>();
    const workingDays = r.workingDays && r.workingDays.length ? r.workingDays : DEFAULT_WORKING_DAYS;
    const dailyCapacity = Number(r.dailyCapacity) || 0;
    const workingDayCount = workingDaysInRange(from, to, workingDays, holidaySet);

    const resourceEntries = entries.filter(e => e.resourceId === r.id);
    let leaveHours = 0, actualHours = 0, billableHours = 0;
    for (const e of resourceEntries) {
      const type = typeById.get(e.timesheetTypeId);
      const hours = Number(e.hours) || 0;
      if (type?.category === "leave") leaveHours += hours;
      else if (type?.category === "work") { actualHours += hours; if (type.billable) billableHours += hours; }
    }

    const capacity = Math.max(0, workingDayCount * dailyCapacity - leaveHours);

    const resourceAssignmentsOverlapping = assignments.filter(a => a.resourceId === r.id && a.status !== "cancelled" && overlaps(a.startDate, a.endDate, from, to));
    const plannedPercent = resourceAssignmentsOverlapping.reduce((s, a) => s + (Number(a.allocationPercent) || 0), 0);
    const plannedHours = Math.round((capacity * plannedPercent) / 100 * 100) / 100;

    return {
      resourceId: r.id, name: r.name, type: r.type,
      capacity: Math.round(capacity * 100) / 100,
      plannedHours, plannedPercent,
      actualHours: Math.round(actualHours * 100) / 100,
      billableHours: Math.round(billableHours * 100) / 100,
      leaveHours: Math.round(leaveHours * 100) / 100,
      utilizationPercent: capacity > 0 ? Math.round((actualHours / capacity) * 10000) / 100 : 0,
      billableUtilizationPercent: capacity > 0 ? Math.round((billableHours / capacity) * 10000) / 100 : 0,
    };
  });

  return ok(rows);
}
