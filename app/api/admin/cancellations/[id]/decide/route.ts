import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { cancellationRequests, subscriptions } from "@/db/schema";
import { requirePlatformAdmin, logBillingEvent } from "@/lib/billing";
import { stripe } from "@/lib/stripe";
import { eq } from "drizzle-orm";

type Decision = "immediate" | "30_days" | "60_days" | "90_days" | "period_end" | "rejected";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, userId, userRole } = await requirePlatformAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const decision      = body.decision as Decision;
  const internalNotes = typeof body.internalNotes === "string" ? body.internalNotes.slice(0, 2000) : null;

  if (!["immediate", "30_days", "60_days", "90_days", "period_end", "rejected"].includes(decision)) {
    return NextResponse.json({ error: "Invalid decision" }, { status: 400 });
  }

  const [cancelReq] = await db
    .select()
    .from(cancellationRequests)
    .where(eq(cancellationRequests.id, params.id))
    .limit(1);

  if (!cancelReq) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  if (cancelReq.status !== "pending") {
    return NextResponse.json({ error: "Request has already been reviewed" }, { status: 409 });
  }

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.orgId, cancelReq.organizationId))
    .limit(1);

  const stripeSubId = sub?.stripeSubscriptionId ?? cancelReq.stripeSubscriptionId;
  let effectiveDate: Date | null = null;
  let stripeActionStatus = "applied";
  let newStatus: "approved" | "rejected" = decision === "rejected" ? "rejected" : "approved";

  // Apply Stripe action
  if (decision !== "rejected" && stripeSubId) {
    try {
      if (decision === "immediate") {
        await stripe.subscriptions.cancel(stripeSubId);
        await db.update(subscriptions)
          .set({ status: "cancelled", cancelAt: null, cancelAtPeriodEnd: false, stripeUpdatedAt: new Date() })
          .where(eq(subscriptions.orgId, cancelReq.organizationId));
        effectiveDate = new Date();

      } else if (decision === "period_end") {
        await stripe.subscriptions.update(stripeSubId, { cancel_at_period_end: true });
        const updatedSub = await stripe.subscriptions.retrieve(stripeSubId) as any;
        effectiveDate = updatedSub.current_period_end
          ? new Date(updatedSub.current_period_end * 1000)
          : null;
        await db.update(subscriptions)
          .set({ cancelAtPeriodEnd: true, stripeUpdatedAt: new Date() })
          .where(eq(subscriptions.orgId, cancelReq.organizationId));

      } else {
        const daysMap: Record<string, number> = { "30_days": 30, "60_days": 60, "90_days": 90 };
        const days = daysMap[decision];
        effectiveDate = new Date(Date.now() + days * 86_400_000);
        await stripe.subscriptions.update(stripeSubId, {
          cancel_at: Math.floor(effectiveDate.getTime() / 1000),
        });
        await db.update(subscriptions)
          .set({ cancelAt: effectiveDate, stripeUpdatedAt: new Date() })
          .where(eq(subscriptions.orgId, cancelReq.organizationId));
      }
    } catch (err: any) {
      console.error("[admin-cancellation] stripe action failed:", err);
      stripeActionStatus = "failed";
    }
  }

  await db.update(cancellationRequests)
    .set({
      status:                   newStatus,
      reviewedAt:               new Date(),
      reviewedByAdminId:        userId!,
      adminDecision:            decision,
      cancellationEffectiveDate: effectiveDate,
      internalNotes:            internalNotes,
      stripeActionStatus:       stripeActionStatus,
      updatedAt:                new Date(),
    })
    .where(eq(cancellationRequests.id, params.id));

  await logBillingEvent({
    organizationId:       cancelReq.organizationId,
    cancellationRequestId: params.id,
    actorUserId:          userId!,
    actorRole:            userRole!,
    action:               `cancellation_${decision}`,
    previousStatus:       "pending",
    newStatus,
    stripeActionStatus,
    metadata: { decision, effectiveDate, stripeSubId },
  });

  return NextResponse.json({ success: true, newStatus, effectiveDate });
}
