import { stripe } from "@/lib/stripe";
import { db } from "@/db";
import { subscriptions, billingAuditLogs, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

// ── Sync Stripe subscription → local DB ──────────────────────────────────

export async function syncSubscriptionFromStripe(sub: any) {
  const price   = sub.items.data[0]?.price;
  const product = price?.product;
  const planName =
    typeof product === "object" && product !== null
      ? (product as Stripe.Product).name
      : undefined;

  const pmId = sub.default_payment_method;
  let brand: string | undefined;
  let last4: string | undefined;
  if (typeof pmId === "string") {
    try {
      const pm = await stripe.paymentMethods.retrieve(pmId);
      brand = pm.card?.brand ?? undefined;
      last4 = pm.card?.last4 ?? undefined;
    } catch { /* ignore */ }
  }

  await db
    .update(subscriptions)
    .set({
      stripeSubscriptionId: sub.id,
      stripePriceId:        price?.id,
      status:               sub.status,
      currentPeriodStart:   new Date(sub.current_period_start * 1000),
      currentPeriodEnd:     new Date(sub.current_period_end * 1000),
      cancelAt:             sub.cancel_at ? new Date(sub.cancel_at * 1000) : null,
      cancelAtPeriodEnd:    sub.cancel_at_period_end,
      trialEnd:             sub.trial_end ? new Date(sub.trial_end * 1000) : null,
      planName,
      planAmount:           price?.unit_amount ?? undefined,
      planInterval:         price?.recurring?.interval ?? undefined,
      planCurrency:         price?.currency ?? undefined,
      paymentMethodBrand:   brand,
      paymentMethodLast4:   last4,
      stripeUpdatedAt:      new Date(),
    })
    .where(eq(subscriptions.stripeCustomerId, sub.customer as string));
}

// ── Sync Stripe customer billing email → local DB ─────────────────────────

export async function syncCustomerBillingEmail(customerId: string) {
  try {
    const customer = await stripe.customers.retrieve(customerId) as any;
    if (customer.deleted) return;
    const email = customer.email ?? undefined;
    if (email) {
      await db
        .update(subscriptions)
        .set({ billingEmail: email })
        .where(eq(subscriptions.stripeCustomerId, customerId));
    }
  } catch { /* ignore */ }
}

// ── Record billing audit event ────────────────────────────────────────────

export async function logBillingEvent(opts: {
  organizationId?: string | null;
  cancellationRequestId?: string | null;
  actorUserId?: string | null;
  actorRole?: string;
  action: string;
  previousStatus?: string;
  newStatus?: string;
  stripeEventId?: string;
  stripeActionStatus?: string;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.insert(billingAuditLogs).values({
      organizationId:        opts.organizationId ?? null,
      cancellationRequestId: opts.cancellationRequestId ?? null,
      actorUserId:           opts.actorUserId ?? null,
      actorRole:             opts.actorRole,
      action:                opts.action,
      previousStatus:        opts.previousStatus,
      newStatus:             opts.newStatus,
      stripeEventId:         opts.stripeEventId,
      stripeActionStatus:    opts.stripeActionStatus,
      metadata:              opts.metadata,
    });
  } catch (err) {
    console.error("[billing-audit] failed to log event:", err);
  }
}

// ── requirePlatformAdmin — use inside API routes ──────────────────────────

export async function requirePlatformAdmin() {
  const session = await auth();
  if (!session?.user) {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      userId: null, userName: null, userEmail: null, userRole: null,
    };
  }
  const userId = (session.user as any).id as string;
  const [userRow] = await db
    .select({ id: users.id, role: users.role, status: users.status, name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!userRow || userRow.status !== "Active") {
    return {
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      userId: null, userName: null, userEmail: null, userRole: null,
    };
  }
  if (userRow.role !== "platform_admin" && userRow.role !== "super_admin") {
    return {
      error: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
      userId: null, userName: null, userEmail: null, userRole: null,
    };
  }
  return {
    error: null,
    userId: userRow.id,
    userName: userRow.name,
    userEmail: userRow.email,
    userRole: userRow.role,
  };
}
