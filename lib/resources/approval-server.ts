/**
 * The db half of Phase A: who leads a project, what the plan said for the week
 * being approved, and the return conversation.
 *
 * Kept out of time-entries-server.ts so neither file grows past the 800-line
 * ceiling, and deliberately free of that module's `TimeCtx` so the dependency
 * runs one way only (time-entries-server -> here) with no import cycle. Every
 * function takes orgId first and plain ids after.
 *
 * Dates are YYYY-MM-DD strings end to end ("a date is a date"): a week is
 * derived with weekStartOf/addDays string maths, never by building a Date from
 * an entry's own date.
 */

import { db } from "@/db";
import { projects, resources, resourceAssignments, timeEntries, timesheetReturns, users } from "@/db/schema";
import { and, eq, gte, inArray, isNull, lte, ne, or, desc, sql } from "drizzle-orm";
import { addDays } from "@/lib/accounting/report-periods";
import { weekStartOf } from "./time-entry-rules";
import { loadCalendars } from "./reports-server";
import { plannedHours, round2, type AssignmentRow } from "./reports";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Leads ────────────────────────────────────────────────────────────────────

/**
 * projectId -> the resource who leads it, for the given projects.
 *
 * An INACTIVE lead is left out, which drops that project back to the line
 * manager. A lead who has left must not be able to strand their team's
 * timesheets behind an approval nobody can give.
 */
export async function leadsForProjects(orgId: string, projectIds: readonly string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(projectIds.filter((id) => UUID_RE.test(id))));
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: projects.id, lead: projects.leadResourceId })
    .from(projects)
    .innerJoin(resources, eq(resources.id, projects.leadResourceId))
    .where(and(
      eq(projects.orgId, orgId),
      inArray(projects.id, ids),
      eq(resources.orgId, orgId),
      eq(resources.status, "active"),
    ));
  const out = new Map<string, string>();
  for (const r of rows) if (r.lead) out.set(r.id, r.lead);
  return out;
}

/** The lead map covering whatever these entries point at. Non-project rows cost nothing. */
export async function leadsForEntries(
  orgId: string,
  rows: readonly { assignableType: string | null; assignableId: string | null }[],
): Promise<Map<string, string>> {
  const ids = rows.filter((r) => r.assignableType === "project" && r.assignableId).map((r) => r.assignableId as string);
  return leadsForProjects(orgId, ids);
}

/** The projects this person leads — what widens their approval queue beyond their own reports. */
export async function projectsLedBy(orgId: string, resourceId: string): Promise<string[]> {
  if (!UUID_RE.test(resourceId)) return [];
  const rows = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.leadResourceId, resourceId)));
  return rows.map((r) => r.id);
}

// ── Plan vs actual for the week being approved ───────────────────────────────

export interface PlanActualKey { resourceId: string; assignableType: string | null; assignableId: string | null; date: string }
export interface PlanActual { planned: number; actual: number }

/** `resourceId|assignableId|weekStart` — the key both sides agree on. */
export const planActualKey = (resourceId: string, assignableId: string, weekStart: string): string =>
  `${resourceId}|${assignableId}|${weekStart}`;

/**
 * Planned and actual hours per person, booking and WEEK, for the entries on an
 * approval queue.
 *
 * Each entry is set against the plan for ITS OWN week, not for the week the
 * approver happens to be looking at one — the same bug EDC's own approval page
 * shipped with and had to fix.
 *
 * `actual` counts every non-rejected line that person has on that booking in
 * that week, not only the submitted ones on screen, because the plan covers
 * the whole week and a part-submitted week would otherwise read as under plan.
 */
