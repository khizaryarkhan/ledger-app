import { auth } from "@/lib/auth";
import { db } from "@/db";
import { userOrganisations, organisations } from "@/db/schema";
import { eq, or, desc } from "drizzle-orm";
import { ok, bad } from "@/lib/api";
import { cookies } from "next/headers";

export async function GET() {
  const session = await auth();
  if (!session?.user) return bad("Unauthorized", 401);

  const userId       = (session.user as any).id     as string;
  const userRole     = (session.user as any).role   as string;
  const defaultOrgId = (session.user as any).orgId  as string | null;
  const isSuperAdmin = userRole === "super_admin";

  const cookieStore = cookies();
  const activeOrgId = cookieStore.get("active_org_id")?.value ?? defaultOrgId;

  // Super admin: return ALL organisations (they can switch between any of them).
  if (isSuperAdmin) {
    const orgs = await db
      .select({
        id: organisations.id,
        name: organisations.name,
        displayName: organisations.displayName,
        logoUrl: organisations.logoUrl,
      })
      .from(organisations)
      .orderBy(desc(organisations.createdAt));

    return ok(orgs.map(org => ({
      ...org,
      role: "super_admin",
      isActive: org.id === activeOrgId,
    })));
  }

  // Regular user: only orgs they're a member of via the junction table.
  const memberships = await db
    .select({ orgId: userOrganisations.orgId, role: userOrganisations.role })
    .from(userOrganisations)
    .where(eq(userOrganisations.userId, userId));

  // Also include the user's default orgId if not already in junction table
  const orgIds = new Set(memberships.map(m => m.orgId));
  if (defaultOrgId && !orgIds.has(defaultOrgId)) {
    orgIds.add(defaultOrgId);
    memberships.push({ orgId: defaultOrgId, role: userRole ?? "company_user" });
  }

  if (orgIds.size === 0) return ok([]);

  const orgs = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      displayName: organisations.displayName,
      logoUrl: organisations.logoUrl,
    })
    .from(organisations)
    .where(or(...[...orgIds].map(id => eq(organisations.id, id))));

  return ok(orgs.map(org => ({
    ...org,
    role: memberships.find(m => m.orgId === org.id)?.role ?? "company_user",
    isActive: org.id === activeOrgId,
  })));
}
