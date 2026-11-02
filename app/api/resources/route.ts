/**
 * GET  /api/resources   → list resources (people/equipment), ?type=&status= filters.
 *                         People carry designationName, accessLevel, managerName,
 *                         hasLogin and loginEmail. costRatePerHour is omitted for
 *                         anyone who is not an organisation admin.
 * POST /api/resources   → create a resource (organisation admin only)
 */

import { db } from "@/db";
import { resources, employees, users, resourceDesignations } from "@/db/schema";
import { requireOrg, ok, bad, ownsInOrg } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isAdminRole } from "@/lib/resources/access";
import { loadPeople } from "@/lib/resources/access-server";
import { normaliseDepartment, stripCostRate } from "@/lib/resources/people-rules";
import { readMachineLinks } from "@/lib/resources/machine";
import { checkMachineLinks, isLinkRace } from "@/lib/resources/machine-server";
import { and, eq, desc, inArray } from "drizzle-orm";

export async function GET(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;
  const isAdmin = isAdminRole(role);

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const status = searchParams.get("status");

  const conds = [eq(resources.orgId, orgId!)];
  if (type === "person" || type === "equipment") conds.push(eq(resources.type, type));
  if (status === "active" || status === "inactive") conds.push(eq(resources.status, status));

  const rows = await db.select().from(resources).where(and(...conds)).orderBy(desc(resources.createdAt));

  const employeeIds = rows.map(r => r.employeeId).filter(Boolean) as string[];
  const emps = employeeIds.length
    ? await db.select({ id: employees.id, name: employees.name, email: employees.email }).from(employees).where(and(eq(employees.orgId, orgId!)))
    : [];
  const empById = new Map(emps.map(e => [e.id, e]));

  const people = await loadPeople(orgId!);
  const personById = new Map(people.map(p => [p.id, p]));

  const userIds = rows.map(r => r.userId).filter(Boolean) as string[];
  const loginRows = userIds.length
    ? await db.select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, userIds))
    : [];
  const emailByUser = new Map(loginRows.map(u => [u.id, u.email]));

  return ok(rows.map(r => {
    const { userId, ...rest } = r;
    const person = r.type === "person" ? personById.get(r.id) : undefined;
    const manager = r.managerId ? personById.get(r.managerId) : undefined;
    return stripCostRate({
      ...rest,
      employee: r.employeeId ? empById.get(r.employeeId) ?? null : null,
      designationName: person?.designationName ?? null,
      accessLevel: r.type === "person" && r.designationId ? person?.accessLevel ?? null : null,
      managerName: manager?.name ?? null,
      hasLogin: !!userId,
      loginEmail: userId ? emailByUser.get(userId) ?? null : null,
    }, isAdmin);
  }));
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;
  if (!isAdminRole(role)) return bad("Only organisation admins can add people or equipment", 403);

  const body = await req.json().catch(() => ({}));
  const { type, employeeId, name, category, dailyCapacity, status, notes, costRatePerHour, holidayCalendarId, workingDays, managerId, designationId, department, workCentreId, fixedAssetId } = body ?? {};
  if (type !== "person" && type !== "equipment") return bad("type must be 'person' or 'equipment'");
  if (!name || typeof name !== "string" || !name.trim()) return bad("name is required");
  if (costRatePerHour != null && costRatePerHour !== "" && !Number.isFinite(Number(costRatePerHour))) return bad("costRatePerHour must be a number");
  if (workingDays != null && (!Array.isArray(workingDays) || workingDays.some((d: any) => !Number.isInteger(d) || d < 1 || d > 7))) {
    return bad("workingDays must be an array of ISO weekday numbers (1-7)");
  }

  const isPerson = type === "person";
  const dept = normaliseDepartment(department);
  if (dept.error) return bad(dept.error);

  if (isPerson && employeeId && !(await ownsInOrg(employees, employeeId, orgId!))) return bad("Employee not found", 404);
  if (isPerson && managerId) {
    const people = await loadPeople(orgId!);
    if (!people.some(p => p.id === managerId)) return bad("Manager must be a person in this organisation");
  }
  if (isPerson && designationId) {
    const [d] = await db.select({ status: resourceDesignations.status }).from(resourceDesignations)
      .where(and(eq(resourceDesignations.id, designationId), eq(resourceDesignations.orgId, orgId!))).limit(1);
    if (!d) return bad("Designation not found", 404);
    if (d.status !== "active") return bad("That designation is inactive");
  }

  // `"error" in`, not `!ok`: strictNullChecks is off, so a boolean discriminant does not narrow.
  const links = readMachineLinks(!isPerson, { workCentreId, fixedAssetId });
  if ("error" in links) return bad(links.error);
  const linkCheck = await checkMachineLinks(orgId!, links);
  if ("error" in linkCheck) return bad(linkCheck.error, linkCheck.status);

  let row;
  try {
    [row] = await db.insert(resources).values({
    orgId: orgId!,
    type,
    workCentreId: links.workCentreId ?? null,
    fixedAssetId: links.fixedAssetId ?? null,
    employeeId: isPerson && employeeId ? employeeId : null,
    name: name.trim(),
    category: category || null,
    dailyCapacity: dailyCapacity != null ? String(dailyCapacity) : "1",
    status: status === "inactive" ? "inactive" : "active",
    notes: notes || null,
    costRatePerHour: costRatePerHour != null && costRatePerHour !== "" ? String(costRatePerHour) : null,
    holidayCalendarId: isPerson && holidayCalendarId ? holidayCalendarId : null,
    workingDays: isPerson && workingDays?.length ? workingDays : null,
    managerId: isPerson && managerId ? managerId : null,
    designationId: isPerson && designationId ? designationId : null,
    department: isPerson ? dept.value : null,
    }).returning();
  } catch (e) {
    // Two saves racing for the same work centre: the unique index is the guard,
    // this only turns its error into something a person can act on.
    if (isLinkRace(e)) return bad("That work centre or fixed asset was just linked to another machine", 409);
    throw e;
  }
  const { userId: _userId, ...safe } = row;
  return ok(safe);
}
