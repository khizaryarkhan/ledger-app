import { db } from "@/db";
import { opportunities, crmAccounts, subscriptions, forecastSnapshots } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// Vercel Cron (daily) — capture a point-in-time snapshot of pipeline + funnel
// so Reports can show trends. Idempotent: re-running on the same day replaces
// that day's row. Guarded by CRON_SECRET (bypassed in middleware as /api/cron).
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const today = new Date().toISOString().slice(0, 10);

  // Pipeline (open) + won.
  const [pipe] = await db.select({
    open:     sql<number>`coalesce(sum(${opportunities.value}) filter (where ${opportunities.status} = 'open'), 0)::int`,
    weighted: sql<number>`coalesce(round(sum(${opportunities.value} * ${opportunities.confidence} / 100.0) filter (where ${opportunities.status} = 'open')), 0)::int`,
    won:      sql<number>`coalesce(sum(${opportunities.value}) filter (where ${opportunities.status} = 'won'), 0)::int`,
    openN:    sql<number>`(count(*) filter (where ${opportunities.status} = 'open'))::int`,
  }).from(opportunities);

  // By-stage open value.
  const stageRows = await db.select({ stage: opportunities.stage, value: sql<number>`coalesce(sum(${opportunities.value}), 0)::int` })
    .from(opportunities).where(eq(opportunities.status, "open")).groupBy(opportunities.stage);
  const byStage: Record<string, number> = {};
  for (const s of stageRows) byStage[s.stage] = s.value;

  // Funnel counts.
  const [funnel] = await db.select({
    customers: sql<number>`(count(*) filter (where ${crmAccounts.lifecycleStage} = 'customer'))::int`,
    leads:     sql<number>`(count(*) filter (where ${crmAccounts.lifecycleStage} in ('lead','prospect','qualified')))::int`,
  }).from(crmAccounts);

  // MRR (minor units) from active subscriptions, normalized to monthly.
  const subs = await db.select({ amount: subscriptions.planAmount, interval: subscriptions.planInterval })
    .from(subscriptions).where(eq(subscriptions.status, "active"));
  let mrr = 0;
  for (const s of subs) {
    const a = s.amount ?? 0;
    mrr += s.interval === "year" ? Math.round(a / 12) : a; // month/other treated monthly
  }

  // Idempotent: one row per day.
  await db.delete(forecastSnapshots).where(eq(forecastSnapshots.snapshotDate, today));
  await db.insert(forecastSnapshots).values({
    snapshotDate: today,
    openPipeline: pipe?.open ?? 0, weightedPipeline: pipe?.weighted ?? 0, wonValue: pipe?.won ?? 0,
    openDeals: pipe?.openN ?? 0, customers: funnel?.customers ?? 0, activeLeads: funnel?.leads ?? 0,
    mrr, byStage,
  });

  return NextResponse.json({ ok: true, date: today, openPipeline: pipe?.open ?? 0, weighted: pipe?.weighted ?? 0, mrr });
}
