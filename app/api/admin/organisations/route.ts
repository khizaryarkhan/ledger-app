import { db } from "@/db";
import { organisations, users } from "@/db/schema";
import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import bcrypt from "bcryptjs";

const OrgSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers and hyphens only"),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8),
});

export async function GET() {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);
  const orgs = await db.select().from(organisations).orderBy(desc(organisations.createdAt));
  const allUsers = await db.select({ id: users.id, orgId: users.orgId, name: users.name, email: users.email, role: users.role, isActive: users.isActive, createdAt: users.createdAt }).from(users);
  return ok(orgs.map(org => ({ ...org, users: allUsers.filter(u => u.orgId === org.id) })));
}

export async function POST(req: Request) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);
  try {
    const data = OrgSchema.parse(await req.json());
    const [existing] = await db.select().from(organisations).where(eq(organisations.slug, data.slug)).limit(1);
    if (existing) return bad(`Slug "${data.slug}" is already taken`, 409);
    const [existingUser] = await db.select().from(users).where(eq(users.email, data.adminEmail)).limit(1);
    if (existingUser) return bad(`Email "${data.adminEmail}" is already registered`, 409);
    const [org] = await db.insert(organisations).values({ name: data.name, slug: data.slug }).returning();
    const passwordHash = await bcrypt.hash(data.adminPassword, 12);
    const [admin] = await db.insert(users).values({ orgId: org.id, name: data.adminName, email: data.adminEmail, passwordHash, role: "CompanyAdmin" }).returning();
    return ok({ org, admin: { id: admin.id, name: admin.name, email: admin.email, role: admin.role } });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to create organisation", 500);
  }
}
