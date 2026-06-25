/**
 * Phase 1 backfill — give every existing company a crm_accounts row and link it.
 * Idempotent: safe to run repeatedly. RUN ON A NEON BRANCH FIRST, then production.
 *
 *   DATABASE_URL="<neon-branch-url>" npm run db:backfill-accounts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { db } from "@/db";
import { organisations, landingPageRequests, opportunities, crmAccounts } from "@/db/schema";
import { eq, isNull, and } from "drizzle-orm";
import { ensureAccount } from "@/lib/admin/accounts";

async function main() {
  let orgs = 0, leads = 0, opps = 0;

  // 1) Organisations → accounts (existing customers). Link both directions.
  const allOrgs = await db.select({ id: organisations.id, name: organisations.name, accountId: organisations.accountId }).from(organisations);
  for (const o of allOrgs) {
    if (o.accountId) continue;
    const accountId = await ensureAccount({ name: o.name, organisationId: o.id });
    if (accountId) {
      await db.update(organisations).set({ accountId }).where(eq(organisations.id, o.id));
      await db.update(crmAccounts).set({ organisationId: o.id, lifecycleStage: "customer", updatedAt: new Date() }).where(eq(crmAccounts.id, accountId));
      orgs++;
    }
  }

  // 2) Leads → accounts.
  const allLeads = await db.select({ id: landingPageRequests.id, companyName: landingPageRequests.companyName, fullName: landingPageRequests.fullName, email: landingPageRequests.email, country: landingPageRequests.country, accountId: landingPageRequests.accountId }).from(landingPageRequests);
  for (const l of allLeads) {
    if (l.accountId) continue;
    const accountId = await ensureAccount({ name: l.companyName || l.fullName, email: l.email, country: l.country });
    if (accountId) { await db.update(landingPageRequests).set({ accountId }).where(eq(landingPageRequests.id, l.id)); leads++; }
  }

  // 3) Opportunities → inherit account from their lead, then org.
  const allOpps = await db.select({ id: opportunities.id, leadId: opportunities.leadId, orgId: opportunities.orgId, accountId: opportunities.accountId }).from(opportunities);
  for (const op of allOpps) {
    if (op.accountId) continue;
    let accountId: string | null = null;
    if (op.leadId) { const [l] = await db.select({ accountId: landingPageRequests.accountId }).from(landingPageRequests).where(eq(landingPageRequests.id, op.leadId)).limit(1); accountId = l?.accountId ?? null; }
    if (!accountId && op.orgId) { const [o] = await db.select({ accountId: organisations.accountId }).from(organisations).where(eq(organisations.id, op.orgId)).limit(1); accountId = o?.accountId ?? null; }
    if (accountId) { await db.update(opportunities).set({ accountId }).where(eq(opportunities.id, op.id)); opps++; }
  }

  console.log(`✓ Backfill complete — accounts linked: ${orgs} orgs, ${leads} leads, ${opps} opportunities.`);
}

main().catch((e) => { console.error("Backfill failed:", e); process.exit(1); });
