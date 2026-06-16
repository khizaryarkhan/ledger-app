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
import { eq } from "drizzle-orm";
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

  // Group events by tenantId
  const byTenant = new Map<string, XeroEntityChange[]>();
  // INVOICE events also feed the payables sync — a Xero "Invoice" is either a
  // sales invoice (ACCREC) or a bill (ACCPAY); the AP handler keeps bills only.
  const apInvoicesByTenant = new Map<string, string[]>();
  for (const ev of events) {
    const { tenantId, resourceId, eventType, eventCategory } = ev;
    if (!tenantId || !resourceId) continue;
    const cat = eventCategory?.toUpperCase();
    if (!RELEVANT_CATEGORIES.has(cat)) continue;

    if (!byTenant.has(tenantId)) byTenant.set(tenantId, []);
    byTenant.get(tenantId)!.push({
      resourceId,
      eventType: eventType?.toUpperCase() ?? "UPDATE",
      eventCategory: cat ?? "INVOICE",
      tenantId,
    });

    if (cat === "INVOICE") {
      if (!apInvoicesByTenant.has(tenantId)) apInvoicesByTenant.set(tenantId, []);
      apInvoicesByTenant.get(tenantId)!.push(resourceId);
    }
  }

  // 6. Return 200 immediately — Xero requires a response within 5 seconds.
  //    waitUntil keeps the Vercel function alive to finish processing in the
  //    background, even after the response has been sent to Xero.
  if (byTenant.size > 0) {
    waitUntil(processTenantChanges(byTenant, apInvoicesByTenant));
  }

  return new Response("OK", { status: 200 });
}

async function processTenantChanges(
  byTenant: Map<string, XeroEntityChange[]>,
  apInvoicesByTenant: Map<string, string[]>
) {
  const startedAt = Date.now();

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
      const apInvoiceIds = apInvoicesByTenant.get(tenantId) ?? [];
      if (apInvoiceIds.length > 0) {
        await syncXeroApBills(token.orgId, token.userId, apInvoiceIds);
      }
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
    }
  }
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
