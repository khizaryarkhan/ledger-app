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
import { computeResourceUtilization } from "@/lib/resources/utilization";

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

  const assignmentRows = assignments.map(a => ({
    resourceId: a.resourceId, startDate: a.startDate, endDate: a.endDate,
    status: a.status, allocationPercent: Number(a.allocationPercent) || 0,
  }));
  const entryRows = entries.map(e => ({ resourceId: e.resourceId, timesheetTypeId: e.timesheetTypeId, hours: Number(e.hours) || 0 }));

  const rows = resourceRows.map(r => computeResourceUtilization(
    { id: r.id, name: r.name, type: r.type, dailyCapacity: Number(r.dailyCapacity) || 0, workingDays: r.workingDays ?? null, holidayCalendarId: r.holidayCalendarId ?? null },
    from, to, defaultCalendar?.id ?? null, holidaysByCalendar, assignmentRows, entryRows, typeById,
  ));

  return ok(rows);
}
