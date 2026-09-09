/**
 * PATCH  /api/resources/assignments/:id  → edit dates/allocation/status/notes
 * DELETE /api/resources/assignments/:id  → remove a booking
 */

import { db } from "@/db";
import { resourceAssignments } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq } from "drizzle-orm";

const STATUSES = ["scheduled", "active", "completed", "cancelled"] as const;

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [existing] = await db.select({ id: resourceAssignments.id, startDate: resourceAssignments.startDate })
    .from(resourceAssignments).where(and(eq(resourceAssignments.id, params.id), eq(resourceAssignments.orgId, orgId!))).limit(1);
  if (!existing) return bad("Assignment not found", 404);

  const body = await req.json().catch(() => ({}));
  const { startDate, endDate, allocationPercent, status, notes } = body ?? {};
  const patch: Record<string, any> = { updatedAt: new Date() };
  const nextStart = startDate ?? existing.startDate;
  if (endDate !== undefined && endDate && endDate < nextStart) return bad("endDate cannot be before startDate");
  if (startDate !== undefined) patch.startDate = startDate;
  if (endDate !== undefined) patch.endDate = endDate || null;
  if (allocationPercent !== undefined) patch.allocationPercent = String(allocationPercent);
  if (status !== undefined) { if (!(STATUSES as readonly string[]).includes(status)) return bad("Invalid status"); patch.status = status; }
  if (notes !== undefined) patch.notes = notes || null;

  const [row] = await db.update(resourceAssignments).set(patch).where(and(eq(resourceAssignments.id, params.id), eq(resourceAssignments.orgId, orgId!))).returning();
  return ok(row);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [existing] = await db.select({ id: resourceAssignments.id }).from(resourceAssignments).where(and(eq(resourceAssignments.id, params.id), eq(resourceAssignments.orgId, orgId!))).limit(1);
  if (!existing) return bad("Assignment not found", 404);

  await db.delete(resourceAssignments).where(and(eq(resourceAssignments.id, params.id), eq(resourceAssignments.orgId, orgId!)));
  return ok({ ok: true });
}
