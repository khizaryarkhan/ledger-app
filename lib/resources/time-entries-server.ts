/**
 * The ONE implementation of time-entry create / edit / delete / submit /
 * approve / reject, used by the admin routes (/api/resources/time-entries/**)
 * and the self-service routes (/api/resources/me/**) alike, so the two can
 * never enforce different rules.
 *
 * Every function takes a `TimeCtx` (org + user + the caller's Actor and the
 * people list they were resolved against) and returns a Result: a refusal is
 * a value with an HTTP status, never a throw. neon-http has no transactions,
 * so everything is validated before the first write, and bulk operations
 * handle each id on its own and report each outcome.
 */

import { db } from "@/db";
import {
  timeEntries, timesheetTypes, leavePolicies, leaveBalanceEntries,
  projects, manufacturingOrders, jobWorkOrders, apItems, resources,
} from "@/db/schema";
import { and, eq, gte, lte, inArray, desc, ne, or, sql } from "drizzle-orm";
import { isAssignableType, type AssignableType } from "./assignable";
import { canEnterTimeFor, canView, visibleResourceIds, type Actor } from "./access";
import { resolveActor, type Person } from "./access-server";
import {
  isRealDate, parseHours, parseReason, exceedsDay, isEditableStatus,
  isSubmittableStatus, decideEntry, MAX_HOURS_PER_DAY,
} from "./time-entry-rules";
import { addDays } from "@/lib/accounting/report-periods";
import {
  leadsForEntries, projectsLedBy, openReturn,
  planVsActual, planActualKey,
} from "./approval-server";
import { weekStartOf } from "./time-entry-rules";
import { NextResponse } from "next/server";

export type TimeEntryRow = typeof timeEntries.$inferSelect;

export interface TimeCtx {
  orgId: string;
  userId: string | null;
  actor: Actor;
  people: Person[];
  me: Person | null;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string; status: number };
const fail = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status });

/** Turn a Result into the route response: the value, or { error } with its status. */
export function respond<T>(res: Result<T>): NextResponse {
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
  return NextResponse.json(res.value);
}

export async function buildCtx(orgId: string, session: any, role: string | null | undefined): Promise<TimeCtx> {
  const userId: string | null = session?.user?.id ?? null;
  const { actor, people, me } = await resolveActor(orgId, userId, role);
  return { orgId, userId, actor, people, me };
}

// ── Assignable validation ────────────────────────────────────────────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function assignableExists(orgId: string, type: AssignableType, id: string): Promise<boolean> {
  if (!UUID_RE.test(id)) return false;
  if (type === "project") {
    const [r] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, id), eq(projects.orgId, orgId))).limit(1);
    return !!r;
  }
  if (type === "manufacturing_order") {
    const [r] = await db.select({ id: manufacturingOrders.id }).from(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))).limit(1);
    return !!r;
  }
  const [r] = await db.select({ id: jobWorkOrders.id }).from(jobWorkOrders).where(and(eq(jobWorkOrders.id, id), eq(jobWorkOrders.orgId, orgId))).limit(1);
  return !!r;
}

/** Resolve type + assignable into the pair to store, or a refusal. */
async function resolveBooking(
  orgId: string, typeId: string, assignableType: unknown, assignableId: unknown,
): Promise<Result<{ assignableType: string | null; assignableId: string | null }>> {
  if (!UUID_RE.test(typeId)) return fail("That timesheet type was not found in this organisation.");
  const [type] = await db.select().from(timesheetTypes)
    .where(and(eq(timesheetTypes.id, typeId), eq(timesheetTypes.orgId, orgId))).limit(1);
  if (!type) return fail("That timesheet type was not found in this organisation.");
  if (type.status !== "active") return fail(`"${type.name}" is inactive and cannot be used for new time.`);
  if (!type.requiresAssignable) return { ok: true, value: { assignableType: null, assignableId: null } };
  if (!isAssignableType(assignableType) || typeof assignableId !== "string" || !assignableId) {
    return fail(`"${type.name}" requires a Project, Manufacturing Order or Job Work Order to be selected.`);
  }
  if (!(await assignableExists(orgId, assignableType, assignableId))) {
    return fail("That Project, Manufacturing Order or Job Work Order was not found in this organisation.");
  }
  return { ok: true, value: { assignableType, assignableId } };
}

