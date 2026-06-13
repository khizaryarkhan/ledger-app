import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions, organisations } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  try {
    const rows = await db
      .select({
        id:                   subscriptions.id,
        orgId:                subscriptions.orgId,
        orgName:              organisations.name,
        stripeCustomerId:     subscriptions.stripeCustomerId,
        stripeSubscriptionId: subscriptions.stripeSubscriptionId,
        status:               subscriptions.status,
        planName:             subscriptions.planName,
        planAmount:           subscriptions.planAmount,
        planInterval:         subscriptions.planInterval,
        planCurrency:         subscriptions.planCurrency,
        currentPeriodEnd:     subscriptions.currentPeriodEnd,
        cancelAt:             subscriptions.cancelAt,
        cancelAtPeriodEnd:    subscriptions.cancelAtPeriodEnd,
        lastPaymentStatus:    subscriptions.lastPaymentStatus,
        lastPaymentDate:      subscriptions.lastPaymentDate,
        billingEmail:         subscriptions.billingEmail,
        paymentMethodBrand:   subscriptions.paymentMethodBrand,
        paymentMethodLast4:   subscriptions.paymentMethodLast4,
        createdAt:            subscriptions.createdAt,
        source:               subscriptions.source,
        manualExpiresAt:      subscriptions.manualExpiresAt,
        manualPaymentStatus:  subscriptions.manualPaymentStatus,
        manualInvoiceRef:     subscriptions.manualInvoiceRef,
        manualNotes:          subscriptions.manualNotes,
        managedAt:            subscriptions.managedAt,
      })
      .from(subscriptions)
      .leftJoin(organisations, eq(organisations.id, subscriptions.orgId))
      .orderBy(desc(subscriptions.createdAt));

    return NextResponse.json({ subscriptions: rows });
  } catch (err: any) {
    console.error("[admin/subscriptions] GET error:", err);
    return NextResponse.json({ error: err?.message ?? "Query failed", subscriptions: [] }, { status: 500 });
  }
}
