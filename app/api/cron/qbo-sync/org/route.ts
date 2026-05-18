/**
 * POST /api/cron/qbo-sync/org
 *
 * Sync a single organisation with QBO. Protected by CRON_SECRET.
 *
 * Body: { orgId: string, userId: string }
 *
 * This endpoint exists so each org can be synced as an independent
 * function invocation — each gets its own 60-second Vercel budget.
 *
 * Called by:
 *   - The cron dispatcher (GET /api/cron/qbo-sync) when parallelism
 *     is not enough and you move to a dispatch pattern
 *   - Inngest / Trigger.dev jobs when you need reliable background queues
 *   - Manual retries from the admin panel
 *
 * Usage with Inngest (future):
 *   inngest.createFunction(
 *     { id: "qbo-sync-org" },
 *     { event: "qbo/sync.requested" },
 *     async ({ event }) => {
 *       await fetch(`${process.env.APP_URL}/api/cron/qbo-sync/org`, {
 *         method: "POST",
 *         headers: {
 *           "Content-Type": "application/json",
 *           Authorization: `Bearer ${process.env.CRON_SECRET}`,
 *         },
 *         body: JSON.stringify({ orgId: event.data.orgId, userId: event.data.userId }),
 *       });
 *     }
 *   );
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { qboTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runQboSync } from "@/lib/qbo-sync";

export const maxDuration = 60; // Vercel Pro

export async function POST(req: Request) {
  // Auth
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const { orgId, userId } = body as { orgId?: string; userId?: string };

  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });

  // Resolve userId from token if not provided
  let resolvedUserId = userId;
  if (!resolvedUserId) {
    const [token] = await db
      .select({ userId: qboTokens.userId, refreshTokenExpiresAt: qboTokens.refreshTokenExpiresAt })
      .from(qboTokens)
      .where(eq(qboTokens.orgId, orgId))
      .limit(1);

    if (!token) {
      return NextResponse.json({ error: "No QBO connection for this org" }, { status: 404 });
    }
    if (new Date(token.refreshTokenExpiresAt) < new Date()) {
      return NextResponse.json(
        { error: "Refresh token expired — re-connect QuickBooks in Settings" },
        { status: 422 }
      );
    }
    resolvedUserId = token.userId;
  }

  const started = Date.now();

  try {
    const results = await runQboSync(orgId, resolvedUserId);
    return NextResponse.json({
      orgId,
      status: "ok",
      durationMs: Date.now() - started,
      results,
    });
  } catch (e: any) {
    console.error(`[qbo-sync/org] Failed for org ${orgId}:`, e.message);
    return NextResponse.json(
      {
        orgId,
        status: "error",
        durationMs: Date.now() - started,
        error: e.message,
      },
      { status: 500 }
    );
  }
}
