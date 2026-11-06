/**
 * POST /api/org/impersonate { userId } | { resourceId } → { ticket }
 *
 * "Sign in as" (lib/impersonation.ts): read-only, 60 minutes, audited.
 *  - A super admin may sign in as anyone in the active organisation except a
 *    super/platform admin.
 *  - A company admin may sign in as anyone in THEIR OWN organisation except
 *    another admin. The organisation is always the caller's active org as
 *    resolved by requireOrg() (DB-validated membership) — never a request value.
 * This only mints a 2-minute signed ticket; NextAuth's jwt callback re-checks
 * every rule against the database before switching identity.
 */
import { NextResponse } from "next/server";
import { db } from "@/db";
import { users, userOrganisations, resources } from "@/db/schema";
import { requireOrg } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { mintTicket, mayImpersonate, IMPERSONATION_MINUTES } from "@/lib/impersonation";
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
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const actor = session!.user as any;
  if ((actor as any).impersonatedBy) return NextResponse.json({ error: "Return to your own account first." }, { status: 403 });
  if (role !== "super_admin" && role !== "company_admin") {
    return NextResponse.json({ error: "Only admins can sign in as another user." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  let userId = typeof body?.userId === "string" ? body.userId : "";
  // From Resources → People: a person record id, resolved to its login here so
  // the People list never has to send user ids to the browser.
  if (!userId && typeof body?.resourceId === "string") {
    const [r] = await db.select({ userId: resources.userId }).from(resources)
      .where(and(eq(resources.id, body.resourceId), eq(resources.orgId, orgId!))).limit(1);
    if (!r?.userId) return NextResponse.json({ error: "This person has no login to sign in as." }, { status: 400 });
    userId = r.userId;
  }
  if (!userId) return NextResponse.json({ error: "Pick a user." }, { status: 400 });
  if (userId === actor.id) return NextResponse.json({ error: "That is your own account." }, { status: 400 });

  const [target] = await db.select({
    id: users.id, name: users.name, email: users.email, status: users.status,
    globalRole: users.role, orgRole: userOrganisations.role,
  }).from(users)
    .innerJoin(userOrganisations, and(eq(userOrganisations.userId, users.id), eq(userOrganisations.orgId, orgId!)))
    .where(eq(users.id, userId)).limit(1);
  if (!target) return NextResponse.json({ error: "That user is not a member of this organisation." }, { status: 404 });
  if (target.status !== "Active") return NextResponse.json({ error: "That user is inactive." }, { status: 400 });
  if (target.globalRole === "super_admin" || target.globalRole === "platform_admin") {
    return NextResponse.json({ error: "Platform admins cannot be signed in as." }, { status: 403 });
  }
  if (!mayImpersonate({ globalRole: role === "super_admin" ? "super_admin" : null, orgRole: role }, target.orgRole)) {
    return NextResponse.json({ error: "Admins cannot sign in as another admin." }, { status: 403 });
  }

  await logEvent({
    orgId: orgId!, eventType: "impersonation_started",
    actorId: actor.id, actorName: actor.name ?? actor.email ?? null,
    meta: { targetUserId: target.id, targetEmail: target.email, actorRole: role, readOnly: true, minutes: IMPERSONATION_MINUTES },
  }).catch((e) => console.error("[impersonate] audit failed", e));

  return NextResponse.json({ ticket: mintTicket(actor.id, target.id, orgId!), name: target.name });
}
