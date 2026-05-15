import { db } from "@/db";
import { users, userOrganisations } from "@/db/schema";
import { requireAuth, isSuperAdmin, requireOrg, ok, bad } from "@/lib/api";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

const UserSchema = z.object({
  orgId: z.string().uuid().optional(),
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["company_admin", "company_user"]).default("company_user"),
});

const cols = {
  id: users.id, orgId: users.orgId, name: users.name,
  email: users.email, role: users.role, status: users.status, createdAt: users.createdAt,
};

export async function GET(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const isSuper = isSuperAdmin(session);

  const url = new URL(req.url);

  // ?email= lookup (used by org creation modal to check if user exists)
  const emailParam = url.searchParams.get("email");
  if (emailParam) {
    const [found] = await db.select(cols).from(users).where(eq(users.email, emailParam.toLowerCase())).limit(1);
    return ok(found ? [found] : []);
  }

  // ?orgId= lookup — super admin fetching users of a specific org (via junction table)
  const orgIdParam = url.searchParams.get("orgId");
  if (orgIdParam) {
    if (!isSuper) return bad("Forbidden", 403);
    const rows = await db
      .select({
        id: users.id, orgId: users.orgId, name: users.name,
        email: users.email, role: userOrganisations.role,
        status: users.status, createdAt: users.createdAt,
      })
      .from(userOrganisations)
      .innerJoin(users, eq(users.id, userOrganisations.userId))
      .where(eq(userOrganisations.orgId, orgIdParam));
    return ok(rows);
  }

  const rows = isSuper
    ? await db.select(cols).from(users)
    : await db.select(cols).from(users).where(eq(users.orgId, orgId!));
  return ok(rows);
}

export async function POST(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const isSuper = isSuperAdmin(session);
  const isAdmin = (session!.user as any).role === "company_admin";
  if (!isSuper && !isAdmin) return bad("Only Company Admins can create users", 403);

  try {
    const data = UserSchema.parse(await req.json());
    const targetOrgId = isSuper ? (data.orgId || orgId!) : orgId!;
    if (!isSuper && data.role === "company_admin") return bad("Company Admins cannot create other Company Admins", 403);

    const [existing] = await db.select().from(users).where(eq(users.email, data.email)).limit(1);
    if (existing) return bad(`Email "${data.email}" is already registered`, 409);

    const passwordHash = await bcrypt.hash(data.password, 12);
    const [created] = await db.insert(users).values({
      orgId: targetOrgId, name: data.name, email: data.email, passwordHash, role: data.role,
    }).returning(cols);

    // CRITICAL: also create the user_organisations junction row.
    // requireOrg() validates membership against this table on every request —
    // without this insert, the new user logs in but every API call returns 403.
    await db.insert(userOrganisations).values({
      userId: created.id,
      orgId:  targetOrgId,
      role:   data.role,
    });
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to create user", 500);
  }
}

export async function PUT(req: Request) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  try {
    const { userId, name, email, role } = await req.json();
    if (!userId) return bad("userId required");

    const [target] = await db.select(cols).from(users).where(eq(users.id, userId)).limit(1);
    if (!target) return bad("User not found", 404);

    const updates: Record<string, any> = {};
    if (name?.trim()) updates.name = name.trim();
    if (email?.trim()) {
      const normalised = email.toLowerCase().trim();
      if (normalised !== target.email) {
        const [clash] = await db.select({ id: users.id }).from(users).where(eq(users.email, normalised)).limit(1);
        if (clash) return bad(`Email "${normalised}" is already registered`, 409);
        updates.email = normalised;
      }
    }
    if (role && ["company_admin", "company_user"].includes(role)) updates.role = role;

    if (Object.keys(updates).length === 0) return bad("Nothing to update");
    await db.update(users).set(updates).where(eq(users.id, userId));
    const [updated] = await db.select(cols).from(users).where(eq(users.id, userId)).limit(1);
    return ok(updated);
  } catch (e: any) {
    return bad("Failed to update user", 500);
  }
}

export async function PATCH(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const isSuper = isSuperAdmin(session);
  const isAdmin = (session!.user as any).role === "company_admin";
  if (!isSuper && !isAdmin) return bad("Forbidden", 403);

  try {
    const body = await req.json();

    // Role change
    if (body.role !== undefined) {
      const { userId, role: newRole } = body;
      if (!userId) return bad("userId required");
      const allowed = isSuper ? ["company_admin", "company_user"] : ["company_user"];
      if (!allowed.includes(newRole)) return bad("Invalid role or insufficient permissions", 403);
      const [target] = await db.select(cols).from(users).where(eq(users.id, userId)).limit(1);
      if (!target) return bad("User not found", 404);
      if (!isSuper && target.orgId !== orgId) return bad("Forbidden", 403);
      await db.update(users).set({ role: newRole }).where(eq(users.id, userId));
      await db.update(userOrganisations).set({ role: newRole })
        .where(and(eq(userOrganisations.userId, userId), eq(userOrganisations.orgId, orgId!)));
      return ok({ success: true });
    }

    // Status change
    const { userId, status } = body;
    if (!userId || !["Active", "Inactive"].includes(status)) return bad("Invalid request");
    const [target] = await db.select(cols).from(users).where(eq(users.id, userId)).limit(1);
    if (!target) return bad("User not found", 404);
    if (!isSuper && target.orgId !== orgId) return bad("Forbidden", 403);
    await db.update(users).set({ status }).where(eq(users.id, userId));
    return ok({ success: true });
  } catch (e: any) {
    return bad("Failed to update user", 500);
  }
}

export async function DELETE(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const isSuper = isSuperAdmin(session);
  const isAdmin = (session!.user as any).role === "company_admin";
  if (!isSuper && !isAdmin) return bad("Only admins can delete users", 403);

  const { searchParams } = new URL(req.url);
  const userId = searchParams.get("userId");
  if (!userId) return bad("userId required");

  const [target] = await db.select(cols).from(users).where(eq(users.id, userId)).limit(1);
  if (!target) return bad("User not found", 404);
  if (!isSuper && target.orgId !== orgId) return bad("Forbidden", 403);
  if (target.role === "super_admin") return bad("Cannot delete super admins", 403);
  // Prevent self-deletion
  if ((session!.user as any).id === userId) return bad("Cannot delete your own account", 403);

  await db.delete(userOrganisations).where(eq(userOrganisations.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
  return ok({ deleted: true });
}