async function hoursLoggedOn(orgId: string, resourceId: string, date: string, excludeId?: string): Promise<number> {
  const conds = [eq(timeEntries.orgId, orgId), eq(timeEntries.resourceId, resourceId), eq(timeEntries.date, date)];
  if (excludeId) conds.push(ne(timeEntries.id, excludeId));
  const [r] = await db.select({ total: sql<string>`coalesce(sum(${timeEntries.hours}), 0)` }).from(timeEntries).where(and(...conds));
  return Number(r?.total ?? 0);
}

async function loadEntry(orgId: string, id: string): Promise<TimeEntryRow | null> {
  if (!UUID_RE.test(id)) return null;
  const [row] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, id), eq(timeEntries.orgId, orgId))).limit(1);
  return row ?? null;
}

// ── List ─────────────────────────────────────────────────────────────────────

export interface ListFilters { resourceId?: string | null; status?: string | null; from?: string | null; to?: string | null }

/** Entries the caller may see. An explicit resourceId they cannot view is refused, not silently emptied. */
export async function listEntries(ctx: TimeCtx, f: ListFilters): Promise<Result<TimeEntryRow[]>> {
  const visible = visibleResourceIds(ctx.actor, ctx.people);
  if (f.resourceId && !canView(ctx.actor, f.resourceId, ctx.people)) return fail("You cannot view that person's time", 403);
  if (visible !== "all" && visible.size === 0) return { ok: true, value: [] };

  const conds = [eq(timeEntries.orgId, ctx.orgId)];
  if (visible !== "all") conds.push(inArray(timeEntries.resourceId, Array.from(visible)));
  if (f.resourceId) conds.push(eq(timeEntries.resourceId, f.resourceId));
  if (f.status) conds.push(eq(timeEntries.status, f.status));
  if (f.from) { if (!isRealDate(f.from)) return fail("from must be YYYY-MM-DD"); conds.push(gte(timeEntries.date, f.from)); }
  if (f.to) { if (!isRealDate(f.to)) return fail("to must be YYYY-MM-DD"); conds.push(lte(timeEntries.date, f.to)); }
  const rows = await db.select().from(timeEntries).where(and(...conds)).orderBy(desc(timeEntries.date));
  return { ok: true, value: rows };
}

// ── Create / edit / delete ───────────────────────────────────────────────────

export interface EntryInput {
  resourceId?: unknown; date?: unknown; hours?: unknown; timesheetTypeId?: unknown;
  assignableType?: unknown; assignableId?: unknown; description?: unknown;
}

export async function createEntry(ctx: TimeCtx, input: EntryInput): Promise<Result<TimeEntryRow>> {
  const resourceId = input.resourceId;
  if (typeof resourceId !== "string" || !resourceId) return fail("resourceId is required");
  if (!canEnterTimeFor(ctx.actor, resourceId)) return fail("You can only log your own time", 403);
  const person = ctx.people.find((p) => p.id === resourceId);
  if (!person) return fail("Time can only be logged for a person resource");
  if (person.status !== "active") return fail("That person is inactive");

  if (!isRealDate(input.date)) return fail("A valid date (YYYY-MM-DD) is required");
  const h = parseHours(input.hours);
  if ("error" in h) return fail(h.error);
  if (typeof input.timesheetTypeId !== "string" || !input.timesheetTypeId) return fail("timesheetTypeId is required");

  const booking = await resolveBooking(ctx.orgId, input.timesheetTypeId, input.assignableType, input.assignableId);
  if ("error" in booking) return booking;
  if (exceedsDay(await hoursLoggedOn(ctx.orgId, resourceId, input.date), h.hours)) {
    return fail(`That would put more than ${MAX_HOURS_PER_DAY} hours on ${input.date}.`);
  }

  const [row] = await db.insert(timeEntries).values({
    orgId: ctx.orgId, resourceId, date: input.date, hours: h.hours.toFixed(2),
    timesheetTypeId: input.timesheetTypeId,
    assignableType: booking.value.assignableType, assignableId: booking.value.assignableId,
    description: input.description ? String(input.description).slice(0, 255) : null,
    status: "draft", createdBy: ctx.userId,
  }).returning();
  return { ok: true, value: row };
}

