import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { eq, or, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { randomUUID } from "crypto";

const PLATFORM_ROLES = ["super_admin", "platform_admin"] as const;

export async function GET() {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const rows = await db
    .select({
      id: users.id, name: users.name, email: users.email,
      role: users.role, status: users.status, createdAt: users.createdAt,
    })
    .from(users)
    .where(or(eq(users.role, "super_admin"), eq(users.role, "platform_admin")))
    .orderBy(desc(users.createdAt));

  return ok(rows);
}

export async function POST(req: Request) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const { name, email, password, role } = await req.json().catch(() => ({}));
  if (!name?.trim() || !email?.trim() || !password) return bad("Name, email and password are required");
  if (!PLATFORM_ROLES.includes(role)) return bad("Role must be super_admin or platform_admin");

  const lowerEmail = email.toLowerCase().trim();
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, lowerEmail)).limit(1);
  if (existing) return bad("A user with this email already exists", 409);

  if (password.length < 8) return bad("Password must be at least 8 characters");
  const passwordHash = await bcrypt.hash(password, 12);

  const [created] = await db.insert(users).values({
    id: randomUUID(),
    name: name.trim(),
    email: lowerEmail,
    passwordHash,
    role,
    status: "Active",
  }).returning({
    id: users.id, name: users.name, email: users.email,
    role: users.role, status: users.status, createdAt: users.createdAt,
  });

  return ok(created, 201);
}

export async function PATCH(req: Request) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const { userId, status, role } = await req.json().catch(() => ({}));
  if (!userId) return bad("userId required");

  // Prevent self-modification
  if (userId === (session as any)?.user?.id) return bad("Cannot modify your own account here");

  const updates: Record<string, any> = {};
  if (status && ["Active", "Inactive"].includes(status)) updates.status = status;
  if (role && PLATFORM_ROLES.includes(role)) updates.role = role;
  if (Object.keys(updates).length === 0) return bad("Nothing to update");

  await db.update(users).set(updates).where(eq(users.id, userId));
  const [updated] = await db.select({
    id: users.id, name: users.name, email: users.email,
    role: users.role, status: users.status, createdAt: users.createdAt,
  }).from(users).where(eq(users.id, userId)).limit(1);

  return ok(updated);
}
