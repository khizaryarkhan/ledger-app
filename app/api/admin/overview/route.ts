import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions, cancellationRequests, landingPageRequests, organisations, billingAuditLogs } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { eq, count, and, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";

export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const [
    activeCount,
    trialingCount,
    pastDueCount,
    cancellingCount,
    cancelledCount,
    pendingCancellations,
    newLeads,
    recentCancellations,
    recentLeads,
    recentAuditLogs,
    failedPayments,
  ] = await Promise.all([
    db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.status, "active")),
    db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.status, "trialing")),
    db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.status, "past_due")),
    db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.cancelAtPeriodEnd, true)),
    db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.status, "cancelled")),
    db.select({ n: count() }).from(cancellationRequests).where(eq(cancellationRequests.status, "pending")),
    db.select({ n: count() }).from(landingPageRequests).where(eq(landingPageRequests.status, "new")),
    db.select({
      id: cancellationRequests.id,
      organizationId: cancellationRequests.organizationId,
      status: cancellationRequests.status,
      requestedByEmail: cancellationRequests.requestedByEmail,
      requestedAt: cancellationRequests.requestedAt,
    }).from(cancellationRequests).orderBy(desc(cancellationRequests.requestedAt)).limit(5),
    db.select({
      id: landingPageRequests.id,
      fullName: landingPageRequests.fullName,
      companyName: landingPageRequests.companyName,
      email: landingPageRequests.email,
      status: landingPageRequests.status,
      createdAt: landingPageRequests.createdAt,
    }).from(landingPageRequests).orderBy(desc(landingPageRequests.createdAt)).limit(5),
    db.select().from(billingAuditLogs).orderBy(desc(billingAuditLogs.createdAt)).limit(10),
    db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.lastPaymentStatus, "failed")),
  ]);

  return NextResponse.json({
    stats: {
      active:              activeCount[0]?.n ?? 0,
      trialing:            trialingCount[0]?.n ?? 0,
      pastDue:             pastDueCount[0]?.n ?? 0,
      cancelling:          cancellingCount[0]?.n ?? 0,
      cancelled:           cancelledCount[0]?.n ?? 0,
      pendingCancellations: pendingCancellations[0]?.n ?? 0,
      newLeads:            newLeads[0]?.n ?? 0,
      failedPayments:      failedPayments[0]?.n ?? 0,
    },
    recentCancellations,
    recentLeads,
    recentAuditLogs,
  });
}
