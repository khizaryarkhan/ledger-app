import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmAccounts, landingPageRequests, opportunities, organisations, subscriptions, userOrganisations } from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { formatAccountRef } from "@/lib/admin/accounts";

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

    // Org + subscription per linked organisation (left-join so the directory
    // carries the billing signal — the org table used to show this separately).
    const orgRows = await db
      .select({
        id:               organisations.id,
        slug:             organisations.slug,
        name:             organisations.name,
        status:           organisations.status,
        subId:            subscriptions.id,
        subStatus:        subscriptions.status,
        subSource:        subscriptions.source,
        planName:         subscriptions.planName,
        planAmount:       subscriptions.planAmount,
        planCurrency:     subscriptions.planCurrency,
        planInterval:     subscriptions.planInterval,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd:subscriptions.cancelAtPeriodEnd,
        trialEnd:         subscriptions.trialEnd,
        lastPaymentStatus:subscriptions.lastPaymentStatus,
        manualExpiresAt:  subscriptions.manualExpiresAt,
        paymentMethodBrand:subscriptions.paymentMethodBrand,
        paymentMethodLast4:subscriptions.paymentMethodLast4,
        billingEmail:     subscriptions.billingEmail,
      })
      .from(organisations)
      .leftJoin(subscriptions, eq(subscriptions.orgId, organisations.id))
      .orderBy(desc(subscriptions.createdAt));
    const orgById = new Map<string, any>();
    for (const o of orgRows) if (!orgById.has(o.id)) orgById.set(o.id, o); // latest sub wins

    // Users per org.
    const userRows = await db.select({ orgId: userOrganisations.orgId, c: sql<number>`count(*)::int` })
      .from(userOrganisations).groupBy(userOrganisations.orgId);
    const usersByOrg = new Map(userRows.map(u => [u.orgId, Number(u.c)]));

    // Deal counts per account.
    const dealRows = await db.select({ accountId: opportunities.accountId, c: sql<number>`count(*)::int` })
      .from(opportunities).groupBy(opportunities.accountId);
    const dealsByAccount = new Map<string, number>();
    for (const d of dealRows) if (d.accountId) dealsByAccount.set(d.accountId, Number(d.c));

    const out = accounts.map(a => {
      const org = a.organisationId ? orgById.get(a.organisationId) : null;
      return {
        id: a.id, ref: formatAccountRef(a.refSeq), name: a.name, lifecycleStage: a.lifecycleStage, billingEmail: a.billingEmail,
        domain: a.domain, country: a.country,
        organisationId: a.organisationId, orgStatus: org?.status ?? null,
        leadId: leadByAccount.get(a.id) ?? null,
        deals: dealsByAccount.get(a.id) ?? 0,
        userCount: a.organisationId ? (usersByOrg.get(a.organisationId) ?? 0) : 0,
        updatedAt: a.updatedAt,
        // Billing signal (null when not yet a customer) — for the org modals + columns.
        org: org ? { ...org } : null,
      };
    });
    return NextResponse.json({ accounts: out });
  } catch (e) {
    if (schemaMissing(e)) return NextResponse.json({ accounts: [], needsSetup: true });
    throw e;
  }
}
