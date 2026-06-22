/**
 * Admin — change a Stripe subscription's recurring price in place.
 *
 * POST /api/admin/subscriptions/:id/change-price
 *   { amount, interval, prorate? }
 *
 * Swaps the subscription item to a new custom price (same currency). With
 * prorate:true (default) Stripe credits/charges the difference for the rest of
 * the current period; with prorate:false the new price simply applies from the
 * next invoice. The saved card is charged automatically as before.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { stripe } from "@/lib/stripe";
import { requirePlatformAdmin, logBillingEvent } from "@/lib/billing";

export const maxDuration = 60;

const schema = z.object({
  amount:   z.number().int().positive(),         // smallest currency unit
  interval: z.enum(["month", "year"]),
  prorate:  z.boolean().optional().default(true),
});

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  const d = parsed.data;

  const [sub] = await db
    .select({ id: subscriptions.id, orgId: subscriptions.orgId, source: subscriptions.source, stripeSubscriptionId: subscriptions.stripeSubscriptionId, planCurrency: subscriptions.planCurrency })
    .from(subscriptions).where(eq(subscriptions.id, params.id)).limit(1);

  if (!sub) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (sub.source !== "stripe" || !sub.stripeSubscriptionId) {
    return NextResponse.json({ error: "Not a Stripe subscription" }, { status: 400 });
  }
  const productId = process.env.STRIPE_PRODUCT_ID?.trim();
  if (!productId) return NextResponse.json({ error: "STRIPE_PRODUCT_ID not configured" }, { status: 500 });

  try {
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId);
    const item = stripeSub.items.data[0];
    const currency = item?.price?.currency ?? (sub.planCurrency ?? "gbp").toLowerCase();

    await stripe.subscriptions.update(sub.stripeSubscriptionId, {
      items: [{
        id: item.id,
        price_data: { currency, product: productId, unit_amount: d.amount, recurring: { interval: d.interval } },
      }],
      proration_behavior: d.prorate ? "create_prorations" : "none",
    });

    await db.update(subscriptions)
      .set({ planAmount: d.amount, planInterval: d.interval, stripeUpdatedAt: new Date() })
      .where(eq(subscriptions.id, sub.id));

    await logBillingEvent({
      organizationId: sub.orgId, actorUserId: userId,
      action: "subscription_price_changed",
      metadata: { amount: d.amount, interval: d.interval, prorate: d.prorate },
    });

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error("[admin/subscriptions/change-price]", e?.message || e);
    return NextResponse.json({ error: e?.message || "Stripe error" }, { status: 502 });
  }
}
