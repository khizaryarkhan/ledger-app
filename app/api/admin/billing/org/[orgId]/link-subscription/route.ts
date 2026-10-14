/**
 * Admin — link an org's billing row to an EXISTING Stripe subscription.
 *
 * POST /api/admin/billing/org/:orgId/link-subscription
 *   { stripeSubscriptionId }
 *
 * For when a subscription was created directly in Stripe (or via a manual
 * repair) and our own `subscriptions` row never learned its id — e.g. the
 * webhook step that normally does this silently failed (see
 * subscription_activation_failed in app/api/webhooks/stripe/route.ts).
 *
 * This never creates or modifies anything in Stripe — read-only against the
 * Stripe API, then mirrors what's already there into our DB via the same
 * syncSubscriptionFromStripe() helper the webhook uses.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { stripe } from "@/lib/stripe";
import { requirePlatformAdmin, logBillingEvent, syncSubscriptionFromStripe } from "@/lib/billing";

export const maxDuration = 30;

const schema = z.object({
  // Accepts either a real Subscription id (sub_...) or a Subscription
  // Schedule id (sub_sched_...) — the latter is what Stripe Dashboard gives
  // you when you schedule a future-dated subscription (see CLAUDE.md,
  // 2026-10-14: ACC was scheduled to start 2026-11-09). Both start "sub_".
  stripeSubscriptionId: z.string().trim().regex(/^sub_/, "Must be a Stripe subscription or subscription schedule id (starts with sub_)"),
});

export async function POST(req: Request, { params }: { params: { orgId: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });

  const [existing] = await db
    .select({ id: subscriptions.id })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, params.orgId))
    .limit(1);
  if (!existing) {
    return NextResponse.json({ error: "No billing row for this organisation yet — create one via \"Create Stripe invoice\" first." }, { status: 400 });
  }

  // A Subscription Schedule has no real Subscription behind it until its
  // current phase actually starts — resolve it to the real id first, with a
  // clear, specific message instead of a generic "could not find" 404 when
  // the schedule hasn't started yet (stripe.subscriptions.retrieve rejects a
  // sub_sched_ id outright, since it's a different API resource).
  let subscriptionId = parsed.data.stripeSubscriptionId;
  if (subscriptionId.startsWith("sub_sched_")) {
    let schedule: any;
    try {
      schedule = await stripe.subscriptionSchedules.retrieve(subscriptionId);
    } catch (e: any) {
      return NextResponse.json({ error: e?.message || "Could not find that subscription schedule in Stripe" }, { status: 404 });
    }
    if (!schedule.subscription) {
      const startDate = schedule.phases?.[0]?.start_date
        ? new Date(schedule.phases[0].start_date * 1000).toISOString().slice(0, 10)
        : "its scheduled date";
      return NextResponse.json({
        error: `This is a Subscription Schedule, not a Subscription yet — it hasn't started (status: ${schedule.status}). Stripe won't create the real subscription until ${startDate}. Come back and link again once it has.`,
      }, { status: 400 });
    }
    subscriptionId = typeof schedule.subscription === "string" ? schedule.subscription : schedule.subscription.id;
  }

  let sub: any;
  try {
    sub = await stripe.subscriptions.retrieve(subscriptionId, {
      expand: ["default_payment_method", "items.data.price.product"],
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Could not find that subscription in Stripe" }, { status: 404 });
  }

  // Refuse to silently steal a subscription already linked to a DIFFERENT org.
  const [clash] = await db
    .select({ orgId: subscriptions.orgId })
    .from(subscriptions)
    .where(eq(subscriptions.stripeSubscriptionId, sub.id))
    .limit(1);
  if (clash && clash.orgId !== params.orgId) {
    return NextResponse.json({ error: `This Stripe subscription is already linked to a different organisation (${clash.orgId}).` }, { status: 409 });
  }

  // syncSubscriptionFromStripe() matches rows by stripeCustomerId — point this
  // org's row at the subscription's real customer FIRST, so the sync below
  // finds and updates it.
  await db.update(subscriptions).set({
    stripeCustomerId: sub.customer as string,
    source:           "stripe",
    stripeUpdatedAt:  new Date(),
  }).where(eq(subscriptions.orgId, params.orgId));

  await syncSubscriptionFromStripe(sub);

  await logBillingEvent({
    organizationId: params.orgId,
    actorUserId:    userId,
    action:         "subscription_manually_linked",
    newStatus:      sub.status,
    metadata:       { stripeSubscriptionId: sub.id, stripeCustomerId: sub.customer },
  });

  return NextResponse.json({ ok: true, status: sub.status });
}