export async function updateEntry(ctx: TimeCtx, id: string, input: EntryInput, opts: { selfOnly?: boolean } = {}): Promise<Result<TimeEntryRow>> {
  const existing = await loadEntry(ctx.orgId, id);
  if (!existing) return fail("Time entry not found", 404);
  if (!canEnterTimeFor(ctx.actor, existing.resourceId) || (opts.selfOnly && existing.resourceId !== ctx.actor.resourceId)) {
    return fail("You can only edit your own time", 403);
  }
  if (!isEditableStatus(existing.status)) return fail("Only a Draft or Rejected entry can be edited", 409);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  let date = existing.date;
  let hours = Number(existing.hours);
  if (input.date !== undefined) {
    if (!isRealDate(input.date)) return fail("A valid date (YYYY-MM-DD) is required");
    date = input.date; patch.date = date;
  }
  if (input.hours !== undefined) {
    const h = parseHours(input.hours);
    if ("error" in h) return fail(h.error);
    hours = h.hours; patch.hours = hours.toFixed(2);
  }
  if (input.date !== undefined || input.hours !== undefined) {
    if (exceedsDay(await hoursLoggedOn(ctx.orgId, existing.resourceId, date, existing.id), hours)) {
      return fail(`That would put more than ${MAX_HOURS_PER_DAY} hours on ${date}.`);
    }
  }
  if (input.timesheetTypeId !== undefined || input.assignableType !== undefined || input.assignableId !== undefined) {
    const typeId = input.timesheetTypeId !== undefined ? input.timesheetTypeId : existing.timesheetTypeId;
    if (typeof typeId !== "string" || !typeId) return fail("timesheetTypeId is required");
    const booking = await resolveBooking(
      ctx.orgId, typeId,
      input.assignableType !== undefined ? input.assignableType : existing.assignableType,
      input.assignableId !== undefined ? input.assignableId : existing.assignableId,
    );
    if ("error" in booking) return booking;
    patch.timesheetTypeId = typeId;
    patch.assignableType = booking.value.assignableType;
    patch.assignableId = booking.value.assignableId;
  }
  if (input.description !== undefined) patch.description = input.description ? String(input.description).slice(0, 255) : null;

  const [row] = await db.update(timeEntries).set(patch)
    .where(and(eq(timeEntries.id, id), eq(timeEntries.orgId, ctx.orgId), inArray(timeEntries.status, ["draft", "rejected"]))).returning();
  if (!row) return fail("That entry changed while you were editing it. Reload and try again.", 409);
  return { ok: true, value: row };
}

export async function deleteEntry(ctx: TimeCtx, id: string, opts: { selfOnly?: boolean } = {}): Promise<Result<{ ok: true }>> {
  const existing = await loadEntry(ctx.orgId, id);
  if (!existing) return fail("Time entry not found", 404);
  if (!canEnterTimeFor(ctx.actor, existing.resourceId) || (opts.selfOnly && existing.resourceId !== ctx.actor.resourceId)) {
    return fail("You can only delete your own time", 403);
  }
  if (!isEditableStatus(existing.status)) return fail("Only a Draft or Rejected entry can be deleted", 409);
  await db.delete(timeEntries)
    .where(and(eq(timeEntries.id, id), eq(timeEntries.orgId, ctx.orgId), inArray(timeEntries.status, ["draft", "rejected"])));
  return { ok: true, value: { ok: true } };
}

// ── Submit ───────────────────────────────────────────────────────────────────

export async function submitEntry(ctx: TimeCtx, id: string): Promise<Result<TimeEntryRow>> {
  const existing = await loadEntry(ctx.orgId, id);
  if (!existing) return fail("Time entry not found", 404);
  if (!canEnterTimeFor(ctx.actor, existing.resourceId)) return fail("You can only submit your own time", 403);
  if (!isSubmittableStatus(existing.status)) return fail("Only a Draft or Rejected entry can be submitted", 409);
  const [row] = await db.update(timeEntries).set({ status: "submitted", rejectedReason: null, updatedAt: new Date() })
    .where(and(eq(timeEntries.id, id), eq(timeEntries.orgId, ctx.orgId), inArray(timeEntries.status, ["draft", "rejected"]))).returning();
  if (!row) return fail("That entry changed. Reload and try again.", 409);
  return { ok: true, value: row };
}

