import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

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
  return (session?.user as any)?.role === "SuperAdmin";
}

// Returns orgId from session — throws if missing
export async function requireOrg() {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), session: null, orgId: null, role: null };
  }
  const orgId = (session.user as any).orgId as string;
  const role = (session.user as any).role as string;
  if (!orgId) {
    return { error: NextResponse.json({ error: "No organisation assigned" }, { status: 403 }), session: null, orgId: null, role: null };
  }
  return { error: null, session, orgId, role };
}

export function requireRole(role: string, minRole: string) {
  const hierarchy = ["company_user", "company_admin", "super_admin"];
  return hierarchy.indexOf(role) >= hierarchy.indexOf(minRole);
}

export function ok(data: any) { return NextResponse.json(data); }
export function bad(message: string, status = 400) { return NextResponse.json({ error: message }, { status }); }
