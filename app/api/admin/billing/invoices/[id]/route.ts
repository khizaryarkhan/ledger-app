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
import { subscriptions } from "@/db/schema";
import { eq } from "drizzle-orm";

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

      // Record HOW it was received on the invoice itself, then pay out-of-band.
      await stripe.invoices.update(invoiceId, {
        metadata: {
          paid_out_of_band: "true",
          paid_method:      method,
          paid_note:        note,
          paid_recorded_by: userId ?? "",
        },
      });
      // A draft must be finalised before it can be paid.
      if (inv.status === "draft") {
        await stripe.invoices.finalizeInvoice(invoiceId);
      }
      const paid = await stripe.invoices.pay(invoiceId, { paid_out_of_band: true });

      await logBillingEvent({
        organizationId: subRow?.orgId ?? null,
        actorUserId:    userId,
        action:         "invoice_marked_paid_offline",
        newStatus:      paid.status,
        metadata:       { invoiceId, method, note, total: paid.total },
      });
      return NextResponse.json({ ok: true, action: "mark_paid", status: paid.status, method });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("[admin/billing/invoices/:id]", e?.message || e);
    return NextResponse.json({ error: e?.message || "Stripe error" }, { status: 502 });
  }
}
