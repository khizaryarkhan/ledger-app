/**
 * Server half of lib/resources/reports.ts: the org-scoped reads the three
 * /api/resources/me report routes share. Every query takes orgId first.
 */

import { db } from "@/db";
import {
  resources, resourceAssignments, timeEntries, timesheetTypes, holidayCalendars, publicHolidays,
  resourceWorkingHours, projects, manufacturingOrders, jobWorkOrders,
} from "@/db/schema";
import { and, eq, gte, inArray, isNull, lte, or } from "drizzle-orm";
import type { AssignmentRow, EntryRow, PersonCalendar } from "./reports";
import type { WorkingHoursRow } from "./working-hours";
import { isRealDate } from "./time-entry-rules";

export type ResourceIds = readonly string[];

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A real calendar date, not just the right shape: "2026-99-99" would otherwise
// reach the date arithmetic and throw.
export const validDate = (v: string | null): v is string => !!v && DATE_RE.test(v) && isRealDate(v);

/** Per-person calendar (capacity, working days, that person's holidays) and cost rate. */
export async function loadCalendars(orgId: string, ids: ResourceIds) {
  const calendars = new Map<string, PersonCalendar>();
  const rates = new Map<string, number | null>();
  const meta = new Map<string, { name: string; dailyCapacity: number }>();
  if (!ids.length) return { calendars, rates, meta };
  const [rows, cals, hours] = await Promise.all([
    db.select({
      id: resources.id, name: resources.name, dailyCapacity: resources.dailyCapacity, workingDays: resources.workingDays,
      holidayCalendarId: resources.holidayCalendarId, costRatePerHour: resources.costRatePerHour,
    }).from(resources).where(and(eq(resources.orgId, orgId), inArray(resources.id, [...ids]))),
    db.select({ id: holidayCalendars.id, isDefault: holidayCalendars.isDefault }).from(holidayCalendars).where(eq(holidayCalendars.orgId, orgId)),
    // Dated contracted hours (Phase B). Loaded for the whole set in one read;
    // a person with no rows simply falls back to their own capacity columns.
    db.select({
      resourceId: resourceWorkingHours.resourceId, hoursPerDay: resourceWorkingHours.hoursPerDay,
      workingDays: resourceWorkingHours.workingDays,
      effectiveFrom: resourceWorkingHours.effectiveFrom, effectiveTo: resourceWorkingHours.effectiveTo,
    }).from(resourceWorkingHours)
      .where(and(eq(resourceWorkingHours.orgId, orgId), inArray(resourceWorkingHours.resourceId, [...ids]))),
  ]);
  const hoursByResource = new Map<string, WorkingHoursRow[]>();
  for (const h of hours) {
    const list = hoursByResource.get(h.resourceId) ?? [];
    list.push({
      hoursPerDay: Number(h.hoursPerDay) || 0, workingDays: h.workingDays ?? null,
      effectiveFrom: h.effectiveFrom, effectiveTo: h.effectiveTo ?? null,
    });
    hoursByResource.set(h.resourceId, list);
  }
  const defaultId = cals.find((c) => c.isDefault)?.id ?? null;
  const calIds = cals.map((c) => c.id);
  const days = calIds.length
    ? await db.select({ calendarId: publicHolidays.calendarId, date: publicHolidays.date }).from(publicHolidays)
        .where(and(eq(publicHolidays.orgId, orgId), inArray(publicHolidays.calendarId, calIds)))
    : [];
  const byCal = new Map<string, Set<string>>();
  for (const h of days) {
    const set = byCal.get(h.calendarId) ?? new Set<string>();
    set.add(h.date);
    byCal.set(h.calendarId, set);
  }
  for (const r of rows) {
    const calId = r.holidayCalendarId ?? defaultId;
    const dailyCapacity = Number(r.dailyCapacity) || 0;
    calendars.set(r.id, {
      dailyCapacity, workingDays: r.workingDays ?? null,
      holidays: (calId && byCal.get(calId)) || new Set<string>(),
      workingHours: hoursByResource.get(r.id) ?? [],
    });
    rates.set(r.id, r.costRatePerHour == null ? null : Number(r.costRatePerHour));
    meta.set(r.id, { name: r.name, dailyCapacity });
  }
  return { calendars, rates, meta };
}

