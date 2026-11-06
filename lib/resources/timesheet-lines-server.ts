/**
 * The weekly grid's line actions (submit / recall / delete the ticked lines)
 * and Copy Week — the db half of ./timesheet-lines.ts.
 *
 * Self-service only: every action works on the CALLER's own entries, scoped by
 * resource id inside each WHERE clause, so an id belonging to someone else
 * changes nothing. Each status move is one conditional UPDATE (neon-http has no
 * transactions): an entry an approver decided a moment ago no longer matches
 * `status = 'submitted'` and is simply not recalled.
 */

import { db } from "@/db";
import { timeEntries, timesheetTypes } from "@/db/schema";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { addDays } from "@/lib/accounting/report-periods";
import { isRealDate, weekStartOf } from "./time-entry-rules";
import { createEntry, type Result, type TimeCtx } from "./time-entries-server";
import {
  planLineAction, summariseAction, copyableRows, copyPlan, COPY_WEEKS_BACK,
  type LineAction, type CopyRow,
} from "./timesheet-lines";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (error: string, status = 400): { ok: false; error: string; status: number } => ({ ok: false, error, status });

export interface LineActionResult { done: number; skipped: number; failed: number; message: string }

export async function applyLineAction(ctx: TimeCtx, action: LineAction, idsRaw: unknown): Promise<Result<LineActionResult>> {
  const me = ctx.actor.resourceId;
  if (!me) return fail("Your login is not linked to a person yet", 403);
  if (!Array.isArray(idsRaw) || idsRaw.length === 0) return fail("Tick at least one line");
  if (idsRaw.length > 500) return fail("At most 500 entries at a time");
  const ids = Array.from(new Set(idsRaw.filter((x): x is string => typeof x === "string" && UUID_RE.test(x))));
  const unknownIds = idsRaw.length - ids.length;

  const rows = ids.length
    ? await db.select({ id: timeEntries.id, status: timeEntries.status, resourceId: timeEntries.resourceId })
      .from(timeEntries).where(and(eq(timeEntries.orgId, ctx.orgId), inArray(timeEntries.id, ids)))
    : [];
  const { apply, skipped } = planLineAction(action, rows, me);
  const skippedAll = skipped + unknownIds + (ids.length - rows.length);
  if (apply.length === 0) {
    return { ok: true, value: { done: 0, skipped: skippedAll, failed: 0, message: summariseAction(action, 0, skippedAll, 0) } };
  }
  const applyIds = apply.map((e) => e.id);
  const mine = and(eq(timeEntries.orgId, ctx.orgId), eq(timeEntries.resourceId, me), inArray(timeEntries.id, applyIds));

  let done = 0;
  if (action === "submit") {
    const r = await db.update(timeEntries).set({ status: "submitted", rejectedReason: null, updatedAt: new Date() })
      .where(and(mine, inArray(timeEntries.status, ["draft", "rejected"]))).returning({ id: timeEntries.id });
    done = r.length;
  } else if (action === "recall") {
    const r = await db.update(timeEntries).set({ status: "draft", updatedAt: new Date() })
      .where(and(mine, eq(timeEntries.status, "submitted"))).returning({ id: timeEntries.id });
    done = r.length;
  } else {
    const r = await db.delete(timeEntries)
      .where(and(mine, inArray(timeEntries.status, ["draft", "rejected"]))).returning({ id: timeEntries.id });
    done = r.length;
  }
  // Anything that matched the plan but not the UPDATE changed status in between.
  const raced = apply.length - done;
  const total = { done, skipped: skippedAll + raced, failed: 0 };
  return { ok: true, value: { ...total, message: summariseAction(action, total.done, total.skipped, 0) } };
}

// ── Copy Week ────────────────────────────────────────────────────────────────

function parseBack(v: unknown): number | null {
  const n = Number(v ?? 1);
  return Number.isInteger(n) && n >= 1 && n <= COPY_WEEKS_BACK ? n : null;
}

async function ownWeek(ctx: TimeCtx, weekStart: string) {
  return db.select().from(timeEntries).where(and(
    eq(timeEntries.orgId, ctx.orgId), eq(timeEntries.resourceId, ctx.actor.resourceId as string),
    gte(timeEntries.date, weekStart), lte(timeEntries.date, addDays(weekStart, 6)),
  ));
}

async function rowsFor(ctx: TimeCtx, weekStart: string, back: number): Promise<CopyRow[]> {
  const sourceStart = addDays(weekStart, -7 * back);
  const [source, types] = await Promise.all([
    ownWeek(ctx, sourceStart),
    db.select({ id: timesheetTypes.id, category: timesheetTypes.category, status: timesheetTypes.status })
      .from(timesheetTypes).where(eq(timesheetTypes.orgId, ctx.orgId)),
  ]);
  return copyableRows(source, sourceStart, types);
}

/** The rows Copy Week offers, from `back` weeks before the week starting `weekStartRaw`. */
export async function copyWeekRows(ctx: TimeCtx, weekStartRaw: unknown, backRaw: unknown): Promise<Result<{ weekStart: string; back: number; rows: CopyRow[] }>> {
  if (!ctx.actor.resourceId) return fail("Your login is not linked to a person yet", 403);
  if (!isRealDate(weekStartRaw)) return fail("weekStart must be YYYY-MM-DD");
  const back = parseBack(backRaw);
  if (back === null) return fail(`You can copy from 1 to ${COPY_WEEKS_BACK} weeks back`);
  const weekStart = weekStartOf(weekStartRaw);
  return { ok: true, value: { weekStart, back, rows: await rowsFor(ctx, weekStart, back) } };
}

/**
 * Bring the ticked rows into this week as Drafts, same weekday, booking and
 * hours. Each goes through createEntry as the person, so every ordinary rule
 * (type still active, project still exists, 24 hours a day) still applies.
 */
export async function copyWeek(ctx: TimeCtx, body: { weekStart?: unknown; back?: unknown; rows?: unknown }): Promise<Result<{ copied: number; skipped: number; failed: string[]; message: string }>> {
  const me = ctx.actor.resourceId;
  if (!me) return fail("Your login is not linked to a person yet", 403);
  if (!isRealDate(body.weekStart)) return fail("weekStart must be YYYY-MM-DD");
  const back = parseBack(body.back);
  if (back === null) return fail(`You can copy from 1 to ${COPY_WEEKS_BACK} weeks back`);
  const picked = Array.isArray(body.rows) ? body.rows.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
  if (picked.length === 0) return fail("Tick at least one line to copy");

  const weekStart = weekStartOf(body.weekStart);
  const [rows, existing] = await Promise.all([rowsFor(ctx, weekStart, back), ownWeek(ctx, weekStart)]);
  const plan = copyPlan(rows, picked, weekStart, existing);

  let copied = 0;
  const failed: string[] = [];
  for (const c of plan.create) {
    const res = await createEntry(ctx, {
      resourceId: me, date: c.date, hours: c.hours,
      timesheetTypeId: c.booking.typeId, assignableType: c.booking.aType, assignableId: c.booking.aId,
    });
    if ("error" in res) failed.push(res.error); else copied++;
  }
  const uniqueFailed = Array.from(new Set(failed));
  const parts = [`${copied} ${copied === 1 ? "day" : "days"} copied as Draft`];
  if (plan.skipped) parts.push(`${plan.skipped} skipped (already has time this week)`);
  if (failed.length) parts.push(`${failed.length} could not be copied: ${uniqueFailed[0]}`);
  return { ok: true, value: { copied, skipped: plan.skipped, failed: uniqueFailed, message: parts.join(", ") } };
}
