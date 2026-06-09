import { db } from "@/db";
import { xeroWebhookEvents, xeroSyncLog } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq, desc, gte, sql } from "drizzle-orm";

/**
 * GET /api/xero/webhook-health
 *
 * Returns webhook reliability metrics for the active org:
 *   lastWebhookAt    — when Xero last delivered an event (null if never)
 *   lastSuccessAt    — last successfully processed event
 *   last24hCount     — total webhook events in past 24 hours
 *   errorsLast24h    — errors in past 24 hours
 *   lastCronSyncAt   — last successful full sync (safety-net cron)
 *   recentEvents     — last 10 events for the activity timeline
 */
export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [lastEvent] = await db
    .select()
    .from(xeroWebhookEvents)
    .where(eq(xeroWebhookEvents.orgId, orgId!))
    .orderBy(desc(xeroWebhookEvents.receivedAt))
    .limit(1);

  const [lastSuccess] = await db
    .select()
    .from(xeroWebhookEvents)
    .where(
      and(
        eq(xeroWebhookEvents.orgId, orgId!),
        eq(xeroWebhookEvents.status, "received")
      )
    )
    .orderBy(desc(xeroWebhookEvents.receivedAt))
    .limit(1);

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      errors: sql<number>`sum(case when ${xeroWebhookEvents.status} = 'error' then 1 else 0 end)::int`,
    })
    .from(xeroWebhookEvents)
    .where(
      and(
        eq(xeroWebhookEvents.orgId, orgId!),
        gte(xeroWebhookEvents.receivedAt, since24h)
      )
    );

  const [lastCronSync] = await db
    .select({ syncedAt: xeroSyncLog.syncedAt })
    .from(xeroSyncLog)
    .where(
      and(eq(xeroSyncLog.orgId, orgId!), eq(xeroSyncLog.status, "success"))
    )
    .orderBy(desc(xeroSyncLog.syncedAt))
    .limit(1);

  const recentEvents = await db
    .select({
      id: xeroWebhookEvents.id,
      receivedAt: xeroWebhookEvents.receivedAt,
      status: xeroWebhookEvents.status,
      entityCount: xeroWebhookEvents.entityCount,
      entities: xeroWebhookEvents.entities,
      errorMessage: xeroWebhookEvents.errorMessage,
      processingMs: xeroWebhookEvents.processingMs,
    })
    .from(xeroWebhookEvents)
    .where(eq(xeroWebhookEvents.orgId, orgId!))
    .orderBy(desc(xeroWebhookEvents.receivedAt))
    .limit(10);

  return ok({
    lastWebhookAt: lastEvent?.receivedAt ?? null,
    lastSuccessAt: lastSuccess?.receivedAt ?? null,
    last24hCount: counts?.total ?? 0,
    errorsLast24h: counts?.errors ?? 0,
    lastCronSyncAt: lastCronSync?.syncedAt ?? null,
    recentEvents,
  });
}