/** Submit the caller's own draft/rejected entries for the Monday-start week. */
export async function submitWeek(ctx: TimeCtx, weekStart: unknown): Promise<Result<{ submitted: number; weekStart: string; weekEnd: string }>> {
  if (!ctx.actor.resourceId) return fail("Your login is not linked to a person yet");
  if (!isRealDate(weekStart)) return fail("weekStart must be YYYY-MM-DD");
  const weekEnd = addDays(weekStart, 6);
  const rows = await db.update(timeEntries).set({ status: "submitted", rejectedReason: null, updatedAt: new Date() })
    .where(and(
      eq(timeEntries.orgId, ctx.orgId), eq(timeEntries.resourceId, ctx.actor.resourceId),
      gte(timeEntries.date, weekStart), lte(timeEntries.date, weekEnd),
      inArray(timeEntries.status, ["draft", "rejected"]),
    )).returning({ id: timeEntries.id });
  if (rows.length === 0) return fail("There is nothing to submit for that week", 409);
  return { ok: true, value: { submitted: rows.length, weekStart, weekEnd } };
}

// ── Approve / reject ─────────────────────────────────────────────────────────

export async function approveEntry(ctx: TimeCtx, id: string): Promise<Result<TimeEntryRow>> {
  const existing = await loadEntry(ctx.orgId, id);
  if (!existing) return fail("Time entry not found", 404);
  const d = decideEntry(ctx.actor, existing, ctx.people, await leadsForEntries(ctx.orgId, [existing]));
  if ("error" in d) return fail(d.error, d.status);

  const [row] = await db.update(timeEntries)
    .set({ status: "approved", approvedBy: ctx.userId, approvedAt: new Date(), rejectedReason: null, updatedAt: new Date() })
    .where(and(eq(timeEntries.id, id), eq(timeEntries.orgId, ctx.orgId), eq(timeEntries.status, "submitted"))).returning();
  if (!row) return fail("That entry was already decided", 409);

  // A balance-tracked leave type records its usage in the append-only ledger:
  // the one place a "usage" row is written (lib/payroll/leave-balance.ts).
  const [type] = await db.select({ id: timesheetTypes.id, category: timesheetTypes.category }).from(timesheetTypes)
    .where(and(eq(timesheetTypes.id, existing.timesheetTypeId), eq(timesheetTypes.orgId, ctx.orgId))).limit(1);
  if (type?.category === "leave") {
    const [policy] = await db.select({ id: leavePolicies.id }).from(leavePolicies)
      .where(and(eq(leavePolicies.orgId, ctx.orgId), eq(leavePolicies.timesheetTypeId, type.id))).limit(1);
    if (policy) {
      await db.insert(leaveBalanceEntries).values({
        orgId: ctx.orgId, resourceId: existing.resourceId, timesheetTypeId: type.id, date: existing.date,
        hours: `-${Number(existing.hours).toFixed(2)}`, sourceType: "usage", sourceId: existing.id, createdBy: ctx.userId,
      });
    }
  }
  return { ok: true, value: row };
}

export async function rejectEntry(ctx: TimeCtx, id: string, reasonRaw: unknown): Promise<Result<TimeEntryRow>> {
  const reason = parseReason(reasonRaw);
  if ("error" in reason) return fail(reason.error);
  const existing = await loadEntry(ctx.orgId, id);
  if (!existing) return fail("Time entry not found", 404);
  const d = decideEntry(ctx.actor, existing, ctx.people, await leadsForEntries(ctx.orgId, [existing]));
  if ("error" in d) return fail(d.error, d.status);
  const [row] = await db.update(timeEntries).set({ status: "rejected", rejectedReason: reason.reason, updatedAt: new Date() })
    .where(and(eq(timeEntries.id, id), eq(timeEntries.orgId, ctx.orgId), eq(timeEntries.status, "submitted"))).returning();
  if (!row) return fail("That entry was already decided", 409);

  // Returning is a conversation: the reason opens a thread the person can
  // acknowledge and answer. Written AFTER the entry moved, so a losing race on
  // the status update never leaves a return against time nobody returned.
  // Its own failure must not undo a decision that already stands.
  await openReturn(ctx.orgId, {
    timeEntryId: row.id, resourceId: row.resourceId, returnedBy: ctx.userId, reason: reason.reason,
  }).catch((e) => { console.error("[timesheet-return] could not open thread for entry", row.id, e); });

  return { ok: true, value: row };
}

