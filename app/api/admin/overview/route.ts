import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions, cancellationRequests, landingPageRequests, organisations, billingAuditLogs, users } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { eq, count, desc } from "drizzle-orm";

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
    totalOrgs,
    totalUsers,
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
    db.select({
      id: billingAuditLogs.id,
      action: billingAuditLogs.action,
      organizationId: billingAuditLogs.organizationId,
      actorUserId: billingAuditLogs.actorUserId,
      actorRole: billingAuditLogs.actorRole,
      previousStatus: billingAuditLogs.previousStatus,
      newStatus: billingAuditLogs.newStatus,
      stripeActionStatus: billingAuditLogs.stripeActionStatus,
      createdAt: billingAuditLogs.createdAt,
    }).from(billingAuditLogs).orderBy(desc(billingAuditLogs.createdAt)).limit(6),
    db.select({ n: count() }).from(subscriptions).where(eq(subscriptions.lastPaymentStatus, "failed")),
    db.select({ n: count() }).from(organisations).where(eq(organisations.status, "Active")),
    db.select({ n: count() }).from(users).where(eq(users.status, "Active")),
  ]);

  // Enrich audit logs with org names
  const orgIds = [...new Set(recentAuditLogs.map((l: any) => l.organizationId).filter(Boolean))];
  const orgRows = orgIds.length
    ? await db.select({ id: organisations.id, name: organisations.name }).from(organisations)
    : [];
  const orgNameMap = Object.fromEntries(orgRows.map(o => [o.id, o.name]));

  return NextResponse.json({
    stats: {
      active:               activeCount[0]?.n ?? 0,
      trialing:             trialingCount[0]?.n ?? 0,
      pastDue:              pastDueCount[0]?.n ?? 0,
      cancelling:           cancellingCount[0]?.n ?? 0,
      cancelled:            cancelledCount[0]?.n ?? 0,
      pendingCancellations: pendingCancellations[0]?.n ?? 0,
      newLeads:             newLeads[0]?.n ?? 0,
      failedPayments:       failedPayments[0]?.n ?? 0,
      totalOrgs:            totalOrgs[0]?.n ?? 0,
      totalUsers:           totalUsers[0]?.n ?? 0,
    },
    recentCancellations,
    recentLeads,
    recentAuditLogs: recentAuditLogs.map((l: any) => ({
      ...l,
      orgName: l.organizationId ? (orgNameMap[l.organizationId] ?? null) : null,
    })),
  });
}
