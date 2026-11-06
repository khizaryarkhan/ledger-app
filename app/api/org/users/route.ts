/**
 * /api/org/users — Org-level user management (company_admin only).
 *
 * Handles the Settings → Team page. Platform-level cross-org user management
 * stays at /api/admin/users (super_admin / platform_admin only).
 */
import { db } from "@/db";
import { users, userOrganisations, reps, orgRoles, resources } from "@/db/schema";
import { wouldRemoveLastAdmin } from "@/lib/roles";
import { activeAdminIds, ensurePersonRecord, loadOrgRole } from "@/lib/roles-server";
import { isSuperAdmin, requireOrg, ok, bad } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { z } from "zod";
import { eq, and, or, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

const userCols = {
  id: users.id, orgId: users.orgId, name: users.name,
  email: users.email, role: users.role, status: users.status,
  createdAt: users.createdAt, repId: users.repId,
};

function requireAdmin(session: any, orgId: string | undefined) {
  const role = (session?.user as any)?.role;
  if (role !== "company_admin" && role !== "super_admin" && role !== "platform_admin") {
    return bad("Only Company Admins can manage team members", 403);
  }
  return null;
}

// ── GET — list all users in this org ─────────────────────────────────────────
export async function GET(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const adminError = requireAdmin(session, orgId);
  if (adminError) return adminError;

  // Covers users.orgId (primary-org accounts) AND user_organisations rows
  // (multi-org / invited users). COALESCE picks the org-specific role.
  const rows = await db
    .select({
      id: users.id, orgId: users.orgId, name: users.name,
      email: users.email,
      role: sql<string>`COALESCE(${userOrganisations.role}, ${users.role})`,
      status: users.status, createdAt: users.createdAt, repId: users.repId,
      repTier: reps.tier, repManagerId: reps.managerId,
      roleId: userOrganisations.roleId, roleName: orgRoles.name,
      personId: resources.id, department: resources.department,
    })
    .from(users)
    .leftJoin(userOrganisations, and(
      eq(userOrganisations.userId, users.id),
      eq(userOrganisations.orgId, orgId!),
    ))
    // Tier is org-specific: match the reps row in THIS org by email (not the
    // user's single home repId), so a multi-org user shows their per-org tier.
    .leftJoin(reps, and(sql`lower(${reps.email}) = lower(${users.email})`, eq(reps.orgId, orgId!)))
    .leftJoin(orgRoles, eq(orgRoles.id, userOrganisations.roleId))
    .leftJoin(resources, and(eq(resources.orgId, orgId!), eq(resources.userId, users.id)))
    .where(or(
      eq(users.orgId, orgId!),
      eq(userOrganisations.orgId, orgId!),
    ));

  return ok(rows);
}

// ── POST — create user in this org ───────────────────────────────────────────
const CreateSchema = z.object({
  name:      z.string().min(1),
  email:     z.string().email(),
  password:  z.string().min(8),
  role:      z.enum(["company_admin", "company_user", "rep", "ed", "employee"]).default("company_user"),
  roleId:    z.string().uuid().optional(), // a custom role (Settings → Roles); its base type wins over `role`
  managerId: z.string().uuid().optional(),
});

export async function POST(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const adminError = requireAdmin(session, orgId);
  if (adminError) return adminError;

  try {
    const data = CreateSchema.parse(await req.json());
    let customRoleId: string | null = null;
    if (data.roleId) {
      const custom = await loadOrgRole(orgId!, data.roleId);
      if (!custom) return bad("That role does not exist", 404);
      customRoleId = custom.id;
      data.role = custom.baseRole;
    }

    const isPortalRole = data.role === "rep" || data.role === "ed";
    const dbRole  = isPortalRole ? "rep" : data.role;
    const repTier = data.role === "ed" ? "ed" : data.role === "rep" ? "rep" : null;

    const [existing] = await db.select().from(users).where(eq(users.email, data.email.toLowerCase())).limit(1);
    if (existing) {
      // The email may belong to a provisioning shell (Inactive, unusable
      // password) created by the admin-portal Lead → Customer flow, or to a
      // user of another org. Attach/activate instead of dead-ending — this is
      // exactly how a super admin rescues a half-provisioned customer.
      const isPortalRoleX = data.role === "rep" || data.role === "ed";
      const dbRoleX = isPortalRoleX ? "rep" : data.role;

      const [membership] = await db.select({ userId: userOrganisations.userId })
        .from(userOrganisations)
        .where(and(eq(userOrganisations.userId, existing.id), eq(userOrganisations.orgId, orgId!)))
        .limit(1);
      const belongsHere = !!membership || existing.orgId === orgId;

      if (belongsHere && existing.status === "Active") {
        return bad(`"${data.email}" is already an active member of this team`, 409);
      }
      if (!belongsHere && existing.status === "Active") {
        // Active user of another org — attach to this org with the given role.
        await db.insert(userOrganisations).values({ userId: existing.id, orgId: orgId!, role: dbRoleX, roleId: customRoleId }).onConflictDoNothing();
        await ensurePersonRecord(orgId!, existing.id, existing.name);
        const [row] = await db.select(userCols).from(users).where(eq(users.id, existing.id)).limit(1);
        return ok({ ...row, role: dbRoleX, attached: true });
      }

      // Inactive shell → activate with the supplied password + role.
      const passwordHash = await bcrypt.hash(data.password, 12);
      await db.update(users)
        .set({ name: data.name, passwordHash, status: "Active", role: dbRoleX })
        .where(eq(users.id, existing.id));
      await db.insert(userOrganisations).values({ userId: existing.id, orgId: orgId!, role: dbRoleX, roleId: customRoleId }).onConflictDoNothing();
      await ensurePersonRecord(orgId!, existing.id, data.name);
      await db.update(userOrganisations).set({ role: dbRoleX, roleId: customRoleId })
        .where(and(eq(userOrganisations.userId, existing.id), eq(userOrganisations.orgId, orgId!)));
      const [row] = await db.select(userCols).from(users).where(eq(users.id, existing.id)).limit(1);
      return ok({ ...row, role: dbRoleX, activated: true });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const [created] = await db.insert(users).values({
      orgId: orgId!, name: data.name,
      email: data.email.toLowerCase(), passwordHash, role: dbRole,
    }).returning(userCols);

    let repTierOut: string | null = null;
    let repManagerIdOut: string | null = null;
    if (repTier) {
      const [repRecord] = await db.insert(reps).values({
        orgId: orgId!, name: data.name,
        email: data.email.toLowerCase(), tier: repTier,
        ...(data.managerId ? { managerId: data.managerId } : {}),
      }).returning();
      await db.update(users).set({ repId: repRecord.id }).where(eq(users.id, created.id));
      repTierOut = repTier;
      repManagerIdOut = repRecord.managerId ?? null;
      (created as any).repId = repRecord.id;
    }

    // Junction row — required by requireOrg() on every API call
    await db.insert(userOrganisations).values({
      userId: created.id, orgId: orgId!, role: dbRole, roleId: customRoleId,
    });
    // Every member is a person: one record for login, timesheets and hierarchy.
    await ensurePersonRecord(orgId!, created.id, data.name);

    return ok({ ...created, repTier: repTierOut, repManagerId: repManagerIdOut });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to create user", 500);
  }
}

// ── PATCH — role change or status toggle ─────────────────────────────────────
export async function PATCH(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const adminError = requireAdmin(session, orgId);
  if (adminError) return adminError;

  const isSuper = isSuperAdmin(session);

  try {
    const body = await req.json();

    // ── Role change ──────────────────────────────────────────────────────────
    if (body.role !== undefined || body.roleId) {
      const { userId } = body;
      let virtualRole: string = body.role;
      if (!userId) return bad("userId required");
      if (userId === (session!.user as any).id) return bad("You cannot change your own role. Ask another admin.", 403);

      // A custom role carries its own base access type; a built-in role clears it.
      let customRoleId: string | null = null;
      if (body.roleId) {
        const custom = await loadOrgRole(orgId!, body.roleId);
        if (!custom) return bad("That role does not exist", 404);
        customRoleId = custom.id;
        virtualRole = custom.baseRole;
      }

      const allowed = ["company_admin", "company_user", "rep", "ed", "employee"];
      if (!allowed.includes(virtualRole)) return bad("Invalid role", 400);

      const dbRole    = ["rep", "ed"].includes(virtualRole) ? "rep" : virtualRole;
      const targetTier = virtualRole === "ed" ? "ed" : virtualRole === "rep" ? "rep" : null;

      const [target] = await db.select(userCols).from(users).where(eq(users.id, userId)).limit(1);
      if (!target) return bad("User not found", 404);

      // Membership check — a user's designation is ORG-SPECIFIC, so allow the
      // change for anyone who is a member of THIS org (their home org, or an org
      // they were attached to via user_organisations). Previously this rejected
      // multi-org users whose home org differed, so they couldn't be re-roled.
      const isHome = target.orgId === orgId;
      const [membership] = await db.select({ userId: userOrganisations.userId })
        .from(userOrganisations)
        .where(and(eq(userOrganisations.userId, userId), eq(userOrganisations.orgId, orgId!)))
        .limit(1);
      if (!isSuper && !isHome && !membership) return bad("Forbidden", 403);
      if (wouldRemoveLastAdmin(await activeAdminIds(orgId!), userId, dbRole)) {
        return bad("This is the organisation's only admin. Make someone else an admin first.", 409);
      }

      // Role → store on the per-org membership row (org-specific). Only touch the
      // global users.role for the user's HOME org, so other orgs are untouched.
      if (membership) {
        await db.update(userOrganisations).set({ role: dbRole, roleId: customRoleId })
          .where(and(eq(userOrganisations.userId, userId), eq(userOrganisations.orgId, orgId!)));
      } else {
        await db.insert(userOrganisations).values({ userId, orgId: orgId!, role: dbRole, roleId: customRoleId }).onConflictDoNothing();
      }
      await ensurePersonRecord(orgId!, userId, target.name);
      if (isHome) await db.update(users).set({ role: dbRole }).where(eq(users.id, userId));

      // Tier (PM vs ED/RM) → store on the ORG-LOCAL reps row, matched by email so
      // a multi-org user gets a distinct designation per org (e.g. RM here, PM
      // elsewhere). Never mutate their home-org reps row.
      const managerId: string | null = body.managerId || null;
      const [orgRep] = target.email
        ? await db.select().from(reps)
            .where(and(eq(reps.orgId, orgId!), sql`lower(${reps.email}) = lower(${target.email})`))
            .limit(1)
        : [undefined as any];
      if (targetTier) {
        if (orgRep) {
          await db.update(reps).set({ tier: targetTier, managerId }).where(eq(reps.id, orgRep.id));
        } else {
          const [created] = await db.insert(reps).values({
            orgId: orgId!, name: target.name, email: target.email, tier: targetTier,
            ...(managerId ? { managerId } : {}),
          }).returning();
          // users.repId is a single home link — only set it for the home org.
          if (isHome) await db.update(users).set({ repId: created.id }).where(eq(users.id, userId));
        }
      }
      // Switching to Admin / Full Access: we KEEP the org-local reps row so the
      // person stays assignable to projects (admins are assignable); the Team
      // badge is driven by role, not tier, so it still shows Admin/Full Access.

      await logEvent({
        orgId: orgId!, eventType: "user_role_changed",
        actorId: (session!.user as any).id, actorName: (session!.user as any).name ?? null,
        meta: { targetUserId: userId, targetEmail: target.email, newRole: dbRole, roleId: customRoleId, tier: targetTier },
      });
      return ok({ success: true });
    }

    // ── Status toggle ────────────────────────────────────────────────────────
    const { userId, status } = body;
    if (!userId || !["Active", "Inactive"].includes(status)) return bad("Invalid request");

    const [target] = await db.select(userCols).from(users).where(eq(users.id, userId)).limit(1);
    if (!target) return bad("User not found", 404);
    if (!isSuper && target.orgId !== orgId) return bad("Forbidden", 403);
    if (status === "Inactive" && wouldRemoveLastAdmin(await activeAdminIds(orgId!), userId, null)) {
      return bad("This is the organisation's only admin. Make someone else an admin first.", 409);
    }

    await db.update(users).set({ status }).where(eq(users.id, userId));
    // The person record follows the login, so a deactivated login stops counting as staff.
    await db.update(resources).set({ status: status === "Active" ? "active" : "inactive", updatedAt: new Date() })
      .where(and(eq(resources.orgId, orgId!), eq(resources.userId, userId)));
    if (status === "Inactive") {
      await logEvent({
        orgId: orgId!, eventType: "user_deactivated",
        actorId: (session!.user as any).id, actorName: (session!.user as any).name ?? null,
        meta: { targetUserId: userId, targetEmail: target.email },
      });
    }
    return ok({ success: true });
  } catch {
    return bad("Failed to update user", 500);
  }
}

// ── DELETE — remove user from org ────────────────────────────────────────────
export async function DELETE(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const adminError = requireAdmin(session, orgId);
  if (adminError) return adminError;

  const isSuper = isSuperAdmin(session);
  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) return bad("userId required");

  const [target] = await db.select(userCols).from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return bad("User not found", 404);
  if (!isSuper && target.orgId !== orgId) return bad("Forbidden", 403);
  if (target.role === "super_admin") return bad("Cannot delete super admins", 403);
  if ((session!.user as any).id === userId) return bad("Cannot delete your own account", 403);
  if (wouldRemoveLastAdmin(await activeAdminIds(orgId!), userId, null)) {
    return bad("This is the organisation's only admin. Make someone else an admin first.", 409);
  }

  if (target.repId) {
    await db.update(users).set({ repId: null }).where(eq(users.id, userId));
    await db.delete(reps).where(eq(reps.id, target.repId));
  }

  await db.delete(userOrganisations).where(eq(userOrganisations.userId, userId));
  await db.delete(users).where(eq(users.id, userId));

  await logEvent({
    orgId: orgId!, eventType: "user_deactivated",
    actorId: (session!.user as any).id, actorName: (session!.user as any).name ?? null,
    meta: { targetUserId: userId, targetEmail: target.email, deleted: true },
  });
  return ok({ deleted: true });
}
