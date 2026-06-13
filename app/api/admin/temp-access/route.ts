import { NextResponse } from "next/server";
import { db } from "@/db";
import { tempAccessRequests, organisations, users } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { eq, desc } from "drizzle-orm";

export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const rows = await db
    .select({
      id:                tempAccessRequests.id,
      status:            tempAccessRequests.status,
      reason:            tempAccessRequests.reason,
      requestedByEmail:  tempAccessRequests.requestedByEmail,
      expiresAt:         tempAccessRequests.expiresAt,
      adminNotes:        tempAccessRequests.adminNotes,
      reviewedAt:        tempAccessRequests.reviewedAt,
      createdAt:         tempAccessRequests.createdAt,
      orgName:           organisations.name,
      orgSlug:           organisations.slug,
    })
    .from(tempAccessRequests)
    .leftJoin(organisations, eq(organisations.id, tempAccessRequests.orgId))
    .orderBy(desc(tempAccessRequests.createdAt));

  return NextResponse.json({ requests: rows });
}
