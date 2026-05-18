/**
 * Scheduled QBO sync — runs every 30 minutes via Vercel Cron.
 * Also serves as the first-time setup sync: on first connect, QBO has no
 * webhooks yet so this cron ensures the initial data load completes within
 * 30 minutes of connection without any user action.
 *
 * Protected by CRON_SECRET so it cannot be triggered by random callers.
 *
 * Each org with a valid QBO token is synced in PARALLEL (Promise.allSettled).
 * This means total wall-clock time = the slowest single org, not the sum of
 * all orgs — keeping well within Vercel Pro's 60-second function limit.
 *
 * Future scaling: when you have many orgs or very large datasets, replace
 * the direct runQboSync() calls here with Inngest job dispatches so each
 * org gets its own isolated function invocation with no shared timeout.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { qboTokens } from "@/db/schema";
import { runQboSync } from "@/lib/qbo-sync";

export const maxDuration = 60; // Vercel Pro — seconds

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Fetch all orgs with a QBO connection
  const tokens = await db
    .select({
      orgId: qboTokens.orgId,
      userId: qboTokens.userId,
      refreshTokenExpiresAt: qboTokens.refreshTokenExpiresAt,
      companyName: qboTokens.companyName,
    })
    .from(qboTokens);

  const started = Date.now();

  // Run all org syncs in parallel — each org is independent and QBO rate
  // limits are per-realm, so parallel calls don't compete with each other.
  const settled = await Promise.allSettled(
    tokens
      .filter((t) => !!t.orgId)
      .map(async (token) => {
        // Skip if the refresh token has expired — org needs to re-connect
        if (new Date(token.refreshTokenExpiresAt) < new Date()) {
          return {
            orgId: token.orgId,
            company: token.companyName,
            status: "skipped" as const,
            error: "Refresh token expired — re-connect QuickBooks in Settings",
          };
        }

        const results = await runQboSync(token.orgId!, token.userId);
        return {
          orgId: token.orgId,
          company: token.companyName,
          status: "ok" as const,
          results,
        };
      })
  );

  const summary = settled.map((r) => {
    if (r.status === "fulfilled") return r.value;
    // Promise rejected (unhandled error inside runQboSync)
    const err = r.reason as any;
    console.error("QBO cron sync error:", err?.message || err);
    return {
      orgId: null,
      company: null,
      status: "error" as const,
      error: err?.message || String(err),
    };
  });

  return NextResponse.json({
    ran: new Date().toISOString(),
    durationMs: Date.now() - started,
    orgs: summary.length,
    summary,
  });
}
