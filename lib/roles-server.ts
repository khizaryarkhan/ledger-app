/**
 * Server half of lib/roles.ts (imports db — never import from a client component).
 */
import { db } from "@/db";
import { organisations, orgRoles, resources, userOrganisations, users } from "@/db/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import type { ModuleKey } from "@/lib/modules";
import type { BaseRole, ModuleAccess, OrgRole, PeopleScope } from "@/lib/roles";

function toRole(r: typeof orgRoles.$inferSelect): OrgRole {
  return {
    id: r.id,
    name: r.name,
    baseRole: r.baseRole as BaseRole,
    modules: (r.modules ?? {}) as Partial<Record<ModuleKey, ModuleAccess>>,
    peopleScope: r.peopleScope as PeopleScope,
  };
}

export async function loadOrgRole(orgId: string, roleId: string | null | undefined): Promise<OrgRole | null> {
  if (!roleId) return null;
  const [r] = await db.select().from(orgRoles)
    .where(and(eq(orgRoles.id, roleId), eq(orgRoles.orgId, orgId))).limit(1);
  return r ? toRole(r) : null;
}

export async function listOrgRoles(orgId: string): Promise<(OrgRole & { members: number })[]> {
  const rows = await db.select().from(orgRoles).where(eq(orgRoles.orgId, orgId)).orderBy(asc(orgRoles.name));
  const counts = await db.select({ roleId: userOrganisations.roleId, n: sql<number>`count(*)::int` })
    .from(userOrganisations)
    .where(and(eq(userOrganisations.orgId, orgId), sql`${userOrganisations.roleId} is not null`))
    .groupBy(userOrganisations.roleId);
  const byRole = new Map(counts.map((c) => [c.roleId, c.n]));
  return rows.map((r) => ({ ...toRole(r), members: byRole.get(r.id) ?? 0 }));
}

/** The custom role a member holds in this org, if any. */
export async function memberRole(orgId: string, userId: string): Promise<OrgRole | null> {
  const [m] = await db.select({ roleId: userOrganisations.roleId }).from(userOrganisations)
    .where(and(eq(userOrganisations.orgId, orgId), eq(userOrganisations.userId, userId))).limit(1);
  return loadOrgRole(orgId, m?.roleId ?? null);
}

/** Ids of active members whose base role is company_admin (the lockout guard's input). */
export async function activeAdminIds(orgId: string): Promise<string[]> {
  const rows = await db.select({ id: users.id }).from(userOrganisations)
    .innerJoin(users, eq(users.id, userOrganisations.userId))
    .where(and(
      eq(userOrganisations.orgId, orgId),
      eq(userOrganisations.role, "company_admin"),
      eq(users.status, "Active"),
    ));
  return rows.map((r) => r.id);
}

/**
 * Every member is a person (one record for login + timesheets + hierarchy).
 * Idempotent: the partial unique index (org_id, user_id) makes a repeat a no-op.
 */
export async function ensurePersonRecord(orgId: string, userId: string, name: string): Promise<void> {
  const [existing] = await db.select({ id: resources.id }).from(resources)
    .where(and(eq(resources.orgId, orgId), eq(resources.userId, userId))).limit(1);
  if (existing) return;
  await db.insert(resources).values({ orgId, type: "person", name, userId }).onConflictDoNothing();
}

export const ROLE_ADMINS = new Set(["company_admin", "super_admin", "platform_admin"]);

export async function orgModules(orgId: string): Promise<string[]> {
  const [org] = await db.select({ m: organisations.enabledModules }).from(organisations)
    .where(eq(organisations.id, orgId)).limit(1);
  return (org?.m as string[]) ?? ["receivables", "payables", "studio", "accounting"];
}
