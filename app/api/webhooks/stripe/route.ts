import { NextRequest } from "next/server";
import { db } from "@/db";
import { pendingRegistrations, organisations, users, userOrganisations, subscriptions } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { sendSystemEmail, renderPasswordResetEmail, getAppUrl } from "@/lib/system-mailer";
import { syncSubscriptionFromStripe, syncCustomerBillingEmail, logBillingEvent } from "@/lib/billing";
import crypto from "crypto";

export async function POST(req: NextRequest) {
  const body      = await req.text();
  const signature = req.headers.get("stripe-signature");

  if (!signature) return new Response("Missing signature", { status: 400 });

  let event: any;
  try {
    event = stripe.webhooks.constructEvent(body, signature, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch (err: any) {
    console.error("[stripe-webhook] signature verification failed:", err.message);
    return new Response(`Webhook error: ${err.message}`, { status: 400 });
  }

  try {
    // ── Initial checkout ──────────────────────────────────────────────────
    if (event.type === "checkout.session.completed") {
      const session   = event.data.object;
      const pendingId = session.metadata?.pendingId;
      if (!pendingId) {
        // Admin-created subscription for an EXISTING org (Checkout subscription
        // mode from the billing cockpit). Link the new auto-charging
        // subscription to the org so status/access sync.
        const metaOrgId = session.metadata?.orgId as string | undefined;
        if (metaOrgId) {
          const customerId     = session.customer as string | null;
          const subscriptionId = session.subscription as string | null;
          const [existing] = await db
            .select({ id: subscriptions.id })
            .from(subscriptions)
            .where(eq(subscriptions.orgId, metaOrgId))
            .limit(1);
          if (existing) {
            await db.update(subscriptions).set({
              stripeCustomerId:     customerId,
              stripeSubscriptionId: subscriptionId ?? undefined,
              source:               "stripe",
              stripeUpdatedAt:      new Date(),
            }).where(eq(subscriptions.id, existing.id));
          } else {
            await db.insert(subscriptions).values({
              orgId:                metaOrgId,
              stripeCustomerId:     customerId,
              stripeSubscriptionId: subscriptionId ?? undefined,
              source:               "stripe",
              status:               "active",
            });
          }
          if (subscriptionId) {
            try {
              const sub = await stripe.subscriptions.retrieve(subscriptionId, {
                expand: ["default_payment_method", "items.data.price.product"],
              });
              await syncSubscriptionFromStripe(sub);
              if (customerId) await syncCustomerBillingEmail(customerId);
            } catch (e) { console.error("[stripe-webhook] org-checkout sync:", e); }
          }
          await logBillingEvent({ organizationId: metaOrgId, action: "subscription_created", stripeEventId: event.id });
          return new Response("OK", { status: 200 });
        }
        console.warn("[stripe-webhook] no pendingId/orgId in session metadata");
        return new Response("OK", { status: 200 });
      }

      const [reg] = await db
        .select()
        .from(pendingRegistrations)
        .where(eq(pendingRegistrations.id, pendingId))
        .limit(1);

      if (!reg || reg.status === "completed") {
        return new Response("OK", { status: 200 }); // idempotent
      }

      const slug = reg.companyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 64);

      let finalSlug = slug;
      let attempt   = 0;
      while (true) {
        const [existing] = await db
          .select({ id: organisations.id })
          .from(organisations)
          .where(eq(organisations.slug, finalSlug))
          .limit(1);
        if (!existing) break;
        attempt++;
        finalSlug = `${slug}-${attempt}`;
      }

      const [org] = await db.insert(organisations).values({
        name: reg.companyName,
        slug: finalSlug,
      }).returning();

      const resetToken  = crypto.randomBytes(32).toString("hex");
      const resetExpiry = new Date(Date.now() + 72 * 60 * 60 * 1000);
      const tempPasswordHash = crypto.randomBytes(32).toString("hex");

      const [admin] = await db.insert(users).values({
        orgId:            org.id,
        name:             reg.adminName,
        email:            reg.adminEmail,
        passwordHash:     tempPasswordHash,
        role:             "company_admin",
        status:           "Active",
        resetToken,
        resetTokenExpiry: resetExpiry,
      }).returning({ id: users.id, name: users.name, email: users.email });

      await db.insert(userOrganisations).values({
        userId: admin.id,
        orgId:  org.id,
        role:   "company_admin",
      }).onConflictDoNothing();

      const subscriptionId = session.subscription as string | null;
      const [newSub] = await db.insert(subscriptions).values({
        orgId:                org.id,
        stripeCustomerId:     session.customer as string,
        stripeSubscriptionId: subscriptionId ?? undefined,
        stripePriceId:        process.env.STRIPE_PRICE_ID ?? null,
        status:               "active",
      }).returning();

      // Sync full subscription details
      if (subscriptionId) {
        try {
          const sub = await stripe.subscriptions.retrieve(subscriptionId, {
            expand: ["default_payment_method", "items.data.price.product"],
          });
          await syncSubscriptionFromStripe(sub);
          await syncCustomerBillingEmail(session.customer as string);
        } catch { /* non-fatal */ }
      }

      await db.update(pendingRegistrations)
        .set({ status: "completed" })
        .where(eq(pendingRegistrations.id, pendingId));

      const resetUrl = `${getAppUrl()}/reset-password?token=${resetToken}`;
      await sendSystemEmail({
        to:      admin.email,
        subject: `Welcome to Prime Accountax — set your password to get started`,
        html:    renderPasswordResetEmail({ name: admin.name, resetUrl }),
      });

      console.log(`[stripe-webhook] org created: ${org.slug}, admin: ${admin.email}`);
    }

    // ── Checkout expired ─────────────────────────────────────────────────
    if (event.type === "checkout.session.expired") {
      const session   = event.data.object;
      const pendingId = session.metadata?.pendingId;
      if (pendingId) {
        await db.delete(pendingRegistrations).where(eq(pendingRegistrations.id, pendingId));
        console.log(`[stripe-webhook] expired session cleaned up: ${pendingId}`);
      }
    }

    // ── Subscription created / updated ───────────────────────────────────
    if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated") {
      const sub = event.data.object as any;
      try {
        const fullSub = await stripe.subscriptions.retrieve(sub.id, {
          expand: ["default_payment_method", "items.data.price.product"],
        });
        await syncSubscriptionFromStripe(fullSub);
        await syncCustomerBillingEmail(sub.customer as string);

        const [subRow] = await db
          .select({ orgId: subscriptions.orgId })
          .from(subscriptions)
          .where(eq(subscriptions.stripeCustomerId, sub.customer as string))
          .limit(1);

        if (subRow) {
          await logBillingEvent({
            organizationId: subRow.orgId,
            action: event.type === "customer.subscription.created" ? "subscription_created" : "subscription_updated",
            newStatus: fullSub.status,
            stripeEventId: event.id,
          });
        }
      } catch (err) {
        console.error("[stripe-webhook] subscription sync error:", err);
      }
    }

    // ── Subscription deleted ─────────────────────────────────────────────
    if (event.type === "customer.subscription.deleted") {
      const sub = event.data.object as any;
      const [subRow] = await db
        .select({ orgId: subscriptions.orgId })
        .from(subscriptions)
        .where(eq(subscriptions.stripeSubscriptionId, sub.id))
        .limit(1);

      await db
        .update(subscriptions)
        .set({ status: "cancelled", cancelAt: null, cancelAtPeriodEnd: false, stripeUpdatedAt: new Date() })
        .where(and(eq(subscriptions.stripeSubscriptionId, sub.id), eq(subscriptions.source, "stripe")));

      if (subRow) {
        await logBillingEvent({
          organizationId: subRow.orgId,
          action: "subscription_cancelled",
          newStatus: "cancelled",
          stripeEventId: event.id,
        });
      }
      console.log(`[stripe-webhook] subscription cancelled: ${sub.id}`);
    }

    // ── Invoice paid ─────────────────────────────────────────────────────
    if (event.type === "invoice.paid") {
      const inv        = event.data.object as any;
      const customerId = inv.customer as string;
      await db
        .update(subscriptions)
        .set({
          lastPaymentStatus: "paid",
          lastPaymentAmount: inv.amount_paid,
          lastPaymentDate:   new Date(inv.created * 1000),
          stripeUpdatedAt:   new Date(),
        })
        .where(and(eq(subscriptions.stripeCustomerId, customerId), eq(subscriptions.source, "stripe")));

      // Re-sync the subscription's STATUS on payment. Paying the first invoice
      // moves a subscription incomplete → active; relying on a separate
      // customer.subscription.updated event is fragile (it may not be enabled on
      // the webhook). invoice.paid is the authoritative "money received" signal,
      // so we refresh status here too. (API version note: the subscription id
      // moved to invoice.parent.subscription_details in newer API versions.)
      const subId: string | null =
        inv.subscription ?? inv.parent?.subscription_details?.subscription ?? null;
      if (subId) {
        try {
          const fullSub = await stripe.subscriptions.retrieve(subId, {
            expand: ["default_payment_method", "items.data.price.product"],
          });
          await syncSubscriptionFromStripe(fullSub);

          const [subRow] = await db
            .select({ orgId: subscriptions.orgId })
            .from(subscriptions)
            .where(eq(subscriptions.stripeCustomerId, customerId))
            .limit(1);
          if (subRow) {
            await logBillingEvent({
              organizationId: subRow.orgId,
              action:         "invoice_paid",
              newStatus:      fullSub.status,
              stripeEventId:  event.id,
              metadata:       { invoiceId: inv.id, amountPaid: inv.amount_paid },
            });
          }
        } catch (err) {
          console.error("[stripe-webhook] invoice.paid subscription re-sync error:", err);
        }
      }
    }

    // ── Invoice payment failed ────────────────────────────────────────────
    if (event.type === "invoice.payment_failed") {
      const inv        = event.data.object as any;
      const customerId = inv.customer as string;
      await db
        .update(subscriptions)
        .set({ lastPaymentStatus: "failed", stripeUpdatedAt: new Date() })
        .where(and(eq(subscriptions.stripeCustomerId, customerId), eq(subscriptions.source, "stripe")));

      const [subRow] = await db
        .select({ orgId: subscriptions.orgId })
        .from(subscriptions)
        .where(eq(subscriptions.stripeCustomerId, customerId))
        .limit(1);

      if (subRow) {
        await logBillingEvent({
          organizationId: subRow.orgId,
          action: "payment_failed",
          stripeEventId: event.id,
          metadata: { invoiceId: inv.id, attemptCount: inv.attempt_count },
        });
      }
    }

    // ── Invoice payment action required ──────────────────────────────────
    if (event.type === "invoice.payment_action_required") {
      const inv = event.data.object as any;
      await db
        .update(subscriptions)
        .set({ lastPaymentStatus: "action_required", stripeUpdatedAt: new Date() })
        .where(eq(subscriptions.stripeCustomerId, inv.customer as string));
    }

  } catch (err: any) {
    console.error("[stripe-webhook] handler error:", err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response("OK", { status: 200 });
}
