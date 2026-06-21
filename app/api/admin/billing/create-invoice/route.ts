/**
 * Admin Billing Cockpit — create & send a Stripe invoice from the portal.
 *
 * POST /api/admin/billing/create-invoice   (platform/super admin only)
 *
 * Two modes, both using Stripe's HOSTED invoice (collection_method:'send_invoice')
 * so we never touch card data (zero PCI scope) and the client gets a shareable
 * Stripe-hosted payment link:
 *
 *   mode:"subscription" — custom recurring price for one customer. Creates a
 *     Stripe subscription billed by invoice; Stripe issues & emails the first
 *     invoice. Our subscriptions row is created FIRST (source:'stripe') so the
 *     existing webhook (customer.subscription.created / invoice.paid) syncs
 *     status → access automatically. This is the sales-led primary path.
 *
 *   mode:"oneoff" — a single invoice (e.g. setup fee / ad-hoc charge). Does not
 *     grant recurring access; just bills the customer.
 *
 * Stripe is the source of truth for billing — we only mirror it. We do not set
 * subscription status by hand here; the webhook does that from Stripe.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions, organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { stripe } from "@/lib/stripe";
import { requirePlatformAdmin } from "@/lib/billing";
import { logBillingEvent } from "@/lib/billing";

export const maxDuration = 60;

const lineItem = z.object({
  description: z.string().min(1).max(500),
  amount:      z.number().int().positive(), // smallest currency unit (e.g. cents/pence)
});

const schema = z.object({
  orgId:        z.string().uuid(),
  mode:         z.enum(["subscription", "oneoff"]),
  billingEmail: z.string().email(),
  currency:     z.string().min(3).max(4).default("eur"),
  daysUntilDue: z.number().int().min(0).max(365).default(14),
  // subscription mode
  amount:       z.number().int().positive().optional(),
  interval:     z.enum(["month", "year"]).optional(),
  planName:     z.string().min(1).max(128).optional(),
  // oneoff mode
  lineItems:    z.array(lineItem).optional(),
  memo:         z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const parsed = schema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const d = parsed.data;
  const currency = d.currency.toLowerCase();

  // ── Org ─────────────────────────────────────────────────────────────────
  const [org] = await db
    .select({ id: organisations.id, name: organisations.name })
    .from(organisations)
    .where(eq(organisations.id, d.orgId))
    .limit(1);
  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });

  // ── Existing subscription row (for a reusable Stripe customer) ────────────
  const [existingSub] = await db
    .select({ id: subscriptions.id, stripeCustomerId: subscriptions.stripeCustomerId, source: subscriptions.source })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, d.orgId))
    .limit(1);

  try {
    // ── Get or create the Stripe customer (1:1 with the org) ────────────────
    let customerId = existingSub?.stripeCustomerId ?? null;
    if (customerId) {
      // keep the billing email current
      await stripe.customers.update(customerId, { email: d.billingEmail }).catch(() => {});
    } else {
      const customer = await stripe.customers.create({
        name:     org.name,
        email:    d.billingEmail,
        metadata: { orgId: org.id },
      });
      customerId = customer.id;
    }

    // ───────────────────────── SUBSCRIPTION MODE ───────────────────────────
    if (d.mode === "subscription") {
      if (!d.amount || !d.interval) {
        return NextResponse.json({ error: "amount and interval are required for a subscription" }, { status: 400 });
      }
      const productId = process.env.STRIPE_PRODUCT_ID?.trim();
      if (!productId) {
        return NextResponse.json({ error: "STRIPE_PRODUCT_ID is not configured" }, { status: 500 });
      }

      // Create/refresh our subscription row FIRST so the Stripe webhook can find
      // it and sync status. source:'stripe' = Stripe-managed (webhook owns status).
      if (existingSub) {
        await db.update(subscriptions).set({
          stripeCustomerId: customerId,
          source:           "stripe",
          billingEmail:     d.billingEmail,
          planName:         d.planName ?? "Custom plan",
          planAmount:       d.amount,
          planCurrency:     currency,
          planInterval:     d.interval,
        }).where(eq(subscriptions.id, existingSub.id));
      } else {
        await db.insert(subscriptions).values({
          orgId:            org.id,
          stripeCustomerId: customerId,
          source:           "stripe",
          status:           "incomplete",
          billingEmail:     d.billingEmail,
          planName:         d.planName ?? "Custom plan",
          planAmount:       d.amount,
          planCurrency:     currency,
          planInterval:     d.interval,
        });
      }

      const sub = await stripe.subscriptions.create({
        customer:          customerId,
        collection_method: "send_invoice",
        days_until_due:    d.daysUntilDue,
        items: [{
          price_data: {
            currency,
            product:     productId,
            unit_amount: d.amount,
            recurring:   { interval: d.interval },
          },
        }],
        metadata: { orgId: org.id, createdBy: userId ?? "" },
        expand:   ["latest_invoice"],
      });

      // Persist the Stripe subscription id + the REAL status immediately, so the
      // row reflects Stripe even before the webhook lands (don't leave it stuck
      // on our placeholder "incomplete"). The webhook keeps it updated after.
      await db.update(subscriptions)
        .set({ stripeSubscriptionId: sub.id, status: sub.status, stripeUpdatedAt: new Date() })
        .where(eq(subscriptions.orgId, org.id));

      // The first invoice should be finalised & emailed so the client gets a link.
      let invoice: any = sub.latest_invoice;
      if (invoice && typeof invoice === "object") {
        if (invoice.status === "draft") {
          invoice = await stripe.invoices.finalizeInvoice(invoice.id);
          try { await stripe.invoices.sendInvoice(invoice.id); } catch { /* may already be sent */ }
        }
      }

      await logBillingEvent({
        organizationId: org.id,
        action:         "subscription_created",
        newStatus:      sub.status,
        metadata:       { mode: "subscription", amount: d.amount, currency, interval: d.interval, invoiceId: invoice?.id },
      });

      return NextResponse.json({
        ok:               true,
        mode:             "subscription",
        subscriptionId:   sub.id,
        status:           sub.status,
        invoiceId:        invoice?.id ?? null,
        hostedInvoiceUrl: invoice?.hosted_invoice_url ?? null,
        invoicePdf:       invoice?.invoice_pdf ?? null,
      });
    }

    // ───────────────────────── ONE-OFF MODE ────────────────────────────────
    const items = d.lineItems ?? [];
    if (items.length === 0) {
      return NextResponse.json({ error: "At least one line item is required for a one-off invoice" }, { status: 400 });
    }

    for (const li of items) {
      await stripe.invoiceItems.create({
        customer:    customerId,
        amount:      li.amount,
        currency,
        description: li.description,
      });
    }

    const draft = await stripe.invoices.create({
      customer:          customerId,
      collection_method: "send_invoice",
      days_until_due:    d.daysUntilDue,
      description:       d.memo,
      metadata:          { orgId: org.id, createdBy: userId ?? "", kind: "oneoff" },
      auto_advance:      true,
    });
    const finalised = await stripe.invoices.finalizeInvoice(draft.id);
    let sent = finalised;
    try { sent = await stripe.invoices.sendInvoice(finalised.id); } catch { /* already sent on finalize */ }

    await logBillingEvent({
      organizationId: org.id,
      action:         "manual_invoice_sent",
      metadata:       { mode: "oneoff", invoiceId: sent.id, total: sent.total, currency },
    });

    return NextResponse.json({
      ok:               true,
      mode:             "oneoff",
      invoiceId:        sent.id,
      status:           sent.status,
      hostedInvoiceUrl: sent.hosted_invoice_url ?? null,
      invoicePdf:       sent.invoice_pdf ?? null,
    });
  } catch (e: any) {
    console.error("[admin/billing/create-invoice]", e?.message || e);
    return NextResponse.json({ error: e?.message || "Stripe error" }, { status: 502 });
  }
}
