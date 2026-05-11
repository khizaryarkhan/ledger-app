import { db } from "@/db";
import { organisations, users, userOrganisations } from "@/db/schema";
import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { z } from "zod";
import { eq, desc, sql } from "drizzle-orm";
import bcrypt from "bcryptjs";

const OrgSchema = z.object({
  name: z.string().min(1).max(255),
  slug: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, "Slug must be lowercase letters, numbers and hyphens only"),
  adminName: z.string().min(1),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(8).optional().or(z.literal("")),
});

export async function GET() {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const orgs = await db.select().from(organisations).orderBy(desc(organisations.createdAt));
  const userCounts = await db
    .select({ orgId: users.orgId, count: sql<number>`count(*)::int` })
    .from(users)
    .groupBy(users.orgId);
  const countMap = Object.fromEntries(userCounts.map(r => [r.orgId, r.count]));
  return ok(orgs.map(org => ({ ...org, userCount: countMap[org.id] || 0 })));
}

export async function POST(req: Request) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  try {
    const data = OrgSchema.parse(await req.json());

    // Check slug uniqueness
    const [existingOrg] = await db.select().from(organisations).where(eq(organisations.slug, data.slug)).limit(1);
    if (existingOrg) return bad(`Slug "${data.slug}" is already taken`, 409);

    // Create the org
    const [org] = await db.insert(organisations).values({ name: data.name, slug: data.slug }).returning();

    // Check if admin email already exists
    const [existingUser] = await db.select().from(users).where(eq(users.email, data.adminEmail.toLowerCase().trim())).limit(1);

    let admin: { id: string; name: string; email: string; role: string };

    if (existingUser) {
      // User already exists — link them to the new org via junction table
      admin = { id: existingUser.id, name: existingUser.name, email: existingUser.email, role: existingUser.role };
    } else {
      // New user — require password
      if (!data.adminPassword) return bad("Password is required for new admin accounts");
      const passwordHash = await bcrypt.hash(data.adminPassword, 12);
      const [created] = await db.insert(users).values({
        orgId: org.id,
        name: data.adminName,
        email: data.adminEmail.toLowerCase().trim(),
        passwordHash,
        role: "company_admin",
      }).returning({ id: users.id, name: users.name, email: users.email, role: users.role });
      admin = created;
    }

    // Add to user_organisations junction table (idempotent)
    await db.insert(userOrganisations)
      .values({ userId: admin.id, orgId: org.id, role: "company_admin" })
      .onConflictDoNothing();

    return ok({
      org: { ...org, userCount: 1 },
      admin,
      linked: !!existingUser, // flag so the UI can show the right message
    });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to create organisation", 500);
  }
}
