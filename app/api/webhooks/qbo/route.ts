/**
 * QBO Webhook receiver — real-time sync.
 *
 * QuickBooks pushes a POST to this URL within seconds of any change.
 * We verify the HMAC-SHA256 signature, then return 200 immediately and
 * process in the background using waitUntil so Vercel keeps the function
 * alive until processing completes (QBO drops webhooks after 45 seconds).
 *
 * Setup (one-time, in Intuit Developer portal):
 *   1. Go to https://developer.intuit.com → your app → Webhooks
 *   2. Add endpoint URL: https://your-domain.com/api/webhooks/qbo
 *   3. Select events: Invoice, Payment, CreditMemo, Customer, RefundReceipt
 *   4. Copy the "Verifier Token" → add to .env as QBO_WEBHOOK_VERIFIER_TOKEN
 */

import { createHmac, timingSafeEqual } from "crypto";
import { waitUntil } from "@vercel/functions";
import { db } from "@/db";
import { partitionWebhookEntities } from "@/lib/qbo-webhook-entities";
import { qboTokens, qboWebhookEvents } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { syncTargetedEntities, type QboEntityChange } from "@/lib/qbo-sync";
import { syncQboApBills, type QboBillChange } from "@/lib/qbo-ap-sync";

// Extend function lifetime so background processing has room to finish.
// Vercel Hobby: 60s max. Pro: 300s max. Set to 60 as a safe default.
export const maxDuration = 60;

// The entity split, the AR/AP sets and the full list of entities we want QBO to
// send all live in lib/qbo-webhook-entities.ts — a Next route module may only
// export route handlers and route config, so they cannot live here, and keeping
// them in one place is what lets them be unit-tested.

