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
  stripeSubscriptionId: z.string().trim().regex(/^sub_/, "Must be a Stripe subscription id (starts with sub_)"),
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

  let sub: any;
  try {
    sub = await stripe.subscriptions.retrieve(parsed.data.stripeSubscriptionId, {
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
