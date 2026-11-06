/**
 * /api/org/roles — custom roles for this organisation (Settings → Roles).
 * Admins only. Built-in roles are returned for display but are not stored.
 */
import { db } from "@/db";
import { orgRoles } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { checkModulesInOrg, parseRoleInput, SYSTEM_ROLES } from "@/lib/roles";
import { listOrgRoles, orgModules, ROLE_ADMINS } from "@/lib/roles-server";

export async function GET() {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!ROLE_ADMINS.has(role!)) return bad("Only Company Admins can manage roles", 403);
  const [roles, modules] = await Promise.all([listOrgRoles(orgId!), orgModules(orgId!)]);
  return ok({ system: SYSTEM_ROLES, roles, modules });
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!ROLE_ADMINS.has(role!)) return bad("Only Company Admins can manage roles", 403);

  const parsed = parseRoleInput(await req.json().catch(() => ({})));
  if ("error" in parsed) return bad(parsed.error);
  const modErr = checkModulesInOrg(parsed.role.modules as Record<string, string>, await orgModules(orgId!));
  if (modErr) return bad(modErr);

  try {
    const [created] = await db.insert(orgRoles).values({
      orgId: orgId!, name: parsed.role.name, baseRole: parsed.role.baseRole,
      modules: parsed.role.modules as Record<string, string>, peopleScope: parsed.role.peopleScope,
    }).returning();
    await logEvent({
      orgId: orgId!, eventType: "org_role_saved",
      actorId: (session!.user as any).id, actorName: (session!.user as any).name ?? null,
      meta: { roleId: created.id, name: created.name, created: true },
    });
    return ok(created);
  } catch (e: any) {
    if (String(e?.code) === "23505" || /unique/i.test(String(e?.message))) return bad(`A role called "${parsed.role.name}" already exists.`, 409);
    console.error("[roles] create failed", e);
    return bad("Could not create the role", 500);
  }
}
