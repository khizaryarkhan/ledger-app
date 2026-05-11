import { db } from "@/db";
import { qboWebhookEvents, qboSyncLog } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq, desc, gte, sql } from "drizzle-orm";

/**
 * GET /api/qbo/webhook-health
 *
 * Returns webhook reliability metrics for the active org:
 * - lastWebhookAt: when QBO last delivered an event (null if never)
 * - lastSuccessAt: last successful event
 * - last24hCount: total webhook events in past 24 hours
 * - errorsLast24h: errors in past 24 hours
 * - lastCronSyncAt: last successful full sync (safety net)
 * - recentEvents: last 10 events for the activity timeline
 *
 * Used by the Settings page to show "webhook health" and surface
 * staleness alerts when an org goes quiet unexpectedly.
 */
export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);

  const [lastEvent] = await db.select()
    .from(qboWebhookEvents)
    .where(eq(qboWebhookEvents.orgId, orgId!))
    .orderBy(desc(qboWebhookEvents.receivedAt))
    .limit(1);

  const [lastSuccess] = await db.select()
    .from(qboWebhookEvents)
    .where(and(eq(qboWebhookEvents.orgId, orgId!), eq(qboWebhookEvents.status, "received")))
    .orderBy(desc(qboWebhookEvents.receivedAt))
    .limit(1);

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      errors: sql<number>`sum(case when ${qboWebhookEvents.status} = 'error' then 1 else 0 end)::int`,
    })
    .from(qboWebhookEvents)
    .where(and(eq(qboWebhookEvents.orgId, orgId!), gte(qboWebhookEvents.receivedAt, since24h)));

  const [lastCronSync] = await db.select({ syncedAt: qboSyncLog.syncedAt })
    .from(qboSyncLog)
    .where(and(eq(qboSyncLog.orgId, orgId!), eq(qboSyncLog.status, "success")))
    .orderBy(desc(qboSyncLog.syncedAt))
    .limit(1);

  const recentEvents = await db.select({
    id: qboWebhookEvents.id,
    receivedAt: qboWebhookEvents.receivedAt,
    status: qboWebhookEvents.status,
    entityCount: qboWebhookEvents.entityCount,
    entities: qboWebhookEvents.entities,
    errorMessage: qboWebhookEvents.errorMessage,
    processingMs: qboWebhookEvents.processingMs,
  })
    .from(qboWebhookEvents)
    .where(eq(qboWebhookEvents.orgId, orgId!))
    .orderBy(desc(qboWebhookEvents.receivedAt))
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
