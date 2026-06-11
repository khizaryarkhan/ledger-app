import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions, cancellationRequests } from "@/db/schema";
import { requireOrg } from "@/lib/api";
import { logBillingEvent } from "@/lib/billing";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;

  if (role !== "super_admin" && role !== "company_admin") {
    return NextResponse.json({ error: "Only org admins can request cancellation" }, { status: 403 });
  }

  // Block if a pending request already exists
  const [existing] = await db
    .select({ id: cancellationRequests.id })
    .from(cancellationRequests)
    .where(and(
      eq(cancellationRequests.organizationId, orgId!),
      eq(cancellationRequests.status, "pending"),
    ))
    .limit(1);

  if (existing) {
    return NextResponse.json({ error: "A cancellation request is already pending" }, { status: 409 });
  }

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId!))
    .limit(1);

  const body = await req.json().catch(() => ({}));
  const reason = typeof body.reason === "string" ? body.reason.slice(0, 1000) : null;

  const session = await auth();
  const userId  = (session?.user as any)?.id as string | undefined;
  const email   = (session?.user as any)?.email as string | undefined;

  const [cancelReq] = await db.insert(cancellationRequests).values({
    organizationId:      orgId!,
    stripeCustomerId:    sub?.stripeCustomerId ?? null,
    stripeSubscriptionId: sub?.stripeSubscriptionId ?? null,
    requestedByUserId:   userId ?? null,
    requestedByEmail:    email ?? null,
    reason,
    status:              "pending",
    requestedAt:         new Date(),
  }).returning();

  await logBillingEvent({
    organizationId:       orgId!,
    cancellationRequestId: cancelReq.id,
    actorUserId:          userId ?? null,
    actorRole:            role!,
    action:               "cancellation_requested",
    newStatus:            "pending",
  });

  return NextResponse.json({ success: true, requestId: cancelReq.id });
}
