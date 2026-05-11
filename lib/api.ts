import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { userOrganisations } from "@/db/schema";
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

// Returns orgId from session — honours active_org_id cookie for multi-org users
export async function requireOrg() {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null, orgId: null, role: null, repId: null };
  }
  const userId  = (session.user as any).id   as string;
  const role    = (session.user as any).role  as string;
  const repId   = (session.user as any).repId as string | null ?? null;
  const defaultOrgId = (session.user as any).orgId as string | null;

  let orgId: string | null = null;

  // Check if user has selected a different active org via cookie
  try {
    const cookieStore = cookies();
    const activeOrgCookie = cookieStore.get("active_org_id")?.value;
    if (activeOrgCookie) {
      // Validate user actually belongs to that org
      const [membership] = await db.select({ orgId: userOrganisations.orgId })
        .from(userOrganisations)
        .where(and(eq(userOrganisations.userId, userId), eq(userOrganisations.orgId, activeOrgCookie)))
        .limit(1);
      if (membership) orgId = membership.orgId;
    }
  } catch { /* cookies() unavailable in some edge contexts — fall through */ }

  // Fall back to the org baked into the JWT
  if (!orgId) orgId = defaultOrgId;

  if (!orgId) {
    return { error: NextResponse.json({ error: "No organisation assigned" }, { status: 403 }), session: null, orgId: null, role: null, repId: null };
  }
  return { error: null, session, orgId, role, repId };
}

export function requireRole(role: string, minRole: string) {
  const hierarchy = ["company_user", "company_admin", "super_admin"];
  return hierarchy.indexOf(role) >= hierarchy.indexOf(minRole);
}

export function ok(data: any) { return NextResponse.json(data); }
export function bad(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
