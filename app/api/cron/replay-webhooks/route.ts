/**
 * Webhook replay cron — runs every hour via Vercel Cron.
 *
 * Reads webhook events that errored in the last 6 hours and re-runs the sync
 * for each one. Because all sync functions are upsert-based, replaying an event
 * that already partially succeeded is safe — it just overwrites with the same data.
 *
 * Optimistic locking: each event is claimed by flipping status → "replaying"
 * atomically before processing, so concurrent cron invocations don't double-replay.
 *
 * After success: status → "replayed"
 * After failure: status → "error" with the original + replay error message
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  qboWebhookEvents, xeroWebhookEvents,
  qboTokens, xeroTokens,
} from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { syncTargetedEntities, type QboEntityChange } from "@/lib/qbo-sync";
import { syncQboApBills, type QboBillChange } from "@/lib/qbo-ap-sync";
import { syncXeroTargetedEntities, type XeroEntityChange } from "@/lib/xero-sync";
import { syncXeroApBills } from "@/lib/xero-ap-sync";

export const maxDuration = 300;

// AR entities — entities stored with a `name` field
const RELEVANT_ENTITIES = new Set(["Invoice", "Payment", "CreditMemo", "Customer", "RefundReceipt"]);

export async function GET(req: Request) {
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const results = {
    qbo:  { attempted: 0, replayed: 0, failed: 0 },
    xero: { attempted: 0, replayed: 0, failed: 0 },
  };

  // ── QBO replay ──────────────────────────────────────────────────────────────
  const qboFailed = await db
    .select()
    .from(qboWebhookEvents)
    .where(and(eq(qboWebhookEvents.status, "error"), gt(qboWebhookEvents.receivedAt, sixHoursAgo)));

  for (const event of qboFailed) {
    if (!event.orgId || !Array.isArray(event.entities)) continue;
    results.qbo.attempted++;

    // Claim the event atomically — only proceed if we successfully flipped status.
    // Prevents double-replay when two cron instances overlap.
    const claimed = await db
      .update(qboWebhookEvents)
      .set({ status: "replaying" })
      .where(and(eq(qboWebhookEvents.id, event.id), eq(qboWebhookEvents.status, "error")))
      .returning({ id: qboWebhookEvents.id });
    if (claimed.length === 0) continue;

    const [token] = await db
      .select({ userId: qboTokens.userId })
      .from(qboTokens)
      .where(eq(qboTokens.orgId, event.orgId))
      .limit(1);

    if (!token) {
      await db.update(qboWebhookEvents)
        .set({ status: "error", errorMessage: "[replay] Org no longer has a QBO connection" })
        .where(eq(qboWebhookEvents.id, event.id));
      results.qbo.failed++;
      continue;
    }

    try {
      // AR entities have a `name` field; AP (Bill) entities do not.
      const arChanges = (event.entities as any[])
        .filter(e => e.name && RELEVANT_ENTITIES.has(e.name)) as QboEntityChange[];
      const apChanges = (event.entities as any[])
        .filter(e => !e.name && e.id) as QboBillChange[];

      if (arChanges.length > 0) await syncTargetedEntities(event.orgId, token.userId, arChanges);
      if (apChanges.length > 0) await syncQboApBills(event.orgId, token.userId, apChanges);

      await db.update(qboWebhookEvents)
        .set({ status: "replayed", errorMessage: null })
        .where(eq(qboWebhookEvents.id, event.id));
      results.qbo.replayed++;
    } catch (e: any) {
      console.error(`QBO replay failed for event ${event.id}:`, e.message);
      await db.update(qboWebhookEvents)
        .set({ status: "error", errorMessage: `[replay] ${e.message}` })
        .where(eq(qboWebhookEvents.id, event.id));
      results.qbo.failed++;
    }
  }

  // ── Xero replay ─────────────────────────────────────────────────────────────
  const xeroFailed = await db
    .select()
    .from(xeroWebhookEvents)
    .where(and(eq(xeroWebhookEvents.status, "error"), gt(xeroWebhookEvents.receivedAt, sixHoursAgo)));

  for (const event of xeroFailed) {
    if (!event.orgId || !Array.isArray(event.entities)) continue;
    results.xero.attempted++;

    const claimed = await db
      .update(xeroWebhookEvents)
      .set({ status: "replaying" })
      .where(and(eq(xeroWebhookEvents.id, event.id), eq(xeroWebhookEvents.status, "error")))
      .returning({ id: xeroWebhookEvents.id });
    if (claimed.length === 0) continue;

    const [token] = await db
      .select({ userId: xeroTokens.userId })
      .from(xeroTokens)
      .where(eq(xeroTokens.orgId, event.orgId))
      .limit(1);

    if (!token) {
      await db.update(xeroWebhookEvents)
        .set({ status: "error", errorMessage: "[replay] Org no longer has a Xero connection" })
        .where(eq(xeroWebhookEvents.id, event.id));
      results.xero.failed++;
      continue;
    }

    try {
      const changes = event.entities as XeroEntityChange[];
      const { apInvoiceIds } = await syncXeroTargetedEntities(event.orgId, token.userId, changes);
      if (apInvoiceIds.length > 0) {
        await syncXeroApBills(event.orgId, token.userId, apInvoiceIds);
      }

      await db.update(xeroWebhookEvents)
        .set({ status: "replayed", errorMessage: null })
        .where(eq(xeroWebhookEvents.id, event.id));
      results.xero.replayed++;
    } catch (e: any) {
      console.error(`Xero replay failed for event ${event.id}:`, e.message);
      await db.update(xeroWebhookEvents)
        .set({ status: "error", errorMessage: `[replay] ${e.message}` })
        .where(eq(xeroWebhookEvents.id, event.id));
      results.xero.failed++;
    }
  }

  console.log("Webhook replay complete:", results);
  return NextResponse.json({ ok: true, results });
}