export async function planVsActual(orgId: string, keys: readonly PlanActualKey[]): Promise<Map<string, PlanActual>> {
  const out = new Map<string, PlanActual>();
  const booked = keys.filter((k) => k.assignableType && k.assignableId);
  if (booked.length === 0) return out;

  const weeks = new Map<string, { resourceId: string; assignableType: string; assignableId: string; weekStart: string }>();
  for (const k of booked) {
    const weekStart = weekStartOf(k.date);
    const key = planActualKey(k.resourceId, k.assignableId as string, weekStart);
    if (!weeks.has(key)) {
      weeks.set(key, { resourceId: k.resourceId, assignableType: k.assignableType as string, assignableId: k.assignableId as string, weekStart });
    }
  }

  const resourceIds = Array.from(new Set(Array.from(weeks.values()).map((w) => w.resourceId)));
  const starts = Array.from(weeks.values()).map((w) => w.weekStart).sort();
  const from = starts[0];
  const to = addDays(starts[starts.length - 1], 6);

  const { calendars } = await loadCalendars(orgId, resourceIds);

  const assignmentRows = await db.select().from(resourceAssignments).where(and(
    eq(resourceAssignments.orgId, orgId),
    inArray(resourceAssignments.resourceId, resourceIds),
    ne(resourceAssignments.status, "cancelled"),
    lte(resourceAssignments.startDate, to),
    or(isNull(resourceAssignments.endDate), gte(resourceAssignments.endDate, from)),
  ));

  // Rejected time is not work anybody is standing behind, so it is not "actual".
  const loggedRows = await db.select({
    resourceId: timeEntries.resourceId, date: timeEntries.date, hours: timeEntries.hours,
    assignableId: timeEntries.assignableId,
  }).from(timeEntries).where(and(
    eq(timeEntries.orgId, orgId),
    inArray(timeEntries.resourceId, resourceIds),
    gte(timeEntries.date, from), lte(timeEntries.date, to),
    ne(timeEntries.status, "rejected"),
  ));

  const actual = new Map<string, number>();
  for (const l of loggedRows) {
    if (!l.assignableId) continue;
    const key = planActualKey(l.resourceId, l.assignableId, weekStartOf(l.date));
    actual.set(key, (actual.get(key) ?? 0) + Number(l.hours));
  }

  for (const [key, w] of weeks) {
    const cal = calendars.get(w.resourceId);
    const window = { from: w.weekStart, to: addDays(w.weekStart, 6) };
    let planned = 0;
    if (cal) {
      for (const a of assignmentRows) {
        if (a.resourceId !== w.resourceId) continue;
        if (a.assignableType !== w.assignableType || a.assignableId !== w.assignableId) continue;
        const row: AssignmentRow = {
          resourceId: a.resourceId, assignableType: a.assignableType, assignableId: a.assignableId,
          startDate: a.startDate, endDate: a.endDate,
          allocationPercent: Number(a.allocationPercent) || 0, status: a.status,
        };
        planned += plannedHours(row, cal, window);
      }
    }
    out.set(key, { planned: round2(planned), actual: round2(actual.get(key) ?? 0) });
  }
  return out;
}

// ── The return conversation ──────────────────────────────────────────────────

export interface ReturnRow {
  id: string; timeEntryId: string; reason: string;
  acknowledgedAt: string | null; response: string | null; respondedAt: string | null; createdAt: string;
  date: string; hours: number; entryStatus: string; returnedByName: string | null;
}

