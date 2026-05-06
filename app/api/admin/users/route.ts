import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAuth, isSuperAdmin, requireOrgAuth, ok, bad } from "@/lib/api";
import { z } from "zod";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

const UserSchema = z.object({
  orgId: z.string().uuid().optional(), // SuperAdmin specifies; CompanyAdmin uses their own
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["CompanyAdmin", "User"]).default("User"),
});

export async function GET() {
  const { error, session, orgId } = await requireOrgAuth();
  if (error) return error;
  const isSuper = isSuperAdmin(session);
  const rows = isSuper
    ? await db.select({ id: users.id, orgId: users.orgId, name: users.name, email: users.email, role: users.role, isActive: users.isActive, createdAt: users.createdAt }).from(users)
    : await db.select({ id: users.id, orgId: users.orgId, name: users.name, email: users.email, role: users.role, isActive: users.isActive, createdAt: users.createdAt }).from(users).where(eq(users.orgId, orgId!));
  return ok(rows);
}

export async function POST(req: Request) {
  const { error, session, orgId } = await requireOrgAuth();
  if (error) return error;
  const isSuper = isSuperAdmin(session);
  const isAdmin = (session!.user as any).role === "CompanyAdmin";
  if (!isSuper && !isAdmin) return bad("Only Company Admins can create users", 403);

  try {
    const data = UserSchema.parse(await req.json());
    const targetOrgId = isSuper ? (data.orgId || orgId!) : orgId!;
    if (!isSuper && data.role === "CompanyAdmin") return bad("Company Admins cannot create other Company Admins", 403);

    const [existing] = await db.select().from(users).where(eq(users.email, data.email)).limit(1);
    if (existing) return bad(`Email "${data.email}" is already registered`, 409);

    const passwordHash = await bcrypt.hash(data.password, 12);
    const [created] = await db.insert(users).values({
      orgId: targetOrgId,
      name: data.name,
      email: data.email,
      passwordHash,
      role: data.role,
    }).returning({ id: users.id, name: users.name, email: users.email, role: users.role, orgId: users.orgId });
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to create user", 500);
  }
}