export async function POST(req: Request) {
  // 1. Read raw body BEFORE any parsing (signature is over raw bytes)
  const rawBody = await req.text();

  // 2. Verify QBO HMAC-SHA256 signature — MUST happen before returning 200
  const signature = req.headers.get("intuit-signature");
  const verifierToken = process.env.QBO_WEBHOOK_VERIFIER_TOKEN;

  if (verifierToken) {
    if (!signature) {
      console.warn("QBO webhook: missing intuit-signature header — rejecting");
      await db.insert(qboWebhookEvents).values({
        realmId: "unknown", status: "invalid_signature",
        errorMessage: "Missing intuit-signature header",
      }).catch(() => {});
      return new Response("Missing signature", { status: 401 });
    }
    const expected = createHmac("sha256", verifierToken).update(rawBody).digest("base64");
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    const matches = sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
    if (!matches) {
      console.warn("QBO webhook: signature mismatch — rejecting");
      await db.insert(qboWebhookEvents).values({
        realmId: "unknown", status: "invalid_signature",
        errorMessage: "HMAC mismatch",
      }).catch(() => {});
      return new Response("Invalid signature", { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    // In production, QBO_WEBHOOK_VERIFIER_TOKEN is mandatory. Without it any
    // caller can trigger arbitrary syncs (and exhaust QBO API rate limits).
    console.error("QBO webhook: QBO_WEBHOOK_VERIFIER_TOKEN is not set — rejecting all requests in production");
    await db.insert(qboWebhookEvents).values({
      realmId: "unknown", status: "invalid_signature",
      errorMessage: "QBO_WEBHOOK_VERIFIER_TOKEN env var not configured",
    }).catch(() => {});
    return new Response("Webhook not configured", { status: 503 });
  } else {
    console.warn("QBO webhook: QBO_WEBHOOK_VERIFIER_TOKEN not configured — accepting without verification (dev mode only)");
  }

  console.log("QBO webhook received:", rawBody.slice(0, 300));

  // 3. Parse payload
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // 4. Build per-realmId work items (AR entities + AP bill changes)
  const eventNotifications: any[] = payload.eventNotifications ?? [];
  const workItems: Array<{ realmId: string; changes: QboEntityChange[]; apChanges: QboBillChange[]; otherChanges: QboEntityChange[] }> = [];

  for (const notification of eventNotifications) {
    const realmId: string = notification.realmId;
    const entities: any[] = notification.dataChangeEvent?.entities ?? [];
    if (!realmId || entities.length === 0) continue;

    // One shared split (lib/qbo-webhook-entities.ts) rather than three inline
    // filters, so the buckets cannot drift from what the tests assert.
    const { ar: relevant, ap: apChanges, other: otherChanges } = partitionWebhookEntities(entities);

    if (relevant.length > 0 || apChanges.length > 0 || otherChanges.length > 0) {
      workItems.push({ realmId, changes: relevant, apChanges, otherChanges });
    }
  }

  // 5. Return 200 immediately — QBO retries if we don't respond fast enough.
  //    waitUntil keeps the Vercel function alive to finish processing in the
  //    background, even after the response has been sent to QBO.
  if (workItems.length > 0) {
    waitUntil(processWebhookEvents(workItems));
  }

  return new Response("OK", { status: 200 });
}

// Filters out entity changes whose (name:id:operation) fingerprint already appears
// in successfully-processed events for this realm in the last 2 minutes.
// `isAp` distinguishes Bill changes (no name field) from AR changes (have name field).
async function deduplicateQboEntities(
  realmId: string,
  entities: any[],
  isAp: boolean
): Promise<any[]> {
  if (entities.length === 0) return [];

  const recentRows = await db
    .select({ entities: qboWebhookEvents.entities })
    .from(qboWebhookEvents)
    .where(
      and(
        eq(qboWebhookEvents.realmId, realmId),
        eq(qboWebhookEvents.status, "received"),
        gt(qboWebhookEvents.receivedAt, new Date(Date.now() - 2 * 60 * 1000))
      )
    );

  const processedKeys = new Set<string>();
  for (const row of recentRows) {
    if (Array.isArray(row.entities)) {
      for (const e of row.entities as any[]) {
        const hasName = Boolean(e.name);
        if (isAp ? !hasName : hasName) {
          processedKeys.add(isAp ? `${e.id}:${e.operation}` : `${e.name}:${e.id}:${e.operation}`);
        }
      }
    }
  }

  return entities.filter(e => {
    const key = isAp ? `${e.id}:${e.operation}` : `${e.name}:${e.id}:${e.operation}`;
    return !processedKeys.has(key);
  });
}

async function processWebhookEvents(
  workItems: Array<{ realmId: string; changes: QboEntityChange[]; apChanges: QboBillChange[]; otherChanges: QboEntityChange[] }>
) {
  for (const { realmId, changes, apChanges, otherChanges } of workItems) {
    const startedAt = Date.now();
    const totalCount = changes.length + apChanges.length + otherChanges.length;

    // Find the org that owns this QBO realm
    const [token] = await db
      .select({ orgId: qboTokens.orgId, userId: qboTokens.userId })
      .from(qboTokens)
      .where(eq(qboTokens.realmId, realmId))
      .limit(1);

    if (!token?.orgId) {
      console.warn(`QBO webhook: no org found for realmId ${realmId}`);
      await db.insert(qboWebhookEvents).values({
        realmId, status: "unknown_realm",
        entityCount: totalCount, entities: [...changes, ...apChanges, ...otherChanges] as any,
        errorMessage: `No org connected to realmId ${realmId}`,
      }).catch(() => {});
      continue;
    }

    // Record the entities we have no handler for BEFORE anything that can
    // `continue` or throw, so a capture is never lost to a dispatch problem.
    //
    // Written under status "captured", NOT "received". deduplicateQboEntities
    // only ever reads "received" rows, so these cannot make a later, genuine
    // change look like a duplicate and get skipped — which is exactly what
    // would happen if they shared a status.
    if (otherChanges.length > 0) {
      await db.insert(qboWebhookEvents).values({
        realmId, orgId: token.orgId, status: "captured",
        entityCount: otherChanges.length, entities: otherChanges as any,
      }).catch(e => console.error("QBO webhook: failed to capture unhandled entities:", e?.message));
    }

    if (changes.length === 0 && apChanges.length === 0) continue;

    try {
      // GAP-4: Idempotency — filter out entity changes already processed
      // in the last 2 minutes for this realm. Catches QBO's retry storms
      // when our response was too slow (QBO retries for up to 14 days).
      const freshChanges   = await deduplicateQboEntities(realmId, changes,   false);
      const freshApChanges = await deduplicateQboEntities(realmId, apChanges, true);

      if (freshChanges.length === 0 && freshApChanges.length === 0) {
        console.log(`QBO webhook: all ${totalCount} entity change(s) for realmId ${realmId} are duplicates — skipping`);
        continue;
      }

      if (freshChanges.length > 0) {
        await syncTargetedEntities(token.orgId, token.userId, freshChanges);
      }
      if (freshApChanges.length > 0) {
        await syncQboApBills(token.orgId, token.userId, freshApChanges);
      }
      const ms = Date.now() - startedAt;
      const processedCount = freshChanges.length + freshApChanges.length;
      console.log(`QBO webhook: synced ${processedCount} change(s) for org ${token.orgId} in ${ms}ms`);
      await db.insert(qboWebhookEvents).values({
        realmId, orgId: token.orgId, status: "received",
        entityCount: processedCount,
        entities: [...freshChanges, ...freshApChanges] as any,
        processingMs: ms,
      }).catch(() => {});
    } catch (err: any) {
      const ms = Date.now() - startedAt;
      console.error(`QBO webhook sync failed for org ${token.orgId}:`, err.message);
      await db.insert(qboWebhookEvents).values({
        realmId, orgId: token.orgId, status: "error",
        // Count the dispatched entities only — the captured ones are already
        // recorded in their own row, so counting them here would double them.
        entityCount: changes.length + apChanges.length, entities: [...changes, ...apChanges] as any,
        errorMessage: err?.message || String(err), processingMs: ms,
      }).catch(() => {});
      // Don't throw — log and continue with other orgs
    }
  }
}