export interface BulkResult { id: string; ok: boolean; error?: string; status?: number }

/** Approve or reject many entries; every id gets its own outcome. */
export async function decideMany(ctx: TimeCtx, ids: string[], action: "approve" | "reject", reason?: unknown): Promise<BulkResult[]> {
  if (action === "reject") {
    const r = parseReason(reason);
    if ("error" in r) return ids.map((id) => ({ id, ok: false, error: r.error, status: 400 }));
  }
  const out: BulkResult[] = [];
  for (const id of Array.from(new Set(ids))) {
    const res = action === "approve" ? await approveEntry(ctx, id) : await rejectEntry(ctx, id, reason);
    out.push("error" in res ? { id, ok: false, error: res.error, status: res.status } : { id, ok: true });
  }
  return out;
}

// ── Approval queue + options ─────────────────────────────────────────────────

export interface ApprovalRow {
  id: string; resourceId: string; personName: string; date: string; hours: number;
  typeName: string; assignableType: string | null; assignableId: string | null;
  assignableName: string | null; description: string | null;
  /** The plan and the logged total for this person, booking and WEEK. Null when the line has no booking. */
  planned: number | null; actual: number | null;
}

async function assignableNames(orgId: string, rows: TimeEntryRow[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const idsOf = (t: string) => Array.from(new Set(rows.filter((r) => r.assignableType === t && r.assignableId).map((r) => r.assignableId as string)));
  const pids = idsOf("project"), mids = idsOf("manufacturing_order"), jids = idsOf("job_work_order");
  if (pids.length) {
    const ps = await db.select({ id: projects.id, name: projects.name, code: projects.code }).from(projects)
      .where(and(eq(projects.orgId, orgId), inArray(projects.id, pids)));
    for (const p of ps) names.set(p.id, `${p.code} · ${p.name}`);
  }
  if (mids.length) {
    const ms = await db.select({ id: manufacturingOrders.id, moNo: manufacturingOrders.moNo, item: apItems.name })
      .from(manufacturingOrders).leftJoin(apItems, eq(apItems.id, manufacturingOrders.outputItemId))
      .where(and(eq(manufacturingOrders.orgId, orgId), inArray(manufacturingOrders.id, mids)));
    for (const m of ms) names.set(m.id, `${m.moNo ?? "MO"} — ${m.item ?? ""}`);
  }
  if (jids.length) {
    const js = await db.select({ id: jobWorkOrders.id, docNumber: jobWorkOrders.docNumber }).from(jobWorkOrders)
      .where(and(eq(jobWorkOrders.orgId, orgId), inArray(jobWorkOrders.id, jids)));
    for (const j of js) names.set(j.id, j.docNumber ?? "Job work");
  }
  return names;
}

/**
 * Submitted entries the caller may decide, oldest first.
 *
 * The candidate set is the people they can SEE **or** anything booked to a
 * project they LEAD — a lead is routinely not in their people's management
 * chain, so narrowing to visible people first would hide the very rows this
 * phase exists to route to them.
 */
export async function approvalQueue(ctx: TimeCtx): Promise<ApprovalRow[]> {
  if (ctx.actor.level === "none") return [];
  const visible = visibleResourceIds(ctx.actor, ctx.people);
  const led = ctx.actor.resourceId ? await projectsLedBy(ctx.orgId, ctx.actor.resourceId) : [];

  const conds: any[] = [eq(timeEntries.orgId, ctx.orgId), eq(timeEntries.status, "submitted")];
  if (visible !== "all") {
    const scopes: any[] = [];
    if (visible.size > 0) scopes.push(inArray(timeEntries.resourceId, Array.from(visible)));
    if (led.length > 0) scopes.push(and(eq(timeEntries.assignableType, "project"), inArray(timeEntries.assignableId, led)));
    if (scopes.length === 0) return [];
    conds.push(scopes.length === 1 ? scopes[0] : or(...scopes));
  }
  const rows = await db.select().from(timeEntries).where(and(...conds)).orderBy(timeEntries.date);

  const leads = await leadsForEntries(ctx.orgId, rows);
  const mine = rows.filter((r) => decideEntry(ctx.actor, r, ctx.people, leads).ok);
  if (mine.length === 0) return [];

  const typeIds = Array.from(new Set(mine.map((r) => r.timesheetTypeId)));
  const types = await db.select({ id: timesheetTypes.id, name: timesheetTypes.name }).from(timesheetTypes)
    .where(and(eq(timesheetTypes.orgId, ctx.orgId), inArray(timesheetTypes.id, typeIds)));
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const personName = new Map(ctx.people.map((p) => [p.id, p.name]));
  const aNames = await assignableNames(ctx.orgId, mine);
  const pa = await planVsActual(ctx.orgId, mine.map((r) => ({
    resourceId: r.resourceId, assignableType: r.assignableType, assignableId: r.assignableId, date: r.date,
  })));

  return mine.map((r) => {
    const fig = r.assignableId ? pa.get(planActualKey(r.resourceId, r.assignableId, weekStartOf(r.date))) : undefined;
    return {
      id: r.id, resourceId: r.resourceId, personName: personName.get(r.resourceId) ?? "-", date: r.date,
      hours: Number(r.hours), typeName: typeName.get(r.timesheetTypeId) ?? "-",
      assignableType: r.assignableType, assignableId: r.assignableId,
      assignableName: r.assignableId ? aNames.get(r.assignableId) ?? null : null, description: r.description,
      planned: fig?.planned ?? null, actual: fig?.actual ?? null,
    };
  });
}

export interface MyOptions {
  types: { id: string; name: string; category: string; requiresAssignable: boolean; billable: boolean }[];
  assignables: Record<AssignableType, { id: string; label: string }[]>;
}

/** What the weekly grid may pick from: ids and names only, no costs or customer financials. */
export async function timeOptions(orgId: string): Promise<MyOptions> {
  const types = await db.select({
    id: timesheetTypes.id, name: timesheetTypes.name, category: timesheetTypes.category,
    requiresAssignable: timesheetTypes.requiresAssignable, billable: timesheetTypes.billable,
  }).from(timesheetTypes)
    .where(and(eq(timesheetTypes.orgId, orgId), eq(timesheetTypes.status, "active")))
    .orderBy(timesheetTypes.sortOrder, timesheetTypes.name);

  const projs = await db.select({ id: projects.id, name: projects.name, code: projects.code, status: projects.status })
    .from(projects).where(eq(projects.orgId, orgId)).orderBy(projects.name);
  const mos = await db.select({ id: manufacturingOrders.id, moNo: manufacturingOrders.moNo, item: apItems.name })
    .from(manufacturingOrders).leftJoin(apItems, eq(apItems.id, manufacturingOrders.outputItemId))
    .where(and(eq(manufacturingOrders.orgId, orgId), ne(manufacturingOrders.status, "Completed"), ne(manufacturingOrders.status, "Cancelled")));
  const jws = await db.select({ id: jobWorkOrders.id, docNumber: jobWorkOrders.docNumber })
    .from(jobWorkOrders).where(and(eq(jobWorkOrders.orgId, orgId), ne(jobWorkOrders.status, "Closed")));

  return {
    types,
    assignables: {
      project: projs.filter((p) => p.status !== "Completed" && p.status !== "Cancelled").map((p) => ({ id: p.id, label: `${p.code} · ${p.name}` })),
      manufacturing_order: mos.map((m) => ({ id: m.id, label: `${m.moNo ?? "MO"} — ${m.item ?? ""}` })),
      job_work_order: jws.map((j) => ({ id: j.id, label: j.docNumber ?? "Job work" })),
    },
  };
}

export async function personCapacity(orgId: string, resourceId: string): Promise<number> {
  const [r] = await db.select({ c: resources.dailyCapacity }).from(resources)
    .where(and(eq(resources.id, resourceId), eq(resources.orgId, orgId))).limit(1);
  return Number(r?.c ?? 8);
}
