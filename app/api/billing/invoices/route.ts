import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions } from "@/db/schema";
import { requireOrg } from "@/lib/api";
import { stripe } from "@/lib/stripe";
import { eq } from "drizzle-orm";

export async function GET() {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;

  if (role !== "super_admin" && role !== "company_admin") {
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
    invoices: list.data.map(inv => ({
      id:        inv.id,
      number:    inv.number,
      date:      inv.created,
      amount:    inv.amount_paid,
      currency:  inv.currency,
      status:    inv.status,
      pdfUrl:    inv.invoice_pdf,
      hostedUrl: inv.hosted_invoice_url,
    })),
  });
}
