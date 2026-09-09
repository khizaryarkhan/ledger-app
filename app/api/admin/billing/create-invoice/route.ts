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
import { subscriptions, organisations, crmAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { stripe } from "@/lib/stripe";
import { requirePlatformAdmin } from "@/lib/billing";
import { logBillingEvent } from "@/lib/billing";
import { logActivity } from "@/lib/admin/activities";
import { sendSystemEmail } from "@/lib/system-mailer";

/**
 * Stripe does NOT email charge_automatically invoices (and only emails
 * send_invoice ones if the dashboard setting is on) — so we always send our
 * own branded email with the hosted payment link. Failure is surfaced in the
 * response (emailSent) so the admin knows to share the link manually.
 */
async function emailInvoiceLink(opts: { to: string; orgName: string; hostedUrl: string; amountLabel: string; kind: string }): Promise<boolean> {
  try {
    await sendSystemEmail({
      to: opts.to,
      subject: `Your Prime Accountax invoice — ${opts.amountLabel}`,
      html: `
<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1917;max-width:560px;">
  <h2 style="margin:0 0 12px;">Invoice for ${opts.orgName}</h2>
  <p>Please find your ${opts.kind} invoice below. You can view and pay it securely online:</p>
  <p style="margin:24px 0;">
    <a href="${opts.hostedUrl}" style="background:#059669;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:8px;font-weight:600;display:inline-block;">View &amp; pay invoice — ${opts.amountLabel}</a>
  </p>
  <p style="color:#78716c;font-size:13px;">Payment is processed securely by Stripe. Once payment is received, your account access will be activated automatically.</p>
  <p style="color:#78716c;font-size:13px;">If the button doesn't work, copy this link:<br/><a href="${opts.hostedUrl}">${opts.hostedUrl}</a></p>
</div>`,
    });
    return true;
  } catch (e: any) {
    console.error("[create-invoice] invoice email failed:", e?.message);
    return false;
  }
}

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
  planName:     z.string().min(1).max(1000).optional(),
  // oneoff mode
  lineItems:    z.array(lineItem).optional(),
  memo:         z.string().max(1000).optional(),
  // optional discount (subscription mode)
  couponId:     z.string().trim().optional(),
  // customer location (for tax / records). country = ISO 3166-1 alpha-2.
  country:      z.string().trim().length(2).optional(),
  state:        z.string().trim().max(40).optional(),
  postalCode:   z.string().trim().max(20).optional(),
  city:         z.string().trim().max(100).optional(),
  line1:        z.string().trim().max(200).optional(),
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
    .select({ id: organisations.id, name: organisations.name, accountId: organisations.accountId })
    .from(organisations)
    .where(eq(organisations.id, d.orgId))
    .limit(1);
  if (!org) return NextResponse.json({ error: "Organisation not found" }, { status: 404 });

  // "Billed" trigger: stamp the account's first-invoiced time so it moves out of
  // the Accounts action-queue into the Customers book. Best-effort, set-once.
  const markBilled = async () => {
    if (!org.accountId) return;
    try { await db.update(crmAccounts).set({ firstInvoicedAt: new Date(), updatedAt: new Date() }).where(eq(crmAccounts.id, org.accountId)); } catch {}
  };

  // ── Existing subscription row (for a reusable Stripe customer) ────────────
  const [existingSub] = await db
    .select({ id: subscriptions.id, stripeCustomerId: subscriptions.stripeCustomerId, source: subscriptions.source, stripeSubscriptionId: subscriptions.stripeSubscriptionId })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, d.orgId))
    .limit(1);

  try {
    // Customer location — needed for Stripe Tax and good billing records.
    const address = d.country
      ? {
          country:     d.country.toUpperCase(),
          ...(d.state ? { state: d.state } : {}),
          ...(d.postalCode ? { postal_code: d.postalCode } : {}),
          ...(d.city ? { city: d.city } : {}),
          ...(d.line1 ? { line1: d.line1 } : {}),
        }
      : undefined;

    // ── Get or create the Stripe customer (1:1 with the org) ────────────────
    let customerId = existingSub?.stripeCustomerId ?? null;
    if (customerId) {
      // keep the billing email + address current
      await stripe.customers.update(customerId, { email: d.billingEmail, ...(address ? { address } : {}) }).catch(() => {});
    } else {
      const customer = await stripe.customers.create({
        name:     org.name,
        email:    d.billingEmail,
        ...(address ? { address } : {}),
        metadata: { orgId: org.id },
      });
      customerId = customer.id;
    }

    // ───────────────────────── SUBSCRIPTION MODE ───────────────────────────
    if (d.mode === "subscription") {
      if (!d.amount || !d.interval) {
        return NextResponse.json({ error: "amount and interval are required for a subscription" }, { status: 400 });
      }

      // Refuse to spin up a second, competing subscription if a live one already
      // exists for this org — direct the admin at the dedicated re-invoice tool
      // instead. A dead subscription (voided/expired) doesn't block; clear it so
      // this request can start a fresh one.
      if (existingSub?.stripeSubscriptionId) {
        let liveStatus: string | null = null;
        try {
          const s = await stripe.subscriptions.retrieve(existingSub.stripeSubscriptionId);
          liveStatus = s.status;
        } catch { /* already gone in Stripe — treat as dead */ }
        if (liveStatus && liveStatus !== "canceled" && liveStatus !== "incomplete_expired") {
          return NextResponse.json({ error: `This org already has an active Stripe subscription (${liveStatus}). Use "Generate new invoice" on that subscription instead of creating a new one.` }, { status: 400 });
        }
        await db.update(subscriptions).set({ stripeSubscriptionId: null }).where(eq(subscriptions.id, existingSub.id));
      }

      const fallbackProductId = process.env.STRIPE_PRODUCT_ID?.trim();
      if (!fallbackProductId) {
        return NextResponse.json({ error: "STRIPE_PRODUCT_ID is not configured" }, { status: 500 });
      }
      // A custom plan name gets its OWN Stripe Product (rather than reusing the
      // shared fallback product) so it actually appears as the invoice line's
      // description — previously planName was only stored in our own
      // subscriptions table and never reached Stripe at all, so every invoice
      // showed the generic shared product name regardless of what was typed
      // here. Supports multi-line text (the admin form now uses a textarea);
      // whether line breaks render distinctly on the hosted/PDF invoice is up
      // to Stripe's own template.
      let productId = fallbackProductId;
      if (d.planName && d.planName.trim()) {
        const product = await stripe.products.create({
          name: d.planName.trim(),
          metadata: { orgId: org.id },
        });
        productId = product.id;
      }
      // subscriptions.planName is varchar(128) — an internal short label, not
      // the Stripe-facing description (which carries the full text above via
      // the Product name, with no such limit). Collapse to one line + truncate
      // so a long multi-line plan description never fails this insert/update.
      const planNameForDb = (d.planName ?? "Custom plan").replace(/\s*\n\s*/g, " · ").slice(0, 128);

      // Create/refresh our subscription row FIRST so the Stripe webhook can find
      // it and sync status. source:'stripe' = Stripe-managed (webhook owns status).
      if (existingSub) {
        await db.update(subscriptions).set({
          stripeCustomerId: customerId,
          source:           "stripe",
          billingEmail:     d.billingEmail,
          planName:         planNameForDb,
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
          planName:         planNameForDb,
          planAmount:       d.amount,
          planCurrency:     currency,
          planInterval:     d.interval,
        });
      }

      // Invoice-first recurring billing, done in two steps so "days until due"
      // is a real, Stripe-enforced grace period instead of the 23-hour cliff:
      //
      //   Step 1 (here): a STANDALONE invoice — collection_method:'send_invoice',
      //     days_until_due: the admin's actual value — for the first period's
      //     amount. No Stripe subscription exists yet, so there is nothing for
      //     Stripe to auto-expire/void if the customer takes longer than a day
      //     to pay (Stripe's docs: a charge_automatically subscription's first
      //     invoice, unpaid within 23 hours, transitions to incomplete_expired
      //     — "terminal status, the open invoice will be voided" — which is
      //     exactly what happened to a real customer invoice and is why this
      //     was rebuilt; see CLAUDE.md).
      //   Step 2 (app/api/webhooks/stripe/route.ts's invoice.paid handler):
      //     once this invoice is actually paid, create the REAL recurring
      //     subscription (collection_method:'charge_automatically') using the
      //     payment method just used, with trial_end set one interval out so
      //     the period already paid for here isn't billed again — auto-charge
      //     starts cleanly at period 2.
      const draft = await stripe.invoices.create({
        customer:          customerId,
        collection_method: "send_invoice",
        days_until_due:    d.daysUntilDue,
        description:       d.planName,
        ...(d.couponId ? { discounts: [{ coupon: d.couponId }] } : {}),
        metadata: {
          orgId: org.id, createdBy: userId ?? "", purpose: "subscription_first_invoice",
          productId, planAmount: String(d.amount), planCurrency: currency, planInterval: d.interval,
          ...(d.couponId ? { couponId: d.couponId } : {}),
        },
        auto_advance: true,
      });
      await stripe.invoiceItems.create({
        customer:    customerId,
        invoice:     draft.id,
        amount:      d.amount,
        currency,
        description: planNameForDb,
      });
      let invoice: any = await stripe.invoices.finalizeInvoice(draft.id);
      try { invoice = await stripe.invoices.sendInvoice(invoice.id); } catch { /* already sent on finalize */ }

      await logBillingEvent({
        organizationId: org.id,
        action:         "subscription_first_invoice_sent",
        metadata:       { mode: "subscription", amount: d.amount, currency, interval: d.interval, invoiceId: invoice?.id },
      });
      await logActivity({
        type: "invoice_issued", title: `Invoice issued — ${planNameForDb} (${d.interval})`.slice(0, 300),
        orgId: org.id, actorId: userId,
        meta: { mode: "subscription", amount: d.amount, currency, interval: d.interval, invoiceId: invoice?.id, hostedInvoiceUrl: invoice?.hosted_invoice_url ?? null },
      });
      await markBilled();

      // Stripe's own dashboard setting decides whether it also emails
      // send_invoice invoices — always send ours too, belt-and-braces.
      let emailSent = false;
      if (invoice?.hosted_invoice_url) {
        const amountLabel = new Intl.NumberFormat("en-IE", { style: "currency", currency: currency.toUpperCase() }).format((d.amount ?? 0) / 100) + `/${d.interval}`;
        emailSent = await emailInvoiceLink({ to: d.billingEmail, orgName: org.name, hostedUrl: invoice.hosted_invoice_url, amountLabel, kind: "subscription" });
      }

      return NextResponse.json({
        ok:               true,
        mode:             "subscription",
        recurring:        true,
        pending:          true, // no Stripe subscription exists yet — it's created once this invoice is paid
        invoiceId:        invoice?.id ?? null,
        hostedInvoiceUrl: invoice?.hosted_invoice_url ?? null,
        invoicePdf:       invoice?.invoice_pdf ?? null,
        emailSent,
      });
    }

    // ───────────────────────── ONE-OFF MODE ────────────────────────────────
    const items = d.lineItems ?? [];
    if (items.length === 0) {
      return NextResponse.json({ error: "At least one line item is required for a one-off invoice" }, { status: 400 });
    }

    // Create the draft invoice FIRST, then attach each line item directly to it
    // via `invoice: draft.id`. (Creating floating invoice items and relying on
    // the invoice to auto-collect them finalises at $0 on the current Stripe API.)
    const draft = await stripe.invoices.create({
      customer:          customerId,
      collection_method: "send_invoice",
      days_until_due:    d.daysUntilDue,
      description:       d.memo,
      metadata:          { orgId: org.id, createdBy: userId ?? "", kind: "oneoff" },
      auto_advance:      true,
    });

    for (const li of items) {
      await stripe.invoiceItems.create({
        customer:    customerId,
        invoice:     draft.id,
        amount:      li.amount,
        currency,
        description: li.description,
      });
    }

    const finalised = await stripe.invoices.finalizeInvoice(draft.id);
    if ((finalised.total ?? 0) <= 0) {
      return NextResponse.json({ error: "Invoice total came out as zero — check the line item amounts." }, { status: 400 });
    }
    let sent = finalised;
    try { sent = await stripe.invoices.sendInvoice(finalised.id); } catch { /* already sent on finalize */ }

    await logBillingEvent({
      organizationId: org.id,
      action:         "manual_invoice_sent",
      metadata:       { mode: "oneoff", invoiceId: sent.id, total: sent.total, currency },
    });
    await logActivity({
      type: "invoice_issued", title: `Invoice issued${sent.number ? ` ${sent.number}` : ""} (one-off)`.slice(0, 300),
      orgId: org.id, actorId: userId,
      meta: { mode: "oneoff", invoiceId: sent.id, total: sent.total, currency, hostedInvoiceUrl: sent.hosted_invoice_url ?? null },
    });
    await markBilled();

    // Belt-and-braces: Stripe's sendInvoice only emails if the dashboard
    // setting is enabled — always send our own branded email too.
    let emailSent = false;
    if (sent.hosted_invoice_url) {
      const amountLabel = new Intl.NumberFormat("en-IE", { style: "currency", currency: currency.toUpperCase() }).format((sent.total ?? 0) / 100);
      emailSent = await emailInvoiceLink({ to: d.billingEmail, orgName: org.name, hostedUrl: sent.hosted_invoice_url, amountLabel, kind: "one-off" });
    }

    return NextResponse.json({
      ok:               true,
      mode:             "oneoff",
      emailSent,
      invoiceId:        sent.id,
      number:           sent.number ?? null,
      total:            sent.total ?? 0,
      currency,
      status:           sent.status,
      hostedInvoiceUrl: sent.hosted_invoice_url ?? null,
      invoicePdf:       sent.invoice_pdf ?? null,
    });
  } catch (e: any) {
    console.error("[admin/billing/create-invoice]", e?.message || e);
    return NextResponse.json({ error: e?.message || "Stripe error" }, { status: 502 });
  }
}
