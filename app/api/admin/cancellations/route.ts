import { NextResponse } from "next/server";
import { db } from "@/db";
import { cancellationRequests, organisations, subscriptions } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const rows = await db
    .select({
      id:                       cancellationRequests.id,
      status:                   cancellationRequests.status,
      requestedByEmail:         cancellationRequests.requestedByEmail,
      reason:                   cancellationRequests.reason,
      requestedAt:              cancellationRequests.requestedAt,
      reviewedAt:               cancellationRequests.reviewedAt,
      adminDecision:            cancellationRequests.adminDecision,
      internalNotes:            cancellationRequests.internalNotes,
      cancellationEffectiveDate: cancellationRequests.cancellationEffectiveDate,
      stripeCustomerId:         cancellationRequests.stripeCustomerId,
      stripeSubscriptionId:     cancellationRequests.stripeSubscriptionId,
      stripeActionStatus:       cancellationRequests.stripeActionStatus,
      organizationId:           cancellationRequests.organizationId,
      orgName:                  organisations.name,
      subStatus:                subscriptions.status,
      planName:                 subscriptions.planName,
      planAmount:               subscriptions.planAmount,
      planInterval:             subscriptions.planInterval,
      planCurrency:             subscriptions.planCurrency,
      currentPeriodEnd:         subscriptions.currentPeriodEnd,
    })
    .from(cancellationRequests)
    .leftJoin(organisations, eq(organisations.id, cancellationRequests.organizationId))
    .leftJoin(subscriptions, eq(subscriptions.orgId, cancellationRequests.organizationId))
    .orderBy(desc(cancellationRequests.requestedAt));

  return NextResponse.json({ cancellations: rows });
}
