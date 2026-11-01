/**
 * GET    /api/resources/:id   → one resource (costRatePerHour omitted for non-admins)
 * PATCH  /api/resources/:id   → update (organisation admin only). People accept
 *                               managerId / designationId / department; a manager
 *                               that would close a loop is refused.
 * DELETE /api/resources/:id   → delete (admin only; blocked if it has any
 *                               non-cancelled assignments or still has a login)
 */

import { db } from "@/db";
import { resources, resourceAssignments, resourceDesignations, employees, users } from "@/db/schema";
import { requireOrg, ok, bad, ownsInOrg } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isAdminRole, wouldCreateCycle } from "@/lib/resources/access";
import { loadPeople } from "@/lib/resources/access-server";
import { normaliseDepartment, stripCostRate } from "@/lib/resources/people-rules";
import { and, eq, ne } from "drizzle-orm";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [row] = await db.select().from(resources).where(and(eq(resources.id, params.id), eq(resources.orgId, orgId!))).limit(1);
  if (!row) return bad("Resource not found", 404);

  const { userId, ...rest } = row;
  let loginEmail: string | null = null;
  if (userId) {
    const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
    loginEmail = u?.email ?? null;
  }
  return ok(stripCostRate({ ...rest, hasLogin: !!userId, loginEmail }, isAdminRole(role)));
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;
  if (!isAdminRole(role)) return bad("Only organisation admins can edit people or equipment", 403);

  const [existing] = await db.select({ id: resources.id, type: resources.type, designationId: resources.designationId })
    .from(resources).where(and(eq(resources.id, params.id), eq(resources.orgId, orgId!))).limit(1);
  if (!existing) return bad("Resource not found", 404);
  const isPerson = existing.type === "person";

  const body = await req.json().catch(() => ({}));
  const { employeeId, name, category, dailyCapacity, status, notes, costRatePerHour, holidayCalendarId, workingDays, managerId, designationId, department } = body ?? {};
  const patch: Record<string, any> = { updatedAt: new Date() };
  if (name != null) { if (!String(name).trim()) return bad("name cannot be empty"); patch.name = String(name).trim(); }
  if (category !== undefined) patch.category = category || null;
  if (dailyCapacity !== undefined) patch.dailyCapacity = String(dailyCapacity);
  if (status !== undefined) { if (status !== "active" && status !== "inactive") return bad("status must be 'active' or 'inactive'"); patch.status = status; }
  if (notes !== undefined) patch.notes = notes || null;
  if (employeeId !== undefined && isPerson) {
    if (employeeId && !(await ownsInOrg(employees, employeeId, orgId!))) return bad("Employee not found", 404);
    patch.employeeId = employeeId || null;
  }
  if (costRatePerHour !== undefined) {
    if (costRatePerHour !== null && costRatePerHour !== "" && !Number.isFinite(Number(costRatePerHour))) return bad("costRatePerHour must be a number");
    patch.costRatePerHour = costRatePerHour != null && costRatePerHour !== "" ? String(costRatePerHour) : null;
  }
  if (holidayCalendarId !== undefined && isPerson) patch.holidayCalendarId = holidayCalendarId || null;
  if (workingDays !== undefined && isPerson) {
    if (workingDays != null && (!Array.isArray(workingDays) || workingDays.some((d: any) => !Number.isInteger(d) || d < 1 || d > 7))) {
      return bad("workingDays must be an array of ISO weekday numbers (1-7)");
    }
    patch.workingDays = workingDays?.length ? workingDays : null;
  }

  if (isPerson) {
    if (department !== undefined) {
      const dept = normaliseDepartment(department);
      if (dept.error) return bad(dept.error);
      patch.department = dept.value;
    }
    if (designationId !== undefined) {
      if (designationId) {
        const [d] = await db.select({ status: resourceDesignations.status }).from(resourceDesignations)
          .where(and(eq(resourceDesignations.id, designationId), eq(resourceDesignations.orgId, orgId!))).limit(1);
        if (!d) return bad("Designation not found", 404);
        if (d.status !== "active" && designationId !== existing.designationId) return bad("That designation is inactive");
      }
      patch.designationId = designationId || null;
    }
    if (managerId !== undefined) {
      if (managerId) {
        const people = await loadPeople(orgId!);
        if (!people.some(p => p.id === managerId)) return bad("Manager must be a person in this organisation");
        if (wouldCreateCycle(params.id, managerId, people)) {
          return bad("That would make a loop — this person already manages the chosen manager, directly or indirectly");
        }
      }
      patch.managerId = managerId || null;
    }
  }

  const [row] = await db.update(resources).set(patch).where(and(eq(resources.id, params.id), eq(resources.orgId, orgId!))).returning();
  const { userId: _userId, ...safe } = row;
  return ok(safe);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;
  if (!isAdminRole(role)) return bad("Only organisation admins can delete people or equipment", 403);

  const [existing] = await db.select({ id: resources.id, userId: resources.userId }).from(resources).where(and(eq(resources.id, params.id), eq(resources.orgId, orgId!))).limit(1);
  if (!existing) return bad("Resource not found", 404);
  if (existing.userId) return bad("This person still has a login — remove the login first", 409);

  const [activeAssignment] = await db.select({ id: resourceAssignments.id }).from(resourceAssignments)
    .where(and(eq(resourceAssignments.resourceId, params.id), eq(resourceAssignments.orgId, orgId!), ne(resourceAssignments.status, "cancelled")))
    .limit(1);
  if (activeAssignment) return bad("This resource has active or scheduled assignments — cancel or complete them first", 409);

  await db.delete(resources).where(and(eq(resources.id, params.id), eq(resources.orgId, orgId!)));
  return ok({ ok: true });
}
