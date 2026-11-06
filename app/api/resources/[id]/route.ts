/**
 * GET    /api/resources/:id   → one resource (costRatePerHour omitted for non-admins)
 * PATCH  /api/resources/:id   → update (organisation admin only). People accept
 *                               managerId / designationId / department; a manager
 *                               that would close a loop is refused.
 * DELETE /api/resources/:id   → delete (admin only; blocked if it has any
 *                               non-cancelled assignments or still has a login)
 */

import { db } from "@/db";
import { holidayCalendars, resources, resourceAssignments, resourceDesignations, employees, users, timeEntries, leaveBalanceEntries } from "@/db/schema";
import { requireOrg, ok, bad, ownsInOrg } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isAdminRole, wouldCreateCycle } from "@/lib/resources/access";
import { loadPeople } from "@/lib/resources/access-server";
import { normaliseDepartment, stripCostRate } from "@/lib/resources/people-rules";
import { readMachineLinks } from "@/lib/resources/machine";
import { checkMachineLinks, isLinkRace } from "@/lib/resources/machine-server";
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
  const { employeeId, name, category, dailyCapacity, status, notes, costRatePerHour, holidayCalendarId, workingDays, managerId, designationId, department, workCentreId, fixedAssetId } = body ?? {};
  const patch: Record<string, any> = { updatedAt: new Date() };

  // Links are equipment-only. `undefined` leaves a link alone and null/"" clears
  // it, so an edit form that does not mention them cannot unlink a machine.
  const links = readMachineLinks(!isPerson, { workCentreId, fixedAssetId });
  if ("error" in links) return bad(links.error);
  const linkCheck = await checkMachineLinks(orgId!, links, params.id);
  if ("error" in linkCheck) return bad(linkCheck.error, linkCheck.status);
  if (links.workCentreId !== undefined) patch.workCentreId = links.workCentreId;
  if (links.fixedAssetId !== undefined) patch.fixedAssetId = links.fixedAssetId;
  if (name != null) { if (!String(name).trim()) return bad("name cannot be empty"); patch.name = String(name).trim(); }
  if (category !== undefined) patch.category = category || null;
  if (dailyCapacity !== undefined) {
    const cap = Number(dailyCapacity);
    if (dailyCapacity === null || dailyCapacity === "" || !Number.isFinite(cap) || cap < 0 || (isPerson && cap > 24)) {
      return bad(isPerson ? "Capacity must be between 0 and 24 hours a day" : "Capacity must be 0 or more");
    }
    patch.dailyCapacity = String(cap);
  }
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
  if (holidayCalendarId !== undefined && isPerson) {
    // A foreign or stale id would silently give the person NO public holidays
    // (reports fall back to the org default only when the id is null).
    if (holidayCalendarId && !(await ownsInOrg(holidayCalendars, holidayCalendarId, orgId!))) return bad("Holiday calendar not found", 404);
    patch.holidayCalendarId = holidayCalendarId || null;
  }
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

  let row;
  try {
    [row] = await db.update(resources).set(patch).where(and(eq(resources.id, params.id), eq(resources.orgId, orgId!))).returning();
  } catch (e) {
    // Two saves racing for the same work centre: the unique index is the guard.
    if (isLinkRace(e)) return bad("That work centre or fixed asset was just linked to another machine", 409);
    throw e;
  }
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
  if (existing.userId) return bad("This person has a login — remove the login first (a team member's login is removed in Settings → Team)", 409);

  const [activeAssignment] = await db.select({ id: resourceAssignments.id }).from(resourceAssignments)
    .where(and(eq(resourceAssignments.resourceId, params.id), eq(resourceAssignments.orgId, orgId!), ne(resourceAssignments.status, "cancelled")))
    .limit(1);
  if (activeAssignment) return bad("This resource has active or scheduled assignments — cancel or complete them first", 409);

  // time_entries / leave_balance_entries / timesheet_returns cascade on delete,
  // so deleting someone with history would erase posted timesheets from under
  // their journal entries. Anyone with history is deactivated, never deleted.
  const [[anyTime], [anyLeave]] = await Promise.all([
    db.select({ id: timeEntries.id }).from(timeEntries).where(and(eq(timeEntries.resourceId, params.id), eq(timeEntries.orgId, orgId!))).limit(1),
    db.select({ id: leaveBalanceEntries.id }).from(leaveBalanceEntries).where(and(eq(leaveBalanceEntries.resourceId, params.id), eq(leaveBalanceEntries.orgId, orgId!))).limit(1),
  ]);
  if (anyTime || anyLeave) return bad("This person has logged time or leave history — set them to Inactive instead of deleting", 409);

  await db.delete(resources).where(and(eq(resources.id, params.id), eq(resources.orgId, orgId!)));
  return ok({ ok: true });
}
