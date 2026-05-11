import { auth } from "@/lib/auth";
import { db } from "@/db";
import { userOrganisations, organisations, users } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import { ok, bad } from "@/lib/api";
import { cookies } from "next/headers";

export async function GET() {
  const session = await auth();
  if (!session?.user) return bad("Unauthorized", 401);

  const userId       = (session.user as any).id     as string;
  const defaultOrgId = (session.user as any).orgId  as string | null;

  // Get all orgs from the junction table
  const memberships = await db
    .select({ orgId: userOrganisations.orgId, role: userOrganisations.role })
    .from(userOrganisations)
    .where(eq(userOrganisations.userId, userId));

  // Also include the user's default orgId if not already in junction table
  const orgIds = new Set(memberships.map(m => m.orgId));
  if (defaultOrgId && !orgIds.has(defaultOrgId)) {
    orgIds.add(defaultOrgId);
    memberships.push({ orgId: defaultOrgId, role: (session.user as any).role ?? "company_user" });
  }

  if (orgIds.size === 0) return ok([]);

  // Fetch org details
  const orgs = await db
    .select({ id: organisations.id, name: organisations.name, displayName: organisations.displayName, logoUrl: organisations.logoUrl })
    .from(organisations)
    .where(or(...[...orgIds].map(id => eq(organisations.id, id))));

  // Determine active org
  const cookieStore = cookies();
  const activeOrgId = cookieStore.get("active_org_id")?.value ?? defaultOrgId;

  const result = orgs.map(org => ({
    ...org,
    role: memberships.find(m => m.orgId === org.id)?.role ?? "company_user",
    isActive: org.id === activeOrgId,
  }));

  return ok(result);
}
