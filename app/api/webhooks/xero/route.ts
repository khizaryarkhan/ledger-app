/**
 * Xero Webhook receiver — real-time sync.
 *
 * Xero requires a 200 response within 5 seconds or it marks the delivery
 * as failed. We verify the signature synchronously, then return 200
 * immediately and process in the background using waitUntil so Vercel
 * keeps the function alive until processing completes.
 *
 * Setup (one-time, in Xero Developer portal):
 *   1. Go to https://developer.xero.com → your app → Webhooks
 *   2. Add endpoint URL: https://your-domain.com/api/webhooks/xero
 *   3. Select event types: Invoice, Credit Note, Contact, Payment
 *   4. Copy the "Webhook Key" → add to .env as XERO_WEBHOOK_SIGNING_KEY
 *
 * IMPORTANT: Xero performs an "Intent To Receive" (ITR) handshake when you
 * first register the URL. It sends a POST with an empty body and expects a
 * 200 response with a specific payload signed with your key. This handler
 * returns 200 for the ITR check (empty eventItems list).
 */

import { createHmac, timingSafeEqual } from "crypto";
import { waitUntil } from "@vercel/functions";
import { db } from "@/db";
import { xeroTokens, xeroWebhookEvents } from "@/db/schema";
import { eq, and, gt } from "drizzle-orm";
import { syncXeroTargetedEntities, type XeroEntityChange } from "@/lib/xero-sync";
import { syncXeroApBills } from "@/lib/xero-ap-sync";

// Extend function lifetime so background processing has room to finish.
// Vercel Hobby: 60s max. Pro: 300s max. Set to 60 as a safe default.
export const maxDuration = 60;

// Entity categories we care about — ignore everything else (PurchaseOrder, Account, etc.)
const RELEVANT_CATEGORIES = new Set([
  "INVOICE",
  "CREDITNOTE",
  "CONTACT",
  "PAYMENT",
]);

