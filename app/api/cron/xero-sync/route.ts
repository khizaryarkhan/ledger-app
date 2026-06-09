/**
 * Scheduled Xero sync — runs via Vercel Cron (configured in vercel.json).
 *
 * Xero access tokens expire every 30 minutes, so the cron provides a
 * safety-net full sync independently of webhooks. It also handles the
 * first-time data load after an org connects (before any webhooks fire).
 *
 * Protected by CRON_SECRET so it cannot be triggered by arbitrary callers.
 *
 * Each org with a valid Xero token is synced in PARALLEL (Promise.allSettled).
 * Total wall-clock = slowest single org, not the sum of all orgs.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { xeroTokens } from "@/db/schema";
import { runXeroSync } from "@/lib/xero-sync";

export const maxDuration = 60; // Vercel Pro — seconds

export async function GET(req: Request) {
  // Guard: CRON_SECRET must be set. Without it any caller could trigger syncs.
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const tokens = await db
    .select({
      orgId: xeroTokens.orgId,
      userId: xeroTokens.userId,
      refreshTokenExpiresAt: xeroTokens.refreshTokenExpiresAt,
      tenantName: xeroTokens.tenantName,
    })
    .from(xeroTokens);

  const started = Date.now();

  const settled = await Promise.allSettled(
    tokens
      .filter((t) => !!t.orgId)
      .map(async (token) => {
        // Skip if the refresh token has expired — org needs to reconnect
        if (new Date(token.refreshTokenExpiresAt) < new Date()) {
          return {
            orgId: token.orgId,
            tenant: token.tenantName,
            status: "skipped" as const,
            error: "Refresh token expired — reconnect Xero in Settings → Integrations",
          };
        }

        const results = await runXeroSync(token.orgId!, token.userId);
        return {
          orgId: token.orgId,
          tenant: token.tenantName,
          status: "ok" as const,
          results,
        };
      })
  );

  const summary = settled.map((r) => {
    if (r.status === "fulfilled") return r.value;
    const err = r.reason as any;
    console.error("Xero cron sync error:", err?.message || err);
    return {
      orgId: null,
      tenant: null,
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
