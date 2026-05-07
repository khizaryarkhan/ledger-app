/**
 * Scheduled QBO sync — runs every 30 minutes via Vercel Cron.
 * Also serves as the first-time setup sync: on first connect, QBO has no
 * webhooks yet so this cron ensures the initial data load completes within
 * 30 minutes of connection without any user action.
 *
 * Protected by CRON_SECRET so it cannot be triggered by random callers.
 * Each org with a valid QBO token is synced in sequence.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { qboTokens } from "@/db/schema";
import { runQboSync } from "@/lib/qbo-sync";

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

  const summary: Array<{
    orgId: string | null;
    company: string | null;
    status: string;
    error?: string;
    results?: any;
  }> = [];

  for (const token of tokens) {
    if (!token.orgId) continue;

    // Skip if the refresh token has expired — org needs to re-connect
    if (new Date(token.refreshTokenExpiresAt) < new Date()) {
      summary.push({
        orgId: token.orgId,
        company: token.companyName,
        status: "skipped",
        error: "Refresh token expired — re-connect QuickBooks in Settings",
      });
      continue;
    }

    try {
      const results = await runQboSync(token.orgId, token.userId);
      summary.push({ orgId: token.orgId, company: token.companyName, status: "ok", results });
    } catch (e: any) {
      console.error(`QBO cron sync failed for org ${token.orgId}:`, e.message);
      summary.push({
        orgId: token.orgId,
        company: token.companyName,
        status: "error",
        error: e.message,
      });
    }
  }

  return NextResponse.json({
    ran: new Date().toISOString(),
    orgs: summary.length,
    summary,
  });
}