/** Called by rejectEntry: a rejection opens a thread rather than only stamping a reason. */
export async function openReturn(
  orgId: string,
  args: { timeEntryId: string; resourceId: string; returnedBy: string | null; reason: string },
): Promise<void> {
  await db.insert(timesheetReturns).values({
    orgId, timeEntryId: args.timeEntryId, resourceId: args.resourceId,
    returnedBy: args.returnedBy, reason: args.reason,
  });
}

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** A person's own returns, newest first. Theirs alone — resourceId is never taken from a request. */
export async function returnsFor(orgId: string, resourceId: string, limit = 50): Promise<ReturnRow[]> {
  if (!UUID_RE.test(resourceId)) return [];
  const rows = await db.select({
    id: timesheetReturns.id, timeEntryId: timesheetReturns.timeEntryId, reason: timesheetReturns.reason,
    acknowledgedAt: timesheetReturns.acknowledgedAt, response: timesheetReturns.response,
    respondedAt: timesheetReturns.respondedAt, createdAt: timesheetReturns.createdAt,
    date: timeEntries.date, hours: timeEntries.hours, entryStatus: timeEntries.status,
    returnedByName: users.name,
  }).from(timesheetReturns)
    .innerJoin(timeEntries, eq(timeEntries.id, timesheetReturns.timeEntryId))
    .leftJoin(users, eq(users.id, timesheetReturns.returnedBy))
    .where(and(eq(timesheetReturns.orgId, orgId), eq(timesheetReturns.resourceId, resourceId)))
    .orderBy(desc(timesheetReturns.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id, timeEntryId: r.timeEntryId, reason: r.reason,
    acknowledgedAt: iso(r.acknowledgedAt), response: r.response, respondedAt: iso(r.respondedAt),
    createdAt: iso(r.createdAt) as string,
    date: r.date, hours: Number(r.hours), entryStatus: r.entryStatus, returnedByName: r.returnedByName ?? null,
  }));
}

export type ReturnOutcome = { ok: true } | { ok: false; error: string; status: number };

/**
 * Acknowledge, and optionally reply to, one of your OWN returns.
 *
 * Scoped by resourceId in the WHERE clause, not checked after the read, so a
 * guessed id belonging to someone else updates nothing rather than leaking
 * that it exists. Acknowledging twice is not an error — the first stamp stands.
 */
export async function answerReturn(
  orgId: string, resourceId: string, id: string, response: string | null,
): Promise<ReturnOutcome> {
  if (!UUID_RE.test(id)) return { ok: false, error: "Return not found", status: 404 };
  const patch: Record<string, unknown> = { acknowledgedAt: sql`coalesce(${timesheetReturns.acknowledgedAt}, now())` };
  if (response !== null) {
    const text = response.trim();
    if (!text) return { ok: false, error: "A reply cannot be empty", status: 400 };
    patch.response = text.slice(0, 2000);
    patch.respondedAt = new Date();
  }
  const rows = await db.update(timesheetReturns).set(patch)
    .where(and(eq(timesheetReturns.id, id), eq(timesheetReturns.orgId, orgId), eq(timesheetReturns.resourceId, resourceId)))
    .returning({ id: timesheetReturns.id });
  if (rows.length === 0) return { ok: false, error: "Return not found", status: 404 };
  return { ok: true };
}

export interface ApproverReply {
  id: string; personName: string; reason: string; response: string; respondedAt: string | null; date: string;
}

/** Replies to returns this approver opened — the other half of the conversation. */
export async function repliesForApprover(orgId: string, userId: string | null, limit = 20): Promise<ApproverReply[]> {
  if (!userId || !UUID_RE.test(userId)) return [];
  const rows = await db.select({
    id: timesheetReturns.id, reason: timesheetReturns.reason, response: timesheetReturns.response,
    respondedAt: timesheetReturns.respondedAt, date: timeEntries.date, personName: resources.name,
  }).from(timesheetReturns)
    .innerJoin(timeEntries, eq(timeEntries.id, timesheetReturns.timeEntryId))
    .innerJoin(resources, eq(resources.id, timesheetReturns.resourceId))
    .where(and(
      eq(timesheetReturns.orgId, orgId),
      eq(timesheetReturns.returnedBy, userId),
      ne(timesheetReturns.response, ""),
    ))
    .orderBy(desc(timesheetReturns.respondedAt))
    .limit(limit);
  return rows
    .filter((r) => r.response)
    .map((r) => ({
      id: r.id, personName: r.personName, reason: r.reason, response: r.response as string,
      respondedAt: iso(r.respondedAt), date: r.date,
    }));
}
