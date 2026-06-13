import { stripe } from "@/lib/stripe";
import { db } from "@/db";
import { subscriptions, billingAuditLogs, users } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";
import type Stripe from "stripe";

// ── Sync Stripe subscription → local DB ──────────────────────────────────

function tsToDate(epoch: number | null | undefined): Date | null {
  if (epoch == null || isNaN(epoch)) return null;
  const d = new Date(epoch * 1000);
  return isNaN(d.getTime()) ? null : d;
}

export async function syncSubscriptionFromStripe(sub: any) {
  const price   = sub.items?.data?.[0]?.price;
  const product = price?.product;
  const planName =
    typeof product === "object" && product !== null
      ? (product as Stripe.Product).name
      : undefined;

  // Payment method may already be expanded on the sub object
  let brand: string | undefined;
  let last4: string | undefined;
  const pm = sub.default_payment_method;
  if (pm && typeof pm === "object") {
    brand = pm.card?.brand ?? undefined;
    last4 = pm.card?.last4 ?? undefined;
  } else if (typeof pm === "string") {
    try {
      const pmObj = await stripe.paymentMethods.retrieve(pm);
      brand = pmObj.card?.brand ?? undefined;
      last4 = pmObj.card?.last4 ?? undefined;
    } catch { /* ignore */ }
  }

  // current_period_* may be absent on some subscription states — fall back gracefully
  const periodStart = tsToDate(sub.current_period_start);
  const periodEnd   = tsToDate(sub.current_period_end);
  const cancelAt    = tsToDate(sub.cancel_at);
  const trialEnd    = tsToDate(sub.trial_end);

  const patch: Record<string, any> = {
    stripeSubscriptionId: sub.id,
    status:               sub.status,
    cancelAtPeriodEnd:    sub.cancel_at_period_end ?? false,
    stripeUpdatedAt:      new Date(),
  };

  if (price?.id)                         patch.stripePriceId      = price.id;
  if (periodStart)                        patch.currentPeriodStart = periodStart;
  if (periodEnd)                          patch.currentPeriodEnd   = periodEnd;
  if (cancelAt !== undefined)             patch.cancelAt           = cancelAt;
  if (trialEnd !== undefined)             patch.trialEnd           = trialEnd;
  if (planName)                           patch.planName           = planName;
  if (price?.unit_amount != null)         patch.planAmount         = price.unit_amount;
  if (price?.recurring?.interval)        patch.planInterval       = price.recurring.interval;
  if (price?.currency)                   patch.planCurrency       = price.currency;
  if (brand)                             patch.paymentMethodBrand = brand;
  if (last4)                             patch.paymentMethodLast4 = last4;

  await db
    .update(subscriptions)
    .set(patch)
    .where(and(
      eq(subscriptions.stripeCustomerId, sub.customer as string),
      eq(subscriptions.source, "stripe"),  // never overwrite admin-managed rows
    ));
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

// ── Subscription access levels ───────────────────────────────────────────

export type SubscriptionAccess = "full" | "warning" | "readonly" | "blocked";

/**
 * Maps a subscription to an access level.
 * Manual subscriptions use expiry date; Stripe subscriptions use status string.
 */
export function getSubscriptionAccess(
  status: string,
  cancelAtPeriodEnd: boolean,
  source?: string | null,
  manualExpiresAt?: Date | null,
): SubscriptionAccess {
  if (source === "manual") {
    if (!manualExpiresAt) return "full";        // no expiry = unlimited admin grant
    return manualExpiresAt > new Date() ? "full" : "blocked";
  }
  // Stripe path
  if (status === "active" || status === "trialing") return "full";
  if (status === "past_due") return "warning";
  if (status === "unpaid") return "readonly";
  if (status === "canceled" || status === "cancelled" || status === "incomplete_expired") return "blocked";
  return "full";
}

/**
 * Load the org's subscription and return its access level.
 * Returns { access: "full" } when there is no subscription row (setup/trial).
 */
export async function requireActiveSubscription(
  orgId: string,
): Promise<{ access: SubscriptionAccess; status?: string }> {
  const [sub] = await db
    .select({
      status:          subscriptions.status,
      cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      source:          subscriptions.source,
      manualExpiresAt: subscriptions.manualExpiresAt,
    })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId))
    .limit(1);
  if (!sub) return { access: "full" };
  return {
    access: getSubscriptionAccess(sub.status, sub.cancelAtPeriodEnd ?? false, sub.source, sub.manualExpiresAt),
    status: sub.source === "manual"
      ? `manual:${sub.manualExpiresAt ? "active" : "unlimited"}`
      : sub.status,
  };
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
