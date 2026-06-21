/**
 * Admin — list all Stripe invoices across every organisation.
 *
 * GET /api/admin/billing/invoices?limit=50&status=open&starting_after=in_x
 *
 * Stripe is the source of truth; we enrich each invoice with the org it belongs
 * to (via subscriptions.stripeCustomerId → orgId → org name). Read-only.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions, organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { stripe } from "@/lib/stripe";
import { requirePlatformAdmin } from "@/lib/billing";

export const maxDuration = 60;

export async function GET(req: Request) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 100);
  const status = url.searchParams.get("status") || undefined; // draft|open|paid|void|uncollectible
  const startingAfter = url.searchParams.get("starting_after") || undefined;

  try {
    const list = await stripe.invoices.list({
      limit,
      ...(status ? { status: status as any } : {}),
      ...(startingAfter ? { starting_after: startingAfter } : {}),
      expand: ["data.customer"],
    });

    // Map Stripe customer id → our org (name + id) for attribution.
    const subs = await db
      .select({ stripeCustomerId: subscriptions.stripeCustomerId, orgId: subscriptions.orgId })
      .from(subscriptions);
    const orgs = await db.select({ id: organisations.id, name: organisations.name }).from(organisations);
    const orgNameById = new Map(orgs.map(o => [o.id, o.name]));
    const orgByCustomer = new Map<string, { orgId: string; name: string }>();
    for (const s of subs) {
      if (s.stripeCustomerId && !orgByCustomer.has(s.stripeCustomerId)) {
        orgByCustomer.set(s.stripeCustomerId, { orgId: s.orgId, name: orgNameById.get(s.orgId) ?? "—" });
      }
    }

    const invoices = list.data.map((inv: any) => {
      const customerId = typeof inv.customer === "string" ? inv.customer : inv.customer?.id;
      const cust = typeof inv.customer === "object" ? inv.customer : null;
      const org = customerId ? orgByCustomer.get(customerId) : undefined;
      const isSubscription = !!(inv.subscription ?? inv.parent?.subscription_details?.subscription);
      const interval: string | null = inv.lines?.data?.[0]?.price?.recurring?.interval ?? null; // 'month' | 'year'
      const m = inv.metadata ?? {};
      return {
        id:               inv.id,
        number:           inv.number,
        status:           inv.status,                      // draft | open | paid | void | uncollectible
        total:            inv.total,                       // smallest unit
        amountDue:        inv.amount_due,
        amountPaid:       inv.amount_paid,
        currency:         (inv.currency || "eur").toUpperCase(),
        created:          inv.created ? inv.created * 1000 : null,
        dueDate:          inv.due_date ? inv.due_date * 1000 : null,
        // Payment date: Stripe's recorded paid timestamp; offline payments may
        // carry an explicit received date the admin entered.
        paidAt:           inv.status_transitions?.paid_at ? inv.status_transitions.paid_at * 1000 : null,
        receivedDate:     m.paid_received_date || null,
        hostedInvoiceUrl: inv.hosted_invoice_url,
        invoicePdf:       inv.invoice_pdf,
        customerId,
        customerName:     cust?.name ?? null,
        customerEmail:    cust?.email ?? null,
        orgId:            org?.orgId ?? null,
        orgName:          org?.name ?? cust?.name ?? cust?.email ?? "—",
        description:      inv.description ?? null,
        isSubscription,
        interval,                                          // billing cadence for subscription invoices
        billingLabel:     isSubscription ? (interval === "year" ? "Annual" : interval === "month" ? "Monthly" : "Recurring") : "One-off",
        paidMethod:       m.paid_method ?? null,
        paidNote:         m.paid_note ?? null,
        paidOutOfBand:    m.paid_out_of_band === "true",
        refunded:         m.refunded === "true",
        refundedAmount:   m.refunded_amount ? parseInt(m.refunded_amount) : null,
        refundMethod:     m.refund_method ?? null,
      };
    });

    return NextResponse.json({
      invoices,
      hasMore: list.has_more,
      nextCursor: list.has_more && invoices.length ? invoices[invoices.length - 1].id : null,
    });
  } catch (e: any) {
    console.error("[admin/billing/invoices]", e?.message || e);
    return NextResponse.json({ error: e?.message || "Failed to load invoices" }, { status: 502 });
  }
}
