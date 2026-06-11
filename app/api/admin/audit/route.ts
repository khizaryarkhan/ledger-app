import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { billingAuditLogs, organisations, users } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { eq, desc } from "drizzle-orm";

export async function GET(req: NextRequest) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const url   = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "50"), 200);

  const rows = await db
    .select({
      id:                    billingAuditLogs.id,
      action:                billingAuditLogs.action,
      actorRole:             billingAuditLogs.actorRole,
      previousStatus:        billingAuditLogs.previousStatus,
      newStatus:             billingAuditLogs.newStatus,
      stripeEventId:         billingAuditLogs.stripeEventId,
      stripeActionStatus:    billingAuditLogs.stripeActionStatus,
      metadata:              billingAuditLogs.metadata,
      createdAt:             billingAuditLogs.createdAt,
      orgName:               organisations.name,
      actorName:             users.name,
      actorEmail:            users.email,
    })
    .from(billingAuditLogs)
    .leftJoin(organisations, eq(organisations.id, billingAuditLogs.organizationId))
    .leftJoin(users, eq(users.id, billingAuditLogs.actorUserId))
    .orderBy(desc(billingAuditLogs.createdAt))
    .limit(limit);

  return NextResponse.json({ logs: rows });
}
