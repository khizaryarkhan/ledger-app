/**
 * /api/org/roles/[id] — edit or delete one custom role. Admins only.
 */
import { db } from "@/db";
import { orgRoles, userOrganisations, users } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { checkModulesInOrg, parseRoleInput } from "@/lib/roles";
import { orgModules, ROLE_ADMINS } from "@/lib/roles-server";
import { and, eq, sql } from "drizzle-orm";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!ROLE_ADMINS.has(role!)) return bad("Only Company Admins can manage roles", 403);

  const parsed = parseRoleInput(await req.json().catch(() => ({})));
  if ("error" in parsed) return bad(parsed.error);
  const modErr = checkModulesInOrg(parsed.role.modules as Record<string, string>, await orgModules(orgId!));
  if (modErr) return bad(modErr);

  // Moving holders onto or off the Collector base changes how their data is
  // scoped (reps rows, repId). Do that one person at a time in Team, not in bulk.
  const [prev] = await db.select({ baseRole: orgRoles.baseRole }).from(orgRoles)
    .where(and(eq(orgRoles.id, params.id), eq(orgRoles.orgId, orgId!))).limit(1);
  if (!prev) return bad("Role not found", 404);
  if (prev.baseRole !== parsed.role.baseRole && (prev.baseRole === "rep" || parsed.role.baseRole === "rep")) {
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(userOrganisations)
      .where(and(eq(userOrganisations.orgId, orgId!), eq(userOrganisations.roleId, params.id)));
    if (n > 0) return bad("People hold this role. A role can't switch to or from Collector while it has holders: create a new role instead.", 409);
  }

  try {
    const [updated] = await db.update(orgRoles).set({
      name: parsed.role.name, baseRole: parsed.role.baseRole,
      modules: parsed.role.modules as Record<string, string>, peopleScope: parsed.role.peopleScope,
      updatedAt: new Date(),
    }).where(and(eq(orgRoles.id, params.id), eq(orgRoles.orgId, orgId!))).returning();
    if (!updated) return bad("Role not found", 404);

    // Members carry the role's base access type on their membership row, which
    // every built-in role check reads. Keep them in step with the role.
    await db.update(userOrganisations).set({ role: updated.baseRole })
      .where(and(eq(userOrganisations.orgId, orgId!), eq(userOrganisations.roleId, updated.id)));
    // users.role mirrors the home org's role (the Team PATCH does the same).
    await db.update(users).set({ role: updated.baseRole })
      .where(and(eq(users.orgId, orgId!), sql`${users.id} in (select user_id from user_organisations where org_id = ${orgId!} and role_id = ${updated.id})`));

    await logEvent({
      orgId: orgId!, eventType: "org_role_saved",
      actorId: (session!.user as any).id, actorName: (session!.user as any).name ?? null,
      meta: { roleId: updated.id, name: updated.name, baseRole: updated.baseRole, modules: updated.modules, peopleScope: updated.peopleScope },
    });
    return ok(updated);
  } catch (e: any) {
    if (String(e?.code) === "23505" || /unique/i.test(String(e?.message))) return bad(`A role called "${parsed.role.name}" already exists.`, 409);
    console.error("[roles] update failed", e);
    return bad("Could not save the role", 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!ROLE_ADMINS.has(role!)) return bad("Only Company Admins can manage roles", 403);

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(userOrganisations)
    .where(and(eq(userOrganisations.orgId, orgId!), eq(userOrganisations.roleId, params.id)));
  // Deleting would silently hand every holder back their built-in role's access.
  if (n > 0) return bad(`${n} ${n === 1 ? "person holds" : "people hold"} this role. Give them another role first.`, 409);

  const [gone] = await db.delete(orgRoles)
    .where(and(eq(orgRoles.id, params.id), eq(orgRoles.orgId, orgId!))).returning({ id: orgRoles.id, name: orgRoles.name });
  if (!gone) return bad("Role not found", 404);
  await logEvent({
    orgId: orgId!, eventType: "org_role_deleted",
    actorId: (session!.user as any).id, actorName: (session!.user as any).name ?? null,
    meta: { roleId: gone.id, name: gone.name },
  });
  return ok({ deleted: true });
}
