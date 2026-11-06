/**
 * Server half of lib/resources/access.ts: turns a session into an `Actor` by
 * looking up the caller's own people-resource and its designation.
 *
 * `loadPeople` returns every person in the org so the pure helpers can walk
 * the hierarchy; it is one query, so callers should load it once per request.
 */

import { db } from "@/db";
import { resources, resourceDesignations, projects, resourceAssignments, timeEntries } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { buildActor, type Actor, type PersonNode } from "./access";
import { memberRole } from "@/lib/roles-server";

export interface Person extends PersonNode {
  name: string;
  userId: string | null;
  designationId: string | null;
  designationName: string | null;
  accessLevel: "self" | "team" | "department" | "all";
  department: string | null;
  status: string;
}

export async function loadPeople(orgId: string): Promise<Person[]> {
  const rows = await db
    .select({
      id: resources.id,
      name: resources.name,
      managerId: resources.managerId,
      userId: resources.userId,
      designationId: resources.designationId,
      designationName: resourceDesignations.name,
      accessLevel: resourceDesignations.accessLevel,
      designationStatus: resourceDesignations.status,
      department: resources.department,
      status: resources.status,
    })
    .from(resources)
    .leftJoin(resourceDesignations, eq(resourceDesignations.id, resources.designationId))
    .where(and(eq(resources.orgId, orgId), eq(resources.type, "person")));
  // A deactivated designation grants nothing: its holders fall back to "self".
  return rows.map(({ designationStatus, ...r }) => ({
    ...r,
    accessLevel: designationStatus === "active" && (r.accessLevel === "team" || r.accessLevel === "department" || r.accessLevel === "all") ? r.accessLevel : "self",
  }));
}

/**
 * Everyone working on the projects this person LEADS (Phase E).
 *
 * Two cheap queries, and the second only runs when they actually lead
 * something — so the overwhelming majority of callers pay one indexed lookup
 * that returns nothing. Both who is assigned to the project and who has logged
 * time to it count: a lead is accountable for the work, not only for the plan.
 */
export async function ledPeopleFor(orgId: string, resourceId: string): Promise<Set<string>> {
  const led = await db.select({ id: projects.id }).from(projects)
    .where(and(eq(projects.orgId, orgId), eq(projects.leadResourceId, resourceId)));
  if (led.length === 0) return new Set();
  const ids = led.map((p) => p.id);

  const [assigned, logged] = await Promise.all([
    db.select({ resourceId: resourceAssignments.resourceId }).from(resourceAssignments)
      .where(and(
        eq(resourceAssignments.orgId, orgId),
        eq(resourceAssignments.assignableType, "project"),
        inArray(resourceAssignments.assignableId, ids),
      )),
    db.select({ resourceId: timeEntries.resourceId }).from(timeEntries)
      .where(and(
        eq(timeEntries.orgId, orgId),
        eq(timeEntries.assignableType, "project"),
        inArray(timeEntries.assignableId, ids),
      )),
  ]);

  const out = new Set<string>();
  for (const r of assigned) out.add(r.resourceId);
  for (const r of logged) out.add(r.resourceId);
  return out;
}

/** The caller's actor plus the people list it was resolved against. */
export async function resolveActor(
  orgId: string,
  userId: string | null | undefined,
  orgRole: string | null | undefined,
): Promise<{ actor: Actor; people: Person[]; me: Person | null }> {
  const people = await loadPeople(orgId);
  // A deactivated person keeps their row (history) but not their access.
  const me = userId ? people.find((p) => p.userId === userId && p.status === "active") ?? null : null;
  // Resolved for everyone with a person record, not opt-in per route: a route
  // that forgot to ask would silently show a lead less than they may see,
  // and a scope that changes with the caller is worse than one extra query.
  const ledPeopleIds = me ? await ledPeopleFor(orgId, me.id) : undefined;
  // A custom role (Settings → Roles) sets whose people this person sees;
  // without one, the designation decides, as before.
  const custom = userId ? await memberRole(orgId, userId).catch(() => null) : null;
  const level = custom ? custom.peopleScope : me?.accessLevel ?? null;
  const actor = buildActor(orgRole, me?.id ?? null, level, {
    department: me?.department ?? null,
    ledPeopleIds,
  });
  return { actor, people, me };
}
