import { db } from "@/db";
import { users, userOrganisations, organisations } from "@/db/schema";
import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

// POST /api/admin/organisations/[id]/users
// Super admin: add an existing user (by email) or create a new one, then link to this org
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const { error, session } = await requireAuth();
    if (error) return error;
    if (!isSuperAdmin(session)) return bad("Forbidden", 403);

    const orgId = params.id;

    // Verify org exists
    const [org] = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
    if (!org) return bad("Organisation not found", 404);

    const { name, email, password, role = "company_admin" } = await req.json();
    if (!email?.trim()) return bad("Email is required");
    if (!["company_admin", "company_user"].includes(role)) return bad("Invalid role");

    const normalised = email.toLowerCase().trim();

    // Check if user already exists (by email)
    const [existing] = await db.select().from(users).where(eq(users.email, normalised)).limit(1);

    let userId: string;
    let userRecord: { id: string; name: string; email: string; role: string };

    if (existing) {
      // User exists — just link them regardless of what the frontend thought
      userId = existing.id;
      userRecord = { id: existing.id, name: existing.name, email: existing.email, role: existing.role };
    } else {
      // New user — name and password required
      if (!name?.trim()) return bad("Name is required for new users");
      if (!password || password.length < 8) return bad("Password must be at least 8 characters");
      const passwordHash = await bcrypt.hash(password, 12);
      const [created] = await db.insert(users).values({
        orgId,
        name: name.trim(),
        email: normalised,
        passwordHash,
        role,
      }).returning({ id: users.id, name: users.name, email: users.email, role: users.role });
      userId = created.id;
      userRecord = created;
    }

    // Check if already linked to THIS org — skip insert if so
    const [alreadyLinked] = await db
      .select({ id: userOrganisations.id })
      .from(userOrganisations)
      .where(and(eq(userOrganisations.userId, userId), eq(userOrganisations.orgId, orgId)))
      .limit(1);

    if (!alreadyLinked) {
      await db.insert(userOrganisations).values({ userId, orgId, role });
    }

    return ok({ user: userRecord, linked: !!existing, alreadyLinked: !!alreadyLinked });
  } catch (e: any) {
    console.error("[POST /api/admin/organisations/[id]/users] error:", e);
    return bad(e?.message || String(e), 500);
  }
}
