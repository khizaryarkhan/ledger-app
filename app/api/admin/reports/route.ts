import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmAccounts, landingPageRequests, opportunities, crmActivities, users, forecastSnapshots } from "@/db/schema";
import { eq, sql, gte, desc } from "drizzle-orm";
import { NextResponse } from "next/server";

const safe = async <T>(p: Promise<T>, fb: T): Promise<T> => { try { return await p; } catch { return fb; } };

// GET /api/admin/reports — RevOps funnel & pipeline analytics, computed off the
// account / opportunity / activity spine. One call powers the Reports page.
export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  // 1. Lifecycle funnel — companies by stage.
  const funnel = await safe(db.select({ stage: crmAccounts.lifecycleStage, n: sql<number>`count(*)::int` })
    .from(crmAccounts).groupBy(crmAccounts.lifecycleStage), [] as any[]);

  // 2. Lead source performance — leads per source + how many became customers.
  const sources = await safe(db.select({
    source:    landingPageRequests.source,
    total:     sql<number>`count(*)::int`,
    converted: sql<number>`(count(*) filter (where ${crmAccounts.lifecycleStage} = 'customer'))::int`,
  }).from(landingPageRequests)
    .leftJoin(crmAccounts, eq(landingPageRequests.accountId, crmAccounts.id))
    .groupBy(landingPageRequests.source), [] as any[]);

  // 3. Pipeline by stage — open deals: count, total value, weighted forecast.
  const pipeline = await safe(db.select({
    stage:    opportunities.stage,
    n:        sql<number>`count(*)::int`,
    value:    sql<number>`coalesce(sum(${opportunities.value}), 0)::int`,
    weighted: sql<number>`coalesce(round(sum(${opportunities.value} * ${opportunities.confidence} / 100.0)), 0)::int`,
  }).from(opportunities).where(eq(opportunities.status, "open")).groupBy(opportunities.stage), [] as any[]);

  // 4. Deal outcomes (all-time): won vs lost count + value.
  const outcomes = await safe(db.select({
    status: opportunities.status,
    n:      sql<number>`count(*)::int`,
    value:  sql<number>`coalesce(sum(${opportunities.value}), 0)::int`,
  }).from(opportunities).groupBy(opportunities.status), [] as any[]);

  // 5. By owner — accounts, customers, open pipeline value.
  const ownerRows = await safe(db.select({
    ownerId:   crmAccounts.ownerAdminId,
    accounts:  sql<number>`count(*)::int`,
    customers: sql<number>`(count(*) filter (where ${crmAccounts.lifecycleStage} = 'customer'))::int`,
  }).from(crmAccounts).groupBy(crmAccounts.ownerAdminId), [] as any[]);
  const admins = await safe(db.select({ id: users.id, name: users.name, email: users.email }).from(users), [] as any[]);
  const nameOf = new Map(admins.map(a => [a.id, a.name || a.email]));
  const owners = ownerRows.map(o => ({ ...o, name: o.ownerId ? (nameOf.get(o.ownerId) ?? "Unknown") : "Unassigned" }));

  // 6. Activity volume — last 30 days by type.
  const since = new Date(Date.now() - 30 * 86_400_000);
  const activity = await safe(db.select({ type: crmActivities.type, n: sql<number>`count(*)::int` })
    .from(crmActivities).where(gte(crmActivities.occurredAt, since)).groupBy(crmActivities.type), [] as any[]);

  // 7. Forecast trend — last 30 daily snapshots (chronological).
  const snaps = await safe(db.select({
    date: forecastSnapshots.snapshotDate, openPipeline: forecastSnapshots.openPipeline,
    weightedPipeline: forecastSnapshots.weightedPipeline, mrr: forecastSnapshots.mrr,
    customers: forecastSnapshots.customers,
  }).from(forecastSnapshots).orderBy(desc(forecastSnapshots.snapshotDate)).limit(30), [] as any[]);
  const trend = snaps.reverse();

  return NextResponse.json({ funnel, sources, pipeline, outcomes, owners, activity, trend });
}
