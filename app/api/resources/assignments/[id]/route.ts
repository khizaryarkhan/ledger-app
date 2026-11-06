/**
 * PATCH  /api/resources/assignments/:id  → edit dates/allocation/status/notes
 * DELETE /api/resources/assignments/:id  → remove a booking
 */

import { db } from "@/db";
import { resourceAssignments, resources } from "@/db/schema";
import { parseAllocation } from "@/lib/resources/assignable";
import { isRealDate } from "@/lib/resources/time-entry-rules";
import { planningAccess, canPlanResource } from "@/lib/resources/planning-access";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq } from "drizzle-orm";

const STATUSES = ["scheduled", "active", "completed", "cancelled"] as const;

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [existing] = await db.select({ id: resourceAssignments.id, startDate: resourceAssignments.startDate, endDate: resourceAssignments.endDate, resourceId: resourceAssignments.resourceId })
    .from(resourceAssignments).where(and(eq(resourceAssignments.id, params.id), eq(resourceAssignments.orgId, orgId!))).limit(1);
  if (!existing) return bad("Assignment not found", 404);
  if (!(await mayChange(orgId!, session, role, existing.resourceId))) return bad("You cannot change this booking", 403);

  const body = await req.json().catch(() => ({}));
  const { startDate, endDate, allocationPercent, status, notes } = body ?? {};
  const patch: Record<string, any> = { updatedAt: new Date() };
  if (startDate !== undefined && !isRealDate(startDate)) return bad("startDate is not a valid date");
  if (endDate && !isRealDate(endDate)) return bad("endDate is not a valid date");
  const nextStart = startDate ?? existing.startDate;
  const nextEnd = endDate !== undefined ? (endDate || null) : existing.endDate;
  if (nextEnd && nextEnd < nextStart) return bad("endDate cannot be before startDate");
  if (startDate !== undefined) patch.startDate = startDate;
  if (endDate !== undefined) patch.endDate = endDate || null;
  if (allocationPercent !== undefined) {
    const alloc = parseAllocation(allocationPercent);
    if (alloc.ok === false) return bad(alloc.error);
    patch.allocationPercent = String(alloc.value);
  }
  if (status !== undefined) { if (!(STATUSES as readonly string[]).includes(status)) return bad("Invalid status"); patch.status = status; }
  if (notes !== undefined) patch.notes = notes || null;

  const [row] = await db.update(resourceAssignments).set(patch).where(and(eq(resourceAssignments.id, params.id), eq(resourceAssignments.orgId, orgId!))).returning();
  return ok(row);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [existing] = await db.select({ id: resourceAssignments.id, resourceId: resourceAssignments.resourceId }).from(resourceAssignments).where(and(eq(resourceAssignments.id, params.id), eq(resourceAssignments.orgId, orgId!))).limit(1);
  if (!existing) return bad("Assignment not found", 404);
  if (!(await mayChange(orgId!, session, role, existing.resourceId))) return bad("You cannot change this booking", 403);

  await db.delete(resourceAssignments).where(and(eq(resourceAssignments.id, params.id), eq(resourceAssignments.orgId, orgId!)));
  return ok({ ok: true });
}

/** Same rule as booking: the "team" capability, and the person must be one you may see. */
async function mayChange(orgId: string, session: any, role: string | null | undefined, resourceId: string): Promise<boolean> {
  const [res] = await db.select({ id: resources.id, type: resources.type }).from(resources)
    .where(and(eq(resources.id, resourceId), eq(resources.orgId, orgId))).limit(1);
  if (!res) return false;
  return canPlanResource(await planningAccess(orgId, session, role), res);
}
