/**
 * PATCH  /api/resources/time-entries/:id   → edit a Draft entry
 * DELETE /api/resources/time-entries/:id   → delete a Draft entry
 *
 * Only Draft entries are editable/deletable here — once Submitted, use
 * submit/approve/reject; once Posted, it's part of a journal entry and is
 * corrected the same way every other posted document is (a reversal), not by
 * editing this row.
 */

import { db } from "@/db";
import { timeEntries, timesheetTypes } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq } from "drizzle-orm";
import { isAssignableType } from "@/lib/resources/assignable";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [existing] = await db.select().from(timeEntries).where(and(eq(timeEntries.id, params.id), eq(timeEntries.orgId, orgId!))).limit(1);
  if (!existing) return bad("Time entry not found", 404);
  if (existing.status !== "draft") return bad("Only a Draft entry can be edited — submit a correction instead", 409);

  const body = await req.json().catch(() => ({}));
  const { date, hours, timesheetTypeId, assignableType, assignableId, description } = body ?? {};
  const patch: Record<string, any> = { updatedAt: new Date() };

  if (date !== undefined) { if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad("A valid date (YYYY-MM-DD) is required"); patch.date = date; }
  if (hours !== undefined) { const h = Number(hours); if (!Number.isFinite(h) || h <= 0) return bad("hours must be a positive number"); patch.hours = h.toFixed(2); }

  const typeId = timesheetTypeId ?? existing.timesheetTypeId;
  if (timesheetTypeId !== undefined || assignableType !== undefined || assignableId !== undefined) {
    const [type] = await db.select().from(timesheetTypes).where(and(eq(timesheetTypes.id, typeId), eq(timesheetTypes.orgId, orgId!))).limit(1);
    if (!type) return bad("That timesheet type was not found in this organisation.");
    patch.timesheetTypeId = typeId;
    const at = assignableType !== undefined ? assignableType : existing.assignableType;
    const ai = assignableId !== undefined ? assignableId : existing.assignableId;
    if (type.requiresAssignable) {
      if (!at || !isAssignableType(at) || !ai) return bad(`"${type.name}" requires a Project, Manufacturing Order or Job Work Order to be selected.`);
      patch.assignableType = at;
      patch.assignableId = ai;
    } else {
      patch.assignableType = null;
      patch.assignableId = null;
    }
  }
  if (description !== undefined) patch.description = description ? String(description).slice(0, 255) : null;

  const [row] = await db.update(timeEntries).set(patch).where(and(eq(timeEntries.id, params.id), eq(timeEntries.orgId, orgId!))).returning();
  return ok(row);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [existing] = await db.select({ id: timeEntries.id, status: timeEntries.status }).from(timeEntries)
    .where(and(eq(timeEntries.id, params.id), eq(timeEntries.orgId, orgId!))).limit(1);
  if (!existing) return bad("Time entry not found", 404);
  if (existing.status !== "draft") return bad("Only a Draft entry can be deleted", 409);

  await db.delete(timeEntries).where(and(eq(timeEntries.id, params.id), eq(timeEntries.orgId, orgId!)));
  return ok({ ok: true });
}
