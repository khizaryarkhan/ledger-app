/**
 * GET    /api/resources/:id   → one resource
 * PATCH  /api/resources/:id   → update
 * DELETE /api/resources/:id   → delete (blocked if it has any non-cancelled assignments)
 */

import { db } from "@/db";
import { resources, resourceAssignments } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, ne } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [row] = await db.select().from(resources).where(and(eq(resources.id, params.id), eq(resources.orgId, orgId!))).limit(1);
  if (!row) return bad("Resource not found", 404);
  return ok(row);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [existing] = await db.select({ id: resources.id, type: resources.type }).from(resources).where(and(eq(resources.id, params.id), eq(resources.orgId, orgId!))).limit(1);
  if (!existing) return bad("Resource not found", 404);

  const body = await req.json().catch(() => ({}));
  const { employeeId, name, category, dailyCapacity, status, notes } = body ?? {};
  const patch: Record<string, any> = { updatedAt: new Date() };
  if (name != null) { if (!String(name).trim()) return bad("name cannot be empty"); patch.name = String(name).trim(); }
  if (category !== undefined) patch.category = category || null;
  if (dailyCapacity !== undefined) patch.dailyCapacity = String(dailyCapacity);
  if (status !== undefined) { if (status !== "active" && status !== "inactive") return bad("status must be 'active' or 'inactive'"); patch.status = status; }
  if (notes !== undefined) patch.notes = notes || null;
  if (employeeId !== undefined && existing.type === "person") patch.employeeId = employeeId || null;

  const [row] = await db.update(resources).set(patch).where(and(eq(resources.id, params.id), eq(resources.orgId, orgId!))).returning();
  return ok(row);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [existing] = await db.select({ id: resources.id }).from(resources).where(and(eq(resources.id, params.id), eq(resources.orgId, orgId!))).limit(1);
  if (!existing) return bad("Resource not found", 404);

  const [activeAssignment] = await db.select({ id: resourceAssignments.id }).from(resourceAssignments)
    .where(and(eq(resourceAssignments.resourceId, params.id), eq(resourceAssignments.orgId, orgId!), ne(resourceAssignments.status, "cancelled")))
    .limit(1);
  if (activeAssignment) return bad("This resource has active or scheduled assignments — cancel or complete them first", 409);

  await db.delete(resources).where(and(eq(resources.id, params.id), eq(resources.orgId, orgId!)));
  return ok({ ok: true });
}
