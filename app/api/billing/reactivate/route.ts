import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions, cancellationRequests } from "@/db/schema";
import { requireOrg } from "@/lib/api";
import { stripe } from "@/lib/stripe";
import { logBillingEvent } from "@/lib/billing";
import { eq, and, ne } from "drizzle-orm";
import { auth } from "@/lib/auth";

export async function POST() {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;

  if (role !== "super_admin" && role !== "company_admin") {
    return NextResponse.json({ error: "Only org admins can reactivate subscriptions" }, { status: 403 });
  }

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId!))
    .limit(1);

  if (!sub?.stripeSubscriptionId) {
    return NextResponse.json({ error: "No subscription found" }, { status: 404 });
  }

  // Remove scheduled cancellation from Stripe
  await stripe.subscriptions.update(sub.stripeSubscriptionId, {
    cancel_at_period_end: false,
    cancel_at: null as any,
  });

  // Update local state
  await db
    .update(subscriptions)
    .set({ cancelAt: null, cancelAtPeriodEnd: false, status: "active", stripeUpdatedAt: new Date() })
    .where(eq(subscriptions.orgId, orgId!));

  // Mark any pending/approved cancellation requests as rejected
  await db
    .update(cancellationRequests)
    .set({ status: "rejected", adminDecision: "reactivated_by_customer", updatedAt: new Date() })
    .where(and(
      eq(cancellationRequests.organizationId, orgId!),
      ne(cancellationRequests.status, "cancelled"),
    ));

  const session = await auth();
  const userId  = (session?.user as any)?.id as string | undefined;

  await logBillingEvent({
    organizationId: orgId!,
    actorUserId:    userId ?? null,
    actorRole:      role!,
    action:         "subscription_reactivated",
    previousStatus: sub.status,
    newStatus:      "active",
    metadata:       { stripeSubscriptionId: sub.stripeSubscriptionId },
  });

  return NextResponse.json({ success: true });
}
