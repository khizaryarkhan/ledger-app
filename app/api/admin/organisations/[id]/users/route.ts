import { db } from "@/db";
import { users, userOrganisations, organisations } from "@/db/schema";
import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";
import bcrypt from "bcryptjs";

// POST /api/admin/organisations/[id]/users
// Super admin: add an existing user (by email) or create a new one, then link to this org
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const orgId = params.id;

  // Verify org exists
  const [org] = await db.select({ id: organisations.id }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  if (!org) return bad("Organisation not found", 404);

  try {
    const { name, email, password, role = "company_admin" } = await req.json();
    if (!email?.trim()) return bad("Email is required");
    if (!["company_admin", "company_user"].includes(role)) return bad("Invalid role");

    const normalised = email.toLowerCase().trim();

    // Check if user already exists
    const [existing] = await db.select().from(users).where(eq(users.email, normalised)).limit(1);

    let user: { id: string; name: string; email: string; role: string };

    if (existing) {
      // Already exists — just link them (idempotent)
      user = { id: existing.id, name: existing.name, email: existing.email, role: existing.role };
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
      user = created;
    }

    // Link to org via junction table (idempotent)
    await db.insert(userOrganisations)
      .values({ userId: user.id, orgId, role })
      .onConflictDoNothing();

    return ok({ user, linked: !!existing });
  } catch (e: any) {
    return bad("Failed to add user", 500);
  }
}
