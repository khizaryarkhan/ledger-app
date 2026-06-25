import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { opportunities, organisations, subscriptions } from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// Phase 0 Account 360: the billing/customer facet of a lead, assembled from the
// existing links (lead → opportunity → organisation → subscription). Read-only,
// no schema change — gives the cockpit the whole lifecycle on one screen.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  let opps: any[] = [];
  try {
    opps = await db.select({
      id: opportunities.id, orgId: opportunities.orgId, title: opportunities.title,
      stripeInvoiceId: opportunities.stripeInvoiceId, invoiceUrl: opportunities.invoiceUrl,
      invoiceTotal: opportunities.invoiceTotal, invoiceCurrency: opportunities.invoiceCurrency,
      invoiceStatus: opportunities.invoiceStatus, invoicedAt: opportunities.invoicedAt,
    }).from(opportunities).where(eq(opportunities.leadId, params.id)).orderBy(desc(opportunities.updatedAt));
  } catch { /* table may not exist */ }

  const orgId = opps.find(o => o.orgId)?.orgId ?? null;
  let organisation: any = null, subscription: any = null;
  if (orgId) {
    const [org] = await db.select({ id: organisations.id, name: organisations.name, status: organisations.status }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
    organisation = org ?? null;
    const [sub] = await db.select({
      status: subscriptions.status, planName: subscriptions.planName, planAmount: subscriptions.planAmount,
      planInterval: subscriptions.planInterval, planCurrency: subscriptions.planCurrency,
      currentPeriodEnd: subscriptions.currentPeriodEnd, cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
      lastPaymentStatus: subscriptions.lastPaymentStatus, source: subscriptions.source,
    }).from(subscriptions).where(eq(subscriptions.orgId, orgId)).limit(1);
    subscription = sub ?? null;
  }

  const invoices = opps.filter(o => o.invoiceStatus).map(o => ({
    dealTitle: o.title, stripeInvoiceId: o.stripeInvoiceId, url: o.invoiceUrl,
    total: o.invoiceTotal, currency: o.invoiceCurrency, status: o.invoiceStatus, at: o.invoicedAt,
  }));

  return NextResponse.json({
    hasDeal:    opps.length > 0,
    invoiced:   invoices.length > 0,
    organisation,                       // { name, status } — status Inactive=pending, Active=provisioned
    subscription,                       // { status, plan… } when on Stripe billing
    activated:  organisation?.status === "Active",
    invoices,
  });
}
