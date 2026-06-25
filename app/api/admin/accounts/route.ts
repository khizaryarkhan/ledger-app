import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmAccounts, landingPageRequests, opportunities, organisations } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";

function schemaMissing(e: unknown) {
  return ((e as any)?.message ?? "").toLowerCase().includes("does not exist");
}

// GET — the unified company directory. One row per crm_accounts, enriched with a
// lead link (if any), the billing org + its status, and a deal count. Each row
// routes to the right 360 (lead cockpit when a lead exists, else customer detail).
export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  try {
    const accounts = await db.select().from(crmAccounts).orderBy(desc(crmAccounts.updatedAt));
    if (accounts.length === 0) return NextResponse.json({ accounts: [] });

    // One lead per account (most recent), for routing.
    const leadRows = await db.select({ accountId: landingPageRequests.accountId, id: landingPageRequests.id })
      .from(landingPageRequests).orderBy(desc(landingPageRequests.createdAt));
    const leadByAccount = new Map<string, string>();
    for (const l of leadRows) if (l.accountId && !leadByAccount.has(l.accountId)) leadByAccount.set(l.accountId, l.id);

    // Org status per linked organisation.
    const orgRows = await db.select({ id: organisations.id, status: organisations.status }).from(organisations);
    const orgById = new Map(orgRows.map(o => [o.id, o.status]));

    // Deal counts per account.
    const dealRows = await db.select({ accountId: opportunities.accountId, c: sql<number>`count(*)::int` })
      .from(opportunities).groupBy(opportunities.accountId);
    const dealsByAccount = new Map<string, number>();
    for (const d of dealRows) if (d.accountId) dealsByAccount.set(d.accountId, Number(d.c));

    const out = accounts.map(a => ({
      id: a.id, name: a.name, lifecycleStage: a.lifecycleStage, billingEmail: a.billingEmail,
      domain: a.domain, country: a.country,
      organisationId: a.organisationId, orgStatus: a.organisationId ? (orgById.get(a.organisationId) ?? null) : null,
      leadId: leadByAccount.get(a.id) ?? null,
      deals: dealsByAccount.get(a.id) ?? 0,
      updatedAt: a.updatedAt,
    }));
    return NextResponse.json({ accounts: out });
  } catch (e) {
    if (schemaMissing(e)) return NextResponse.json({ accounts: [], needsSetup: true });
    throw e;
  }
}
