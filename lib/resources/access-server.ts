/**
 * Server half of lib/resources/access.ts: turns a session into an `Actor` by
 * looking up the caller's own people-resource and its designation.
 *
 * `loadPeople` returns every person in the org so the pure helpers can walk
 * the hierarchy; it is one query, so callers should load it once per request.
 */

import { db } from "@/db";
import { resources, resourceDesignations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { buildActor, type Actor, type PersonNode } from "./access";

export interface Person extends PersonNode {
  name: string;
  userId: string | null;
  designationId: string | null;
  designationName: string | null;
  accessLevel: "self" | "team" | "all";
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
    accessLevel: designationStatus === "active" && (r.accessLevel === "team" || r.accessLevel === "all") ? r.accessLevel : "self",
  }));
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
  const actor = buildActor(orgRole, me?.id ?? null, me?.accessLevel ?? null);
  return { actor, people, me };
}
