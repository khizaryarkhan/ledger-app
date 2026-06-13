import { NextResponse } from "next/server";
import { db } from "@/db";
import { subscriptions, tempAccessRequests } from "@/db/schema";
import { requireOrg } from "@/lib/api";
import { eq, and, gt } from "drizzle-orm";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [sub] = await db
    .select({
      status:          subscriptions.status,
      source:          subscriptions.source,
      manualExpiresAt: subscriptions.manualExpiresAt,
    })
    .from(subscriptions)
    .where(eq(subscriptions.orgId, orgId!))
    .limit(1);

  // Manual subscriptions: check expiry date
  if (sub?.source === "manual") {
    const expired = sub.manualExpiresAt ? sub.manualExpiresAt <= new Date() : false;
    if (!expired) {
      return NextResponse.json({ blocked: false, status: "manual:active" });
    }
    // expired manual — fall through to temp access check
  } else {
    // Stripe subscriptions: check status
    const isCanceled = sub?.status === "canceled" || sub?.status === "cancelled";
    if (!isCanceled) {
      return NextResponse.json({ blocked: false, status: sub?.status ?? "none" });
    }
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
      status: sub?.source === "manual" ? "manual:expired" : sub?.status,
      hasTempAccess: true,
      tempAccessExpiresAt: tempAccess.expiresAt,
    });
  }

  // Check if there's already a pending request
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
    status: sub?.source === "manual" ? "manual:expired" : sub?.status,
    hasTempAccess: false,
    pendingTempAccess: !!pendingReq,
  });
}
