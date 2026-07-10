/**
 * Admin — act on a single Stripe invoice.
 *
 * POST /api/admin/billing/invoices/:id
 *   { action: "void" }                              → void/cancel an open invoice
 *   { action: "mark_paid", method, note? }          → record payment received
 *                                                     OUTSIDE Stripe (bank
 *                                                     transfer, cheque, cash…).
 *
 * "mark_paid" stamps the invoice metadata with HOW it was received, then pays it
 * out-of-band in Stripe (no charge). That fires invoice.paid → our webhook syncs
 * the subscription status → access, so an offline payment behaves like any other.
 */

import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { requirePlatformAdmin, logBillingEvent } from "@/lib/billing";
import { db } from "@/db";
import { subscriptions, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { activateOrgOnPayment } from "@/lib/admin/provisioning/provision-customer";

export const maxDuration = 60;

const METHODS = ["bank_transfer", "cheque", "cash", "card_external", "other"];

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const invoiceId = params.id;
  const body = await req.json().catch(() => ({}));
  const action = body?.action as string;

  try {
    const inv = await stripe.invoices.retrieve(invoiceId);
    const customerId = inv.customer as string;
    const [subRow] = customerId
      ? await db.select({ orgId: subscriptions.orgId }).from(subscriptions).where(eq(subscriptions.stripeCustomerId, customerId)).limit(1)
      : [];

    // ── Void / cancel ───────────────────────────────────────────────────────
    if (action === "void") {
      if (inv.status === "draft") {
        // Drafts can't be voided — delete them instead.
        await stripe.invoices.del(invoiceId);
      } else if (inv.status === "open") {
        await stripe.invoices.voidInvoice(invoiceId);
      } else {
        return NextResponse.json({ error: `Cannot void an invoice that is "${inv.status}"` }, { status: 400 });
      }
      await logBillingEvent({
        organizationId: subRow?.orgId ?? null,
        actorUserId:    userId,
        action:         "invoice_voided",
        metadata:       { invoiceId, previousStatus: inv.status },
      });
      return NextResponse.json({ ok: true, action: "void" });
    }

    // ── Mark received outside Stripe ─────────────────────────────────────────
    if (action === "mark_paid") {
      if (inv.status === "paid") {
        return NextResponse.json({ error: "Invoice is already paid" }, { status: 400 });
      }
      const method = String(body?.method || "");
      if (!METHODS.includes(method)) {
        return NextResponse.json({ error: `method must be one of: ${METHODS.join(", ")}` }, { status: 400 });
      }
      const note = String(body?.note || "").slice(0, 500);

      const receivedDate = String(body?.receivedDate || "").slice(0, 10); // YYYY-MM-DD
      // Record HOW it was received on the invoice itself, then pay out-of-band.
      await stripe.invoices.update(invoiceId, {
        metadata: {
          paid_out_of_band:   "true",
          paid_method:        method,
          paid_note:          note,
          paid_received_date: receivedDate,
          paid_recorded_by:   userId ?? "",
        },
      });
      // A draft must be finalised before it can be paid.
      if (inv.status === "draft") {
        await stripe.invoices.finalizeInvoice(invoiceId);
      }
      const paid = await stripe.invoices.pay(invoiceId, { paid_out_of_band: true });

      // Activate directly — don't rely solely on the invoice.paid webhook
      // (idempotent, so the webhook running too is harmless). Surfaces the
      // "nobody to invite" case so the admin isn't left guessing why the
      // customer never received credentials.
      let activation: { activated: boolean; invited: number } | null = null;
      let userCount = 0;
      if (subRow?.orgId) {
        try {
          activation = await activateOrgOnPayment(subRow.orgId);
          const orgUsers = await db.select({ id: users.id }).from(users).where(eq(users.orgId, subRow.orgId));
          userCount = orgUsers.length;
        } catch (e: any) {
          console.error("[mark_paid] activation failed:", e?.message);
        }
      }

      await logBillingEvent({
        organizationId: subRow?.orgId ?? null,
        actorUserId:    userId,
        action:         "invoice_marked_paid_offline",
        newStatus:      paid.status,
        metadata:       { invoiceId, method, note, total: paid.total, invited: activation?.invited ?? 0 },
      });
      return NextResponse.json({
        ok: true, action: "mark_paid", status: paid.status, method,
        activated: activation?.activated ?? false,
        invited: activation?.invited ?? 0,
        // Loud warning the admin UI can show: paid, but no user account exists
        // in the org — nobody received credentials.
        warning: subRow?.orgId && userCount === 0
          ? "Invoice marked paid, but this organisation has NO user accounts — nobody was sent credentials. Add the customer's admin user in the app (Settings → Team) or via the org's provisioning step."
          : activation && activation.invited === 0 && subRow?.orgId
          ? "Invoice marked paid. No pending users needed activation (existing users already active)."
          : undefined,
      });
    }

    // ── Refund a paid invoice ────────────────────────────────────────────────
    if (action === "refund") {
      if (inv.status !== "paid") {
        return NextResponse.json({ error: "Only a paid invoice can be refunded" }, { status: 400 });
      }
      const note = String(body?.note || "").slice(0, 500);
      const paidOffline = inv.metadata?.paid_out_of_band === "true";

      // Re-fetch with the payment objects so we can issue a real Stripe refund.
      const full = await stripe.invoices.retrieve(invoiceId, { expand: ["payment_intent", "charge"] }) as any;
      const chargeId = typeof full.charge === "string" ? full.charge : full.charge?.id;
      const piId     = typeof full.payment_intent === "string" ? full.payment_intent : full.payment_intent?.id;

      let refundId: string | null = null;
      if (!paidOffline && (chargeId || piId)) {
        // Real card/Stripe payment → issue an actual refund.
        const refund = await stripe.refunds.create(chargeId ? { charge: chargeId } : { payment_intent: piId });
        refundId = refund.id;
      }
      // For offline-paid invoices there is no Stripe charge to reverse — the
      // money was received outside Stripe, so we record the refund as a note;
      // the actual repayment is made offline.
      await stripe.invoices.update(invoiceId, {
        metadata: {
          ...(inv.metadata ?? {}),
          refunded:         "true",
          refunded_amount:  String(inv.amount_paid ?? inv.total ?? 0),
          refund_method:    paidOffline ? "offline" : "stripe",
          refund_note:      note,
          refunded_by:      userId ?? "",
        },
      });

      // A refund ends the customer relationship: cancel the subscription so
      // access is revoked. (Refunding the payment alone leaves the subscription
      // "active" in Stripe — which is why a refunded org otherwise stays on.)
      const anyInv = inv as any;
      const subId: string | null =
        anyInv.subscription ?? anyInv.parent?.subscription_details?.subscription ?? null;
      let subscriptionCancelled = false;
      if (subId) {
        try {
          await stripe.subscriptions.cancel(subId);
          await db.update(subscriptions)
            .set({ status: "canceled", stripeUpdatedAt: new Date() })
            .where(eq(subscriptions.stripeSubscriptionId, subId));
          subscriptionCancelled = true;
        } catch (e: any) {
          console.error("[invoices/refund] subscription cancel failed:", e?.message);
        }
      }

      await logBillingEvent({
        organizationId: subRow?.orgId ?? null,
        actorUserId:    userId,
        action:         "invoice_refunded",
        metadata:       { invoiceId, refundId, method: paidOffline ? "offline" : "stripe", amount: inv.amount_paid, note, subscriptionCancelled },
      });
      return NextResponse.json({ ok: true, action: "refund", refundId, offline: paidOffline, subscriptionCancelled });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("[admin/billing/invoices/:id]", e?.message || e);
    return NextResponse.json({ error: e?.message || "Stripe error" }, { status: 502 });
  }
}
