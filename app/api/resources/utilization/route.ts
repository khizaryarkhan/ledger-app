/**
 * GET /api/resources/utilization?from=&to=[&resourceId=]
 *   → per resource: capacity (working days in range, minus that resource's
 *     calendar's public holidays, minus approved leave hours), planned hours
 *     (from resource_assignments, forward-looking), actual hours and
 *     billable hours (from time_entries, backward-looking).
 */

import { db } from "@/db";
import { resources, resourceAssignments, timeEntries, timesheetTypes, holidayCalendars, publicHolidays, resourceWorkingHours } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { buildCtx } from "@/lib/resources/time-entries-server";
import { visibleResourceIds } from "@/lib/resources/access";
import { isRealDate } from "@/lib/resources/time-entry-rules";
import { computeResourceUtilization } from "@/lib/resources/utilization";

export async function GET(req: Request) {
  const { error, orgId, session, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const resourceId = searchParams.get("resourceId");
  if (!from || !to) return bad("from and to are required");
  if (!isRealDate(from) || !isRealDate(to) || from > to) return bad("from and to must be valid dates, from on or before to");

  // People only: for equipment daily_capacity is SLOTS/day, not hours (machines
  // have their own report at /resources/machines). And only the people this
  // viewer may see — the same scope as the Compliance and Employee reports.
  const ctx = await buildCtx(orgId!, session, role);
  const visible = visibleResourceIds(ctx.actor, ctx.people);
  const resConds = [eq(resources.orgId, orgId!), eq(resources.status, "active"), eq(resources.type, "person")];
  if (resourceId) resConds.push(eq(resources.id, resourceId));
  const resourceRows = (await db.select().from(resources).where(and(...resConds)))
    .filter(r => visible === "all" || visible.has(r.id));
  if (!resourceRows.length) return ok([]);
  const resourceIds = resourceRows.map(r => r.id);

  const [assignments, entries, types, calendars, hours] = await Promise.all([
    db.select().from(resourceAssignments).where(and(eq(resourceAssignments.orgId, orgId!), inArray(resourceAssignments.resourceId, resourceIds))),
    db.select().from(timeEntries).where(and(eq(timeEntries.orgId, orgId!), inArray(timeEntries.resourceId, resourceIds), inArray(timeEntries.status, ["approved", "posted"]), gte(timeEntries.date, from), lte(timeEntries.date, to))),
    db.select({ id: timesheetTypes.id, category: timesheetTypes.category, billable: timesheetTypes.billable }).from(timesheetTypes).where(eq(timesheetTypes.orgId, orgId!)),
    db.select().from(holidayCalendars).where(eq(holidayCalendars.orgId, orgId!)),
    // Dated contracted hours (Phase B): one read for everyone in scope.
    db.select().from(resourceWorkingHours).where(and(eq(resourceWorkingHours.orgId, orgId!), inArray(resourceWorkingHours.resourceId, resourceIds))),
  ]);
  const hoursByResource = new Map<string, { hoursPerDay: number; workingDays: number[] | null; effectiveFrom: string; effectiveTo: string | null }[]>();
  for (const h of hours) {
    const list = hoursByResource.get(h.resourceId) ?? [];
    list.push({
      hoursPerDay: Number(h.hoursPerDay) || 0, workingDays: h.workingDays ?? null,
      effectiveFrom: h.effectiveFrom, effectiveTo: h.effectiveTo ?? null,
    });
    hoursByResource.set(h.resourceId, list);
  }
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
  const entryRows = entries.map(e => ({ resourceId: e.resourceId, timesheetTypeId: e.timesheetTypeId, hours: Number(e.hours) || 0, date: e.date }));

  const rows = resourceRows.map(r => computeResourceUtilization(
    {
      id: r.id, name: r.name, type: r.type, dailyCapacity: Number(r.dailyCapacity) || 0,
      workingDays: r.workingDays ?? null, holidayCalendarId: r.holidayCalendarId ?? null,
      workingHours: hoursByResource.get(r.id) ?? [],
    },
    from, to, defaultCalendar?.id ?? null, holidaysByCalendar, assignmentRows, entryRows, typeById,
  ));

  return ok(rows);
}
