/**
 * POST /api/admin/impersonate { userId, orgId? } → { ticket }   (orgId defaults to the active org)
 *
 * Super admins only (DB-revalidated). Checks the target here, mints a 2-minute
 * signed ticket, and the browser hands it to NextAuth's session update, whose
 * jwt callback (lib/auth.ts) re-checks everything before switching identity.
 * See lib/impersonation.ts for the full set of rules (read-only, 60 minutes).
 */
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { db } from "@/db";
import { users, userOrganisations } from "@/db/schema";
import { requireSuperAdmin } from "@/lib/billing";
import { logEvent } from "@/lib/audit";
import { mintTicket, IMPERSONATION_MINUTES } from "@/lib/impersonation";
import { and, eq } from "drizzle-orm";

/** Same-origin browser request only (a same-site white-label subdomain is still a different origin). */
function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host.split(",")[0].trim(); } catch { return false; }
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Cross-origin request refused" }, { status: 403 });
  const admin = await requireSuperAdmin();
  if (admin.error) return admin.error;

  const body = await req.json().catch(() => ({}));
  const userId = typeof body?.userId === "string" ? body.userId : "";
  // Defaults to the organisation the admin is looking at (the Team page they clicked from).
  const orgId = typeof body?.orgId === "string" && body.orgId ? body.orgId : (cookies().get("active_org_id")?.value ?? "");
  if (!userId || !orgId) return NextResponse.json({ error: "Pick an organisation first, then a user." }, { status: 400 });
  if (userId === admin.userId) return NextResponse.json({ error: "That is your own account." }, { status: 400 });

  const [target] = await db.select({
    id: users.id, name: users.name, email: users.email, status: users.status, globalRole: users.role,
  }).from(users)
    .innerJoin(userOrganisations, and(eq(userOrganisations.userId, users.id), eq(userOrganisations.orgId, orgId)))
    .where(eq(users.id, userId)).limit(1);
  if (!target) return NextResponse.json({ error: "That user is not a member of this organisation." }, { status: 404 });
  if (target.status !== "Active") return NextResponse.json({ error: "That user is inactive." }, { status: 400 });
  if (target.globalRole === "super_admin" || target.globalRole === "platform_admin") {
    return NextResponse.json({ error: "Platform admins cannot be signed in as." }, { status: 403 });
  }

  await logEvent({
    orgId, eventType: "impersonation_started",
    actorId: admin.userId!, actorName: admin.userName ?? admin.userEmail ?? null,
    meta: { targetUserId: target.id, targetEmail: target.email, readOnly: true, minutes: IMPERSONATION_MINUTES },
  }).catch((e) => console.error("[impersonate] audit failed", e));

  const res = NextResponse.json({ ticket: mintTicket(admin.userId!, target.id, orgId), name: target.name });
  // Land in the target's organisation; requireOrg() still validates it against their membership.
  res.cookies.set("active_org_id", orgId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 30 });
  res.cookies.set("active_group_id", "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
  return res;
}
