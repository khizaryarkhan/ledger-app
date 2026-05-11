import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAuth, isSuperAdmin, requireOrgAuth, ok, bad } from "@/lib/api";
import { z } from "zod";
import { eq } from "drizzle-orm";
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
  const { error, session, orgId } = await requireOrgAuth();
  if (error) return error;
  const isSuper = isSuperAdmin(session);

  // ?email= lookup (used by org creation modal to check if user exists)
  const emailParam = new URL(req.url).searchParams.get("email");
  if (emailParam) {
    const [found] = await db.select(cols).from(users).where(eq(users.email, emailParam.toLowerCase())).limit(1);
    return ok(found ? [found] : []);
  }

  const rows = isSuper
    ? await db.select(cols).from(users)
    : await db.select(cols).from(users).where(eq(users.orgId, orgId!));
  return ok(rows);
}

export async function POST(req: Request) {
  const { error, session, orgId } = await requireOrgAuth();
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
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to create user", 500);
  }
}

export async function PATCH(req: Request) {
  const { error, session, orgId } = await requireOrgAuth();
  if (error) return error;
  const isSuper = isSuperAdmin(session);
  const isAdmin = (session!.user as any).role === "company_admin";
  if (!isSuper && !isAdmin) return bad("Forbidden", 403);

  try {
    const { userId, status } = await req.json();
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
