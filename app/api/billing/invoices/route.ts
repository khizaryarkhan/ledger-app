import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { requireOrg } from "@/lib/api";
import { stripe } from "@/lib/stripe";
import { eq } from "drizzle-orm";

export async function GET() {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;

  if (role !== "super_admin" && role !== "company_admin" && role !== "company_user") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [sub] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId!))
    .limit(1);

  if (!sub?.stripeCustomerId) {
    return NextResponse.json({ invoices: [] });
  }

  const list = await stripe.invoices.list({
    customer: sub.stripeCustomerId,
    limit: 24,
  });

  return NextResponse.json({
    // A voided invoice is an internal correction artefact (e.g. the old
    // 23-hour incomplete_expired flow — see CLAUDE.md's "invoice-first"
    // section) — the client never owed that amount, so it shouldn't appear
    // in their own billing history. Filtered here, server-side, so it's
    // hidden everywhere this endpoint is used, not just one screen.
    invoices: list.data
      .filter(inv => inv.status !== "void")
      .map(inv => ({
        id:         inv.id,
        number:     inv.number,
        date:       inv.created,
        // `amount_paid` is 0 on an unpaid (open) invoice — it is what was
        // PAID, not what was billed. `total` is the invoice amount and is
        // always correct regardless of payment status; kept both plus the
        // actual payment date so the UI can show "billed X, paid Y on Z"
        // instead of a misleading $0.00 for anything still open.
        total:      inv.total,
        amountDue:  inv.amount_due,
        amountPaid: inv.amount_paid,
        paidAt:     inv.status_transitions?.paid_at ? inv.status_transitions.paid_at * 1000 : null,
        currency:   inv.currency,
        status:     inv.status,
        pdfUrl:     inv.invoice_pdf,
        hostedUrl:  inv.hosted_invoice_url,
      })),
  });
}
