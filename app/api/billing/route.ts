import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions, cancellationRequests } from "@/db/schema";
import { requireOrg } from "@/lib/api";
import { eq, and, desc } from "drizzle-orm";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [sub] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId!))
    .limit(1);

  // Fetch active or pending cancellation request
  const [pendingCancel] = await db
    .select()
    .from(cancellationRequests)
    .where(and(
      eq(cancellationRequests.organizationId, orgId!),
      eq(cancellationRequests.status, "pending"),
    ))
    .orderBy(desc(cancellationRequests.requestedAt))
    .limit(1);

  const [latestDecision] = await db
    .select()
    .from(cancellationRequests)
    .where(and(
      eq(cancellationRequests.organizationId, orgId!),
    ))
    .orderBy(desc(cancellationRequests.requestedAt))
    .limit(1);

  return NextResponse.json({
    subscription: sub ?? null,
    pendingCancellation: pendingCancel ?? null,
    latestCancellation: latestDecision ?? null,
  });
}
