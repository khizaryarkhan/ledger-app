/**
 * GET /api/admin/billing/webhook-health
 *
 * Stripe webhook observability — answers "is Stripe actually reaching us?"
 * without touching the Stripe dashboard. Reads the stripe_webhook_events
 * audit table: recent events, error counts, and how long since the last
 * delivery. A silent webhook (misconfigured endpoint/secret) shows up here
 * as a stale lastReceivedAt.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { stripeWebhookEvents } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { desc, sql } from "drizzle-orm";

export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  try {
    const recent = await db
      .select({
        id: stripeWebhookEvents.id,
        eventType: stripeWebhookEvents.eventType,
        status: stripeWebhookEvents.status,
        error: stripeWebhookEvents.error,
        createdAt: stripeWebhookEvents.receivedAt,
      })
      .from(stripeWebhookEvents)
      .orderBy(desc(stripeWebhookEvents.receivedAt))
      .limit(20);

    const [counts] = await db
      .select({
        total:     sql<number>`count(*)::int`,
        errors:    sql<number>`count(*) filter (where ${stripeWebhookEvents.status} = 'error')::int`,
        last7d:    sql<number>`count(*) filter (where ${stripeWebhookEvents.receivedAt} > now() - interval '7 days')::int`,
        errors7d:  sql<number>`count(*) filter (where ${stripeWebhookEvents.status} = 'error' and ${stripeWebhookEvents.receivedAt} > now() - interval '7 days')::int`,
      })
      .from(stripeWebhookEvents);

    const lastReceivedAt = recent[0]?.createdAt ?? null;
    const hoursSinceLast = lastReceivedAt
      ? Math.floor((Date.now() - new Date(lastReceivedAt).getTime()) / 3_600_000)
      : null;

    return NextResponse.json({
      configuredSecret: !!process.env.STRIPE_WEBHOOK_SECRET,
      lastReceivedAt,
      hoursSinceLast,
      counts: counts ?? { total: 0, errors: 0, last7d: 0, errors7d: 0 },
      recent,
      hint: !process.env.STRIPE_WEBHOOK_SECRET
        ? "STRIPE_WEBHOOK_SECRET is not set — webhook signatures cannot be verified and all deliveries are rejected."
        : recent.length === 0
        ? "No webhook events have EVER been recorded — check the endpoint URL and enabled events in the Stripe dashboard (need: checkout.session.completed, customer.subscription.*, invoice.paid, invoice.payment_failed)."
        : undefined,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Failed to read webhook events" }, { status: 500 });
  }
}
