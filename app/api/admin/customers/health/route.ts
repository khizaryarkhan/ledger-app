/**
 * GET /api/admin/customers/health
 *
 * Per-org health metrics: last login, invoice stats, email cadence, integration
 * status, and cron health. Merged client-side with the billing data from
 * /api/admin/customers to power the health dashboard and cockpit Usage tab.
 */
import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import {
  organisations, users, sessions, invoices, communications,
  qboSyncLog, xeroSyncLog, sageSyncLog, userOrganisations,
} from "@/db/schema";
import { eq, and, gte, desc, inArray, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const now = new Date();
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // Optional single-org filter (used by the account cockpit).
  const singleOrgId = new URL(req.url).searchParams.get("orgId") ?? null;

  const baseQuery = db
    .select({ id: organisations.id, lastCronRun: organisations.lastCronRun, lastCronStats: organisations.lastCronStats })
    .from(organisations);
  const orgs = singleOrgId
    ? await baseQuery.where(eq(organisations.id, singleOrgId))
    : await baseQuery;

  if (!orgs.length) return NextResponse.json([]);
  const orgIds = orgs.map(o => o.id);

  // ── Last login per org ────────────────────────────────────────────────────
  const loginRows = await db
    .select({
      orgId: userOrganisations.orgId,
      lastLogin: sql<string>`max(${sessions.createdAt})`,
    })
    .from(userOrganisations)
    .innerJoin(users, eq(users.id, userOrganisations.userId))
    .innerJoin(sessions, eq(sessions.userId, users.id))
    .where(inArray(userOrganisations.orgId, orgIds))
    .groupBy(userOrganisations.orgId);
  const loginByOrg = new Map(loginRows.map(r => [r.orgId, r.lastLogin ? new Date(r.lastLogin).getTime() : null]));

  // ── Invoice stats per org ─────────────────────────────────────────────────
  const invoiceRows = await db
    .select({
      orgId: invoices.orgId,
      total:   sql<number>`cast(count(*) as integer)`,
      overdue: sql<number>`cast(sum(case when ${invoices.paymentStatus} = 'Overdue' then 1 else 0 end) as integer)`,
      paid:    sql<number>`cast(sum(case when ${invoices.paymentStatus} = 'Paid' then 1 else 0 end) as integer)`,
      arValue: sql<number>`sum(case when ${invoices.paymentStatus} not in ('Paid','Cancelled') then coalesce(${invoices.total},0) - coalesce(${invoices.paid},0) else 0 end)`,
    })
    .from(invoices)
    .where(inArray(invoices.orgId, orgIds))
    .groupBy(invoices.orgId);
  const invByOrg = new Map(invoiceRows.map(r => [r.orgId, r]));

  // ── Emails sent last 30 days ──────────────────────────────────────────────
  const email30d = await db
    .select({ orgId: communications.orgId, count: sql<number>`cast(count(*) as integer)` })
    .from(communications)
    .where(and(inArray(communications.orgId, orgIds), eq(communications.channel, "email"), gte(communications.sentAt, d30)))
    .groupBy(communications.orgId);
  const emails30dByOrg = new Map(email30d.map(r => [r.orgId, Number(r.count)]));

  // ── Emails sent all-time ──────────────────────────────────────────────────
  const emailAll = await db
    .select({ orgId: communications.orgId, count: sql<number>`cast(count(*) as integer)` })
    .from(communications)
    .where(and(inArray(communications.orgId, orgIds), eq(communications.channel, "email")))
    .groupBy(communications.orgId);
  const emailsTotalByOrg = new Map(emailAll.map(r => [r.orgId, Number(r.count)]));

  // ── Latest integration sync per org ──────────────────────────────────────
  const qboRows = await db
    .select({ orgId: qboSyncLog.orgId, syncedAt: qboSyncLog.syncedAt, status: qboSyncLog.status })
    .from(qboSyncLog).where(inArray(qboSyncLog.orgId, orgIds)).orderBy(desc(qboSyncLog.syncedAt));
  const qboByOrg = new Map<string, { syncedAt: Date | null; status: string }>();
  for (const r of qboRows) if (r.orgId && !qboByOrg.has(r.orgId)) qboByOrg.set(r.orgId, { syncedAt: r.syncedAt, status: r.status });

  const xeroRows = await db
    .select({ orgId: xeroSyncLog.orgId, syncedAt: xeroSyncLog.syncedAt, status: xeroSyncLog.status })
    .from(xeroSyncLog).where(inArray(xeroSyncLog.orgId, orgIds)).orderBy(desc(xeroSyncLog.syncedAt));
  const xeroByOrg = new Map<string, { syncedAt: Date | null; status: string }>();
  for (const r of xeroRows) if (r.orgId && !xeroByOrg.has(r.orgId)) xeroByOrg.set(r.orgId, { syncedAt: r.syncedAt, status: r.status });

  const sageRows = await db
    .select({ orgId: sageSyncLog.orgId, syncedAt: sageSyncLog.syncedAt, status: sageSyncLog.status })
    .from(sageSyncLog).where(inArray(sageSyncLog.orgId, orgIds)).orderBy(desc(sageSyncLog.syncedAt));
  const sageByOrg = new Map<string, { syncedAt: Date | null; status: string }>();
  for (const r of sageRows) if (r.orgId && !sageByOrg.has(r.orgId)) sageByOrg.set(r.orgId, { syncedAt: r.syncedAt, status: r.status });

  const result = orgs.map(o => {
    const lastLogin = loginByOrg.get(o.id) ?? null;
    const inv = invByOrg.get(o.id);
    const totalInvoices = Number(inv?.total ?? 0);
    const overdueInvoices = Number(inv?.overdue ?? 0);
    const paidInvoices = Number(inv?.paid ?? 0);
    const arValue = Number(inv?.arValue ?? 0);

    const qbo  = qboByOrg.get(o.id)  ?? null;
    const xero = xeroByOrg.get(o.id) ?? null;
    const sage = sageByOrg.get(o.id) ?? null;
    const integrationType = qbo ? "QBO" : xero ? "Xero" : sage ? "Sage" : null;
    const integrationConnected = !!integrationType;
    const integrationSyncedAt = qbo?.syncedAt ?? xero?.syncedAt ?? sage?.syncedAt ?? null;
    const integrationStatus = qbo?.status ?? xero?.status ?? sage?.status ?? null;

    const cronStats = o.lastCronStats as any;

    const daysSinceLogin = lastLogin
      ? Math.floor((now.getTime() - lastLogin) / (1000 * 60 * 60 * 24))
      : null;

    return {
      orgId: o.id,
      lastLogin,
      daysSinceLogin,
      totalInvoices,
      overdueInvoices,
      paidInvoices,
      arValue,
      emails30d:     emails30dByOrg.get(o.id) ?? 0,
      emailsTotal:   emailsTotalByOrg.get(o.id) ?? 0,
      integrationConnected,
      integrationType,
      integrationStatus,
      integrationSyncedAt: integrationSyncedAt ? new Date(integrationSyncedAt).getTime() : null,
      lastCronRun: o.lastCronRun ? new Date(o.lastCronRun).getTime() : null,
      emailsSentByCron: cronStats?.emailsSent ?? 0,
    };
  });

  return NextResponse.json(result);
}
