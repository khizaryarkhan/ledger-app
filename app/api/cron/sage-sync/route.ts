/**
 * GET /api/cron/sage-sync
 *
 * Daily cron — runs AR + AP sync for every org with Sage Intacct credentials.
 * Scheduled in vercel.json at 05:00 UTC to avoid overlap with QBO (02:00) and
 * Xero (03:00) crons.
 *
 * Vercel calls this with the CRON_SECRET header; any other caller gets 401.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { sageIntacctCredentials, sageSyncLog } from "@/db/schema";
import { runSageSync } from "@/lib/sage-sync";
import { runSageApSync } from "@/lib/sage-ap-sync";

export const maxDuration = 300;

export async function GET(req: Request) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = req.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  // Find all orgs with Sage credentials
  const creds = await db
    .select({ orgId: sageIntacctCredentials.orgId, userId: sageIntacctCredentials.userId })
    .from(sageIntacctCredentials);

  const results: Record<string, any> = {};

  for (const { orgId, userId } of creds) {
    try {
      const [ar, ap] = await Promise.all([
        runSageSync(orgId, userId),
        runSageApSync(orgId, userId),
      ]);
      results[orgId] = { ar, ap };
    } catch (e: any) {
      console.error(`Sage cron error for org ${orgId}:`, e.message);
      await db
        .insert(sageSyncLog)
        .values({ orgId, userId, status: "error", errorMessage: e.message })
        .catch(() => {});
      results[orgId] = { error: e.message };
    }
  }

  return NextResponse.json({ ok: true, orgs: Object.keys(results).length, results });
}