export async function POST(req: Request) {
  // 1. Read raw body BEFORE any parsing (signature is computed over raw bytes)
  const rawBody = await req.text();

  // 2. Verify Xero HMAC-SHA256 signature — MUST happen before returning 200
  //    Header: x-xero-signature
  //    Algorithm: Base64(HMAC-SHA256(signingKey, rawBody))
  const signature = req.headers.get("x-xero-signature");
  const signingKey = process.env.XERO_WEBHOOK_SIGNING_KEY;

  if (signingKey) {
    if (!signature) {
      console.warn("Xero webhook: missing x-xero-signature header — rejecting");
      await logEvent("unknown", null, "invalid_signature", 0, [], "Missing x-xero-signature header");
      return new Response("Missing signature", { status: 401 });
    }
    const expected = createHmac("sha256", signingKey)
      .update(rawBody)
      .digest("base64");

    const sigBuf = Buffer.from(signature, "base64");
    const expBuf = Buffer.from(expected, "base64");
    const matches =
      sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);

    if (!matches) {
      console.warn("Xero webhook: signature mismatch — rejecting");
      await logEvent("unknown", null, "invalid_signature", 0, [], "HMAC mismatch");
      return new Response("Invalid signature", { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    console.error(
      "Xero webhook: XERO_WEBHOOK_SIGNING_KEY is not set — rejecting all requests in production"
    );
    await logEvent("unknown", null, "invalid_signature", 0, [], "XERO_WEBHOOK_SIGNING_KEY env var not configured");
    return new Response("Webhook not configured", { status: 503 });
  } else {
    console.warn(
      "Xero webhook: XERO_WEBHOOK_SIGNING_KEY not configured — accepting without verification (dev mode only)"
    );
  }

  // 3. Handle empty body (Xero ITR / ping handshake)
  if (!rawBody.trim()) {
    return new Response("OK", { status: 200 });
  }

  // 4. Parse payload
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  console.log("Xero webhook received:", rawBody.slice(0, 300));

  // 5. Xero payload shape:
  //    { events: [{ resourceUrl, resourceId, eventDateUtc, eventType, eventCategory, tenantId, tenantType, eventId }] }
  const events: any[] = payload.events ?? [];

  // Xero ITR handshake: empty events list → just 200
  if (events.length === 0) {
    return new Response("OK", { status: 200 });
  }

  // Group events by tenantId.
  // eventId (per-event UUID from Xero) is captured for idempotency checks.
  const byTenant = new Map<string, XeroEntityChange[]>();
  for (const ev of events) {
    const { tenantId, resourceId, eventType, eventCategory, eventId } = ev;
    if (!tenantId || !resourceId) continue;
    const cat = eventCategory?.toUpperCase();
    if (!RELEVANT_CATEGORIES.has(cat)) continue;

    if (!byTenant.has(tenantId)) byTenant.set(tenantId, []);
    byTenant.get(tenantId)!.push({
      resourceId,
      eventType: eventType?.toUpperCase() ?? "UPDATE",
      eventCategory: cat ?? "INVOICE",
      tenantId,
      xeroEventId: eventId ?? undefined,
    });
  }

  // 6. Return 200 immediately — Xero requires a response within 5 seconds.
  //    waitUntil keeps the Vercel function alive to finish processing in the
  //    background, even after the response has been sent to Xero.
  if (byTenant.size > 0) {
    waitUntil(processTenantChanges(byTenant));
  }

  return new Response("OK", { status: 200 });
}

async function processTenantChanges(byTenant: Map<string, XeroEntityChange[]>) {
  for (const [tenantId, changes] of byTenant.entries()) {
    const startedAt = Date.now();

    const [token] = await db
      .select({ orgId: xeroTokens.orgId, userId: xeroTokens.userId })
      .from(xeroTokens)
      .where(eq(xeroTokens.tenantId, tenantId))
      .limit(1);

    if (!token?.orgId) {
      console.warn(`Xero webhook: no org found for tenantId ${tenantId}`);
      await logEvent(tenantId, null, "unknown_tenant", changes.length, changes,
        `No org connected to tenantId ${tenantId}`);
      continue;
    }

    try {
      // GAP-4: Filter out events whose xeroEventId was already processed in the
      // last 2 minutes — protects against Xero's rapid retry on slow responses.
      const freshChanges = await deduplicateXeroChanges(tenantId, changes);
      if (freshChanges.length === 0) {
        console.log(`Xero webhook: all ${changes.length} event(s) for tenant ${tenantId} are duplicates — skipping`);
        continue;
      }

      // GAP-3: syncXeroTargetedEntities returns non-ACCREC invoice IDs it already
      // fetched, so AP sync receives only those — no redundant Xero API call.
      const { apInvoiceIds } = await syncXeroTargetedEntities(token.orgId, token.userId, freshChanges);
      if (apInvoiceIds.length > 0) {
        await syncXeroApBills(token.orgId, token.userId, apInvoiceIds);
      }

      const ms = Date.now() - startedAt;
      console.log(`Xero webhook: synced ${freshChanges.length} change(s) for org ${token.orgId} in ${ms}ms`);
      await logEvent(tenantId, token.orgId, "received", freshChanges.length, freshChanges, null, ms);
    } catch (err: any) {
      const ms = Date.now() - startedAt;
      console.error(`Xero webhook sync failed for org ${token.orgId}:`, err.message);
      await logEvent(tenantId, token.orgId, "error", changes.length, changes,
        err?.message || String(err), ms);
    }
  }
}

// Filters Xero events whose xeroEventId already appears in successfully-processed
// events for this tenant in the last 2 minutes. Catches Xero's 5s-deadline retries.
async function deduplicateXeroChanges(
  tenantId: string,
  changes: XeroEntityChange[]
): Promise<XeroEntityChange[]> {
  const hasEventIds = changes.some(c => c.xeroEventId);
  if (!hasEventIds) return changes;

  const recentRows = await db
    .select({ entities: xeroWebhookEvents.entities })
    .from(xeroWebhookEvents)
    .where(
      and(
        eq(xeroWebhookEvents.tenantId, tenantId),
        eq(xeroWebhookEvents.status, "received"),
        gt(xeroWebhookEvents.receivedAt, new Date(Date.now() - 2 * 60 * 1000))
      )
    );

  const processedIds = new Set<string>();
  for (const row of recentRows) {
    if (Array.isArray(row.entities)) {
      for (const e of row.entities as any[]) {
        if (e.xeroEventId) processedIds.add(e.xeroEventId);
      }
    }
  }

  return changes.filter(c => !c.xeroEventId || !processedIds.has(c.xeroEventId));
}

async function logEvent(
  tenantId: string,
  orgId: string | null,
  status: string,
  entityCount: number,
  entities: any[],
  errorMessage?: string | null,
  processingMs?: number
) {
  await db
    .insert(xeroWebhookEvents)
    .values({
      tenantId,
      orgId: orgId ?? undefined,
      status,
      entityCount,
      entities: entities as any,
      errorMessage: errorMessage ?? undefined,
      processingMs: processingMs ?? undefined,
    })
    .catch(() => {});
}
