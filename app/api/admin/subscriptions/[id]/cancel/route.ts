/**
 * Admin — cancel a STRIPE subscription (revoke access).
 *
 * POST /api/admin/subscriptions/:id/cancel   { atPeriodEnd?: boolean }
 *
 * Cancels the subscription in Stripe (Stripe = source of truth). The webhook
 * (customer.subscription.updated/deleted) syncs status → access, but we also
 * write the status immediately for instant UI feedback.
 *   - atPeriodEnd:false (default) → cancel now, access off immediately.
 *   - atPeriodEnd:true           → cancel at period end (keeps access until then).
 *
 * (Manual subscriptions are cancelled via the existing PATCH "suspend" action;
 * this endpoint is for Stripe-managed rows, which that route refuses.)
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { requirePlatformAdmin, logBillingEvent } from "@/lib/billing";

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const [sub] = await db
    .select({
      id: subscriptions.id, orgId: subscriptions.orgId, source: subscriptions.source,
      stripeSubscriptionId: subscriptions.stripeSubscriptionId,
    })
    .from(subscriptions)
    .where(eq(subscriptions.id, params.id))
    .limit(1);

  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (sub.source !== "stripe" || !sub.stripeSubscriptionId) {
    return NextResponse.json({ error: "Not a Stripe subscription — use the manual controls instead." }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const atPeriodEnd = body?.atPeriodEnd === true;

  try {
    if (atPeriodEnd) {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: true });
      await db.update(subscriptions)
        .set({ cancelAtPeriodEnd: true, stripeUpdatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id));
    } else {
      await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
      await db.update(subscriptions)
        .set({ status: "canceled", cancelAtPeriodEnd: false, stripeUpdatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id));
    }

    await logBillingEvent({
      organizationId: sub.orgId,
      actorUserId:    userId,
      action:         atPeriodEnd ? "subscription_cancel_scheduled" : "subscription_cancelled",
      newStatus:      atPeriodEnd ? undefined : "canceled",
      metadata:       { stripeSubscriptionId: sub.stripeSubscriptionId, atPeriodEnd },
    });

    return NextResponse.json({ ok: true, atPeriodEnd });
  } catch (e: any) {
    console.error("[admin/subscriptions/cancel]", e?.message || e);
    return NextResponse.json({ error: e?.message || "Stripe error" }, { status: 502 });
  }
}
