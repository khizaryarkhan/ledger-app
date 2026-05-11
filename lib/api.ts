import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { userOrganisations, reps } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export async function requireAuth() {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null, orgId: null };
  }
  const orgId = (session.user as any).orgId as string | null;
  return { error: null, session, orgId };
}

export async function requireOrgAuth() {
  const { error, session, orgId } = await requireAuth();
  if (error) return { error, session: null, orgId: null };
  if (!orgId) {
    return { error: NextResponse.json({ error: "No organisation assigned" }, { status: 403 }), session: null, orgId: null };
  }
  return { error: null, session, orgId };
}

export function isSuperAdmin(session: any) {
  return (session?.user as any)?.role === "super_admin";
}

// Returns orgId, role, repId for the ACTIVE org — honours active_org_id cookie.
// - orgId: resolved from cookie (validated against junction table), fallback JWT
// - role: resolved from userOrganisations.role for the active org, fallback JWT
// - repId: resolved by checking if user has a rep linked in the active org
export async function requireOrg() {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null, orgId: null, role: null, repId: null };
  }
  const userId       = (session.user as any).id     as string;
  const jwtRole      = (session.user as any).role   as string;
  const jwtRepId     = (session.user as any).repId  as string | null ?? null;
  const defaultOrgId = (session.user as any).orgId  as string | null;

  let orgId: string | null = null;
  let orgRole: string | null = null;

  // 1. Resolve active org from cookie (validated)
  try {
    const cookieStore = cookies();
    const activeOrgCookie = cookieStore.get("active_org_id")?.value;
    if (activeOrgCookie) {
      const [membership] = await db.select({ orgId: userOrganisations.orgId, role: userOrganisations.role })
        .from(userOrganisations)
        .where(and(eq(userOrganisations.userId, userId), eq(userOrganisations.orgId, activeOrgCookie)))
        .limit(1);
      if (membership) {
        orgId = membership.orgId;
        orgRole = membership.role;
      }
    }
  } catch { /* cookies() unavailable in some edge contexts — fall through */ }

  // 2. Fall back to JWT primary org
  if (!orgId) orgId = defaultOrgId;

  if (!orgId) {
    return { error: NextResponse.json({ error: "No organisation assigned" }, { status: 403 }), session: null, orgId: null, role: null, repId: null };
  }

  // 3. Super admin always retains super_admin role; otherwise prefer per-org role
  const role = jwtRole === "super_admin" ? jwtRole : (orgRole || jwtRole);

  // 4. Resolve repId — only valid if the user's rep actually belongs to the active org
  let repId: string | null = null;
  if (jwtRepId) {
    const [rep] = await db.select({ id: reps.id })
      .from(reps)
      .where(and(eq(reps.id, jwtRepId), eq(reps.orgId, orgId)))
      .limit(1);
    if (rep) repId = rep.id;
  }

  return { error: null, session, orgId, role, repId };
}

export function requireRole(role: string, minRole: string) {
  const hierarchy = ["company_user", "company_admin", "super_admin"];
  return hierarchy.indexOf(role) >= hierarchy.indexOf(minRole);
}

export function ok(data: any) { return NextResponse.json(data); }
export function bad(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
