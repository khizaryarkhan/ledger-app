/**
 * Xero Webhook receiver — real-time sync.
 *
 * Xero pushes a POST to this URL immediately after any entity changes.
 * We verify the HMAC-SHA256 signature, resolve the tenant → org mapping,
 * and run a targeted sync (only fetching the specific changed entities).
 *
 * The targeted sync runs synchronously before responding — it is fast
 * (2–5 seconds) and Xero allows up to 5 seconds before retrying.
 *
 * NOTE: Xero uses the same endpoint for all tenants; the tenantId in the
 * payload is how we identify the org.
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
import { db } from "@/db";
import { xeroTokens, xeroWebhookEvents } from "@/db/schema";
import { eq } from "drizzle-orm";
import { syncXeroTargetedEntities, type XeroEntityChange } from "@/lib/xero-sync";

// Entity categories we care about — ignore everything else (PurchaseOrder, Account, etc.)
const RELEVANT_CATEGORIES = new Set([
  "INVOICE",
  "CREDITNOTE",
  "CONTACT",
  "PAYMENT",
]);

export async function POST(req: Request) {
  const startedAt = Date.now();

  // 1. Read raw body BEFORE any parsing (signature is computed over raw bytes)
  const rawBody = await req.text();

  // 2. Verify Xero HMAC-SHA256 signature
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
  //    { events: [{ resourceUrl, resourceId, eventDateUtc, eventType, eventCategory, tenantId, tenantType }] }
  const events: any[] = payload.events ?? [];

  // Xero ITR handshake: empty events list → just 200
  if (events.length === 0) {
    return new Response("OK", { status: 200 });
  }

  // Group events by tenantId
  const byTenant = new Map<string, XeroEntityChange[]>();
  for (const ev of events) {
    const { tenantId, resourceId, eventType, eventCategory } = ev;
    if (!tenantId || !resourceId) continue;
    if (!RELEVANT_CATEGORIES.has(eventCategory?.toUpperCase())) continue;

    if (!byTenant.has(tenantId)) byTenant.set(tenantId, []);
    byTenant.get(tenantId)!.push({
      resourceId,
      eventType: eventType?.toUpperCase() ?? "UPDATE",
      eventCategory: eventCategory?.toUpperCase() ?? "INVOICE",
      tenantId,
    });
  }

  // 6. Process each tenant's changes
  for (const [tenantId, changes] of byTenant.entries()) {
    // Resolve tenantId → org
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
      await syncXeroTargetedEntities(token.orgId, token.userId, changes);
      const ms = Date.now() - startedAt;
      console.log(
        `Xero webhook: synced ${changes.length} change(s) for org ${token.orgId} in ${ms}ms`
      );
      await logEvent(tenantId, token.orgId, "received", changes.length, changes, null, ms);
    } catch (err: any) {
      const ms = Date.now() - startedAt;
      console.error(`Xero webhook sync failed for org ${token.orgId}:`, err.message);
      await logEvent(
        tenantId, token.orgId, "error", changes.length, changes,
        err?.message || String(err), ms
      );
      // Don't throw — log and continue
    }
  }

  return new Response("OK", { status: 200 });
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
