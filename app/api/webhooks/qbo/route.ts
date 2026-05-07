/**
 * QBO Webhook receiver — real-time sync.
 *
 * QuickBooks pushes a POST to this URL within seconds of any change.
 * We verify the HMAC-SHA256 signature, identify which org is affected,
 * and run a targeted sync (only fetching the specific changed invoices/payments).
 *
 * The sync runs synchronously before responding — targeted syncs are fast
 * (2–5 seconds) and QBO allows up to 45 seconds before retrying.
 *
 * Setup (one-time, in Intuit Developer portal):
 *   1. Go to https://developer.intuit.com → your app → Webhooks
 *   2. Add endpoint URL: https://your-domain.com/api/webhooks/qbo
 *   3. Select events: Invoice, Payment, CreditMemo, Customer
 *   4. Copy the "Verifier Token" → add to .env as QBO_WEBHOOK_VERIFIER_TOKEN
 */

import { createHmac } from "crypto";
import { db } from "@/db";
import { qboTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { syncTargetedEntities, type QboEntityChange } from "@/lib/qbo-sync";

// Entity types we care about — ignore everything else (Estimate, Bill, etc.)
const RELEVANT_ENTITIES = new Set(["Invoice", "Payment", "CreditMemo", "Customer"]);

export async function POST(req: Request) {
  // 1. Read raw body BEFORE any parsing (signature is over raw bytes)
  const rawBody = await req.text();

  // 2. Verify QBO HMAC-SHA256 signature
  const signature = req.headers.get("intuit-signature");
  const verifierToken = process.env.QBO_WEBHOOK_VERIFIER_TOKEN;

  if (verifierToken) {
    if (!signature) {
      console.warn("QBO webhook: missing intuit-signature header");
      return new Response("Missing signature", { status: 401 });
    }
    const expected = createHmac("sha256", verifierToken).update(rawBody).digest("base64");
    if (signature !== expected) {
      console.warn("QBO webhook: signature mismatch");
      return new Response("Invalid signature", { status: 401 });
    }
  }

  // 3. Parse payload
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // 4. Respond 200 immediately — QBO will retry if we don't respond fast enough
  //    Process events after sending the response (fire-and-forget)
  const eventNotifications: any[] = payload.eventNotifications ?? [];

  // Build per-realmId work items
  const workItems: Array<{ realmId: string; changes: QboEntityChange[] }> = [];

  for (const notification of eventNotifications) {
    const realmId: string = notification.realmId;
    const entities: any[] = notification.dataChangeEvent?.entities ?? [];
    if (!realmId || entities.length === 0) continue;

    const relevant = entities
      .filter((e: any) => RELEVANT_ENTITIES.has(e.name))
      .map((e: any) => ({ name: e.name, id: e.id, operation: e.operation }));

    if (relevant.length > 0) workItems.push({ realmId, changes: relevant });
  }

  // Process synchronously — targeted sync is fast (2–5s), well within QBO's 45s limit.
  // Fire-and-forget doesn't work on Vercel serverless: the function terminates
  // the moment a response is returned, killing any pending async work.
  if (workItems.length > 0) {
    await processWebhookEvents(workItems);
  }

  return new Response("OK", { status: 200 });
}

async function processWebhookEvents(
  workItems: Array<{ realmId: string; changes: QboEntityChange[] }>
) {
  for (const { realmId, changes } of workItems) {
    // Find the org that owns this QBO realm
    const [token] = await db
      .select({ orgId: qboTokens.orgId, userId: qboTokens.userId })
      .from(qboTokens)
      .where(eq(qboTokens.realmId, realmId))
      .limit(1);

    if (!token?.orgId) {
      console.warn(`QBO webhook: no org found for realmId ${realmId}`);
      continue;
    }

    try {
      await syncTargetedEntities(token.orgId, token.userId, changes);
      console.log(
        `QBO webhook: synced ${changes.length} change(s) for org ${token.orgId}`,
        changes.map((c) => `${c.name}#${c.id}(${c.operation})`).join(", ")
      );
    } catch (err: any) {
      console.error(`QBO webhook sync failed for org ${token.orgId}:`, err.message);
      // Don't throw — log and continue with other orgs
    }
  }
}