/** Time entries for the given people in [from, to], with the type name and leave flag. */
export async function loadEntries(
  orgId: string, ids: ResourceIds, from: string, to: string, opts: { assignableOnly?: boolean } = {},
): Promise<{ entries: EntryRow[]; typeNames: Map<string, string> }> {
  const typeNames = new Map<string, string>();
  if (!ids.length) return { entries: [], typeNames };
  const conds = [
    eq(timeEntries.orgId, orgId), inArray(timeEntries.resourceId, [...ids]),
    gte(timeEntries.date, from), lte(timeEntries.date, to),
  ];
  const rows = await db.select({
    resourceId: timeEntries.resourceId, date: timeEntries.date, hours: timeEntries.hours, status: timeEntries.status,
    assignableType: timeEntries.assignableType, assignableId: timeEntries.assignableId,
    timesheetTypeId: timeEntries.timesheetTypeId, typeName: timesheetTypes.name, category: timesheetTypes.category,
  }).from(timeEntries)
    .innerJoin(timesheetTypes, eq(timesheetTypes.id, timeEntries.timesheetTypeId))
    .where(and(...conds));
  const entries: EntryRow[] = [];
  for (const r of rows) {
    if (opts.assignableOnly && !(r.assignableType && r.assignableId)) continue;
    typeNames.set(r.timesheetTypeId, r.typeName);
    entries.push({
      resourceId: r.resourceId, date: r.date, hours: Number(r.hours) || 0, status: r.status,
      assignableType: r.assignableType, assignableId: r.assignableId,
      timesheetTypeId: r.timesheetTypeId, isLeave: r.category === "leave",
    });
  }
  return { entries, typeNames };
}

/** Assignments of the given people that overlap [from, to]. */
export async function loadAssignments(orgId: string, ids: ResourceIds, from: string, to: string): Promise<AssignmentRow[]> {
  if (!ids.length) return [];
  const rows = await db.select().from(resourceAssignments).where(and(
    eq(resourceAssignments.orgId, orgId), inArray(resourceAssignments.resourceId, [...ids]),
    lte(resourceAssignments.startDate, to),
    or(isNull(resourceAssignments.endDate), gte(resourceAssignments.endDate, from)),
  ));
  return rows.map((a) => ({
    resourceId: a.resourceId, assignableType: a.assignableType, assignableId: a.assignableId,
    startDate: a.startDate, endDate: a.endDate, allocationPercent: Number(a.allocationPercent) || 0, status: a.status,
  }));
}

export type Label = { label: string; code: string | null };

/** Display names for `type:id` keys of projects, manufacturing orders and job work orders. */
export async function loadLabels(orgId: string, keys: Iterable<string>): Promise<Map<string, Label>> {
  const byType: Record<string, string[]> = { project: [], manufacturing_order: [], job_work_order: [] };
  for (const k of keys) {
    const i = k.indexOf(":");
    const t = k.slice(0, i);
    if (byType[t]) byType[t].push(k.slice(i + 1));
  }
  const out = new Map<string, Label>();
  const [p, m, j] = await Promise.all([
    byType.project.length
      ? db.select({ id: projects.id, name: projects.name, code: projects.code }).from(projects)
          .where(and(eq(projects.orgId, orgId), inArray(projects.id, byType.project)))
      : [],
    byType.manufacturing_order.length
      ? db.select({ id: manufacturingOrders.id, moNo: manufacturingOrders.moNo }).from(manufacturingOrders)
          .where(and(eq(manufacturingOrders.orgId, orgId), inArray(manufacturingOrders.id, byType.manufacturing_order)))
      : [],
    byType.job_work_order.length
      ? db.select({ id: jobWorkOrders.id, docNumber: jobWorkOrders.docNumber }).from(jobWorkOrders)
          .where(and(eq(jobWorkOrders.orgId, orgId), inArray(jobWorkOrders.id, byType.job_work_order)))
      : [],
  ]);
  for (const r of p) out.set(`project:${r.id}`, { label: r.name, code: r.code });
  for (const r of m) out.set(`manufacturing_order:${r.id}`, { label: r.moNo ?? "Manufacturing order", code: r.moNo });
  for (const r of j) out.set(`job_work_order:${r.id}`, { label: r.docNumber ?? "Job work order", code: r.docNumber });
  return out;
}

export function labelFor(key: string, labels: ReadonlyMap<string, Label>, typeNames: ReadonlyMap<string, string>): string {
  if (key.startsWith("type:")) return typeNames.get(key.slice(5)) ?? "Other time";
  return labels.get(key)?.label ?? "Removed record";
}
