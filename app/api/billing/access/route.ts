import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions, tempAccessRequests } from "@/db/schema";
import { requireOrg } from "@/lib/api";
import { eq, and, gt } from "drizzle-orm";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [sub] = await db
    .select({ status: subscriptions.status })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId!))
    .limit(1);

  const isCanceled =
    sub?.status === "canceled" || sub?.status === "cancelled";

  if (!isCanceled) {
    return NextResponse.json({ blocked: false, status: sub?.status ?? "none" });
  }

  // Check for an approved, non-expired temp access grant
  const now = new Date();
  const [tempAccess] = await db
    .select({ id: tempAccessRequests.id, expiresAt: tempAccessRequests.expiresAt })
    .from(tempAccessRequests)
    .where(and(
      eq(tempAccessRequests.orgId, orgId!),
      eq(tempAccessRequests.status, "approved"),
      gt(tempAccessRequests.expiresAt, now),
    ))
    .limit(1);

  if (tempAccess) {
    return NextResponse.json({
      blocked: false,
      status: sub.status,
      hasTempAccess: true,
      tempAccessExpiresAt: tempAccess.expiresAt,
    });
  }

  // Check if there's already a pending request (so we can tell the user)
  const [pendingReq] = await db
    .select({ id: tempAccessRequests.id })
    .from(tempAccessRequests)
    .where(and(
      eq(tempAccessRequests.orgId, orgId!),
      eq(tempAccessRequests.status, "pending"),
    ))
    .limit(1);

  return NextResponse.json({
    blocked: true,
    status: sub.status,
    hasTempAccess: false,
    pendingTempAccess: !!pendingReq,
  });
}
