/**
 * Admin — update the Stripe Customer record's display name for an org.
 *
 * PATCH /api/admin/billing/org/:orgId/customer
 *   { name }
 *
 * Only touches the Stripe Customer object (name shown on the Stripe dashboard
 * and used as the default for any FUTURE invoice generated for this customer).
 * Stripe snapshots the customer's name onto an invoice at creation/finalize
 * time — this does NOT rewrite the name on invoices that already exist.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { stripe } from "@/lib/stripe";
import { requirePlatformAdmin, logBillingEvent } from "@/lib/billing";

export const maxDuration = 30;

const schema = z.object({ name: z.string().trim().min(1).max(255) });

/**
 * GET /api/admin/billing/org/:orgId/customer
 *
 * Existing Stripe customer's billing details, for prefilling the "Create
 * Stripe invoice" form — so re-invoicing an org (e.g. after voiding) doesn't
 * require retyping an address Stripe already has on file. Returns null
 * fields (not an error) when there's no Stripe customer yet — a brand-new
 * org is the normal case, not a failure.
 */
export async function GET(_req: Request, { params }: { params: { orgId: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const [sub] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, params.orgId))
    .limit(1);
  if (!sub?.stripeCustomerId) return NextResponse.json({ exists: false });

  try {
    const customer = await stripe.customers.retrieve(sub.stripeCustomerId);
    if ((customer as any).deleted) return NextResponse.json({ exists: false });
    const c = customer as any;
    return NextResponse.json({
      exists: true,
      name: c.name ?? null,
      email: c.email ?? null,
      address: {
        line1: c.address?.line1 ?? null,
        city: c.address?.city ?? null,
        state: c.address?.state ?? null,
        postalCode: c.address?.postal_code ?? null,
        country: c.address?.country ?? null,
      },
    });
  } catch (e: any) {
    console.error("[admin/billing/org/customer GET]", e?.message || e);
    return NextResponse.json({ exists: false });
  }
}

export async function PATCH(req: Request, { params }: { params: { orgId: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });

  const [sub] = await db
    .select({ id: subscriptions.id, stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, params.orgId))
    .limit(1);
  if (!sub?.stripeCustomerId) {
    return NextResponse.json({ error: "No Stripe customer for this organisation yet" }, { status: 400 });
  }

  try {
    const customer = await stripe.customers.update(sub.stripeCustomerId, { name: parsed.data.name });
    await logBillingEvent({
      organizationId: params.orgId, actorUserId: userId,
      action: "stripe_customer_renamed",
      metadata: { stripeCustomerId: sub.stripeCustomerId, name: parsed.data.name },
    });
    return NextResponse.json({ ok: true, name: customer.name });
  } catch (e: any) {
    console.error("[admin/billing/org/customer]", e?.message || e);
    return NextResponse.json({ error: e?.message || "Stripe error" }, { status: 502 });
  }
}
