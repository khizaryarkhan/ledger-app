import { db } from "@/db";
import { crmAccounts, organisations, landingPageRequests, opportunities } from "@/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

// Generic mailbox providers — a shared domain here does NOT mean same company.
const GENERIC = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "outlook.com",
  "live.com", "icloud.com", "me.com", "aol.com", "proton.me", "protonmail.com", "msn.com",
]);

const normName = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Dedup key for a company (the resolved architecture decision):
 *   non-generic email domain → normalized company name → email.
 * Returns null if there's nothing to key on.
 */
export function deriveMatchKey(input: { name?: string | null; email?: string | null }): { key: string; domain: string | null } | null {
  const email = (input.email || "").trim().toLowerCase();
  const domain = email.includes("@") ? email.split("@")[1] : "";
  if (domain && !GENERIC.has(domain)) return { key: `domain:${domain}`, domain };
  const nn = normName(input.name || "");
  if (nn) return { key: `name:${nn}`, domain: domain || null };
  if (email) return { key: `email:${email}`, domain: null };
  return null;
}

/**
 * Find-or-create the crm_accounts row for a company. Idempotent (unique matchKey
 * + onConflictDoNothing). Links the billing org / Stripe customer when newly known.
 * This is the single entry point write paths use to keep one company = one account.
 */
export async function ensureAccount(input: {
  name?: string | null; email?: string | null; country?: string | null;
  organisationId?: string | null; stripeCustomerId?: string | null;
}): Promise<string> {
  // Phase 4: account_id is required everywhere, so this must always resolve to an
  // id. Keyable input dedups by matchKey; truly anonymous input (no name/email)
  // gets its own non-colliding account rather than blocking the insert.
  const mk = deriveMatchKey(input) ?? { key: `anon:${randomUUID()}`, domain: null };

  const [existing] = await db.select({ id: crmAccounts.id, organisationId: crmAccounts.organisationId, stripeCustomerId: crmAccounts.stripeCustomerId, billingEmail: crmAccounts.billingEmail })
    .from(crmAccounts).where(eq(crmAccounts.matchKey, mk.key)).limit(1);

  if (existing) {
    const patch: Record<string, any> = {};
    if (input.organisationId && !existing.organisationId) patch.organisationId = input.organisationId;
    if (input.stripeCustomerId && !existing.stripeCustomerId) patch.stripeCustomerId = input.stripeCustomerId;
    if (input.email && !existing.billingEmail) patch.billingEmail = input.email.trim().toLowerCase();
    if (Object.keys(patch).length) { patch.updatedAt = new Date(); await db.update(crmAccounts).set(patch).where(eq(crmAccounts.id, existing.id)); }
    return existing.id;
  }

  const name = (input.name || mk.domain || input.email || "Company").trim();
  const [row] = await db.insert(crmAccounts).values({
    name, matchKey: mk.key, domain: mk.domain,
    billingEmail: input.email?.trim().toLowerCase() || null,
    country: input.country || null,
    organisationId: input.organisationId || null,
    stripeCustomerId: input.stripeCustomerId || null,
  }).onConflictDoNothing({ target: crmAccounts.matchKey }).returning({ id: crmAccounts.id });
  if (row) return row.id;

  // Lost a race — re-read.
  const [again] = await db.select({ id: crmAccounts.id }).from(crmAccounts).where(eq(crmAccounts.matchKey, mk.key)).limit(1);
  if (again) return again.id;
  throw new Error(`ensureAccount: could not resolve account for key ${mk.key}`);
}

// Advance the account's lifecycle, never regress (lead → … → customer).
const LIFECYCLE_ORDER = ["lead", "prospect", "qualified", "customer"];
export async function advanceAccountLifecycle(accountId: string | null | undefined, stage: string): Promise<void> {
  if (!accountId) return;
  const [a] = await db.select({ lifecycleStage: crmAccounts.lifecycleStage }).from(crmAccounts).where(eq(crmAccounts.id, accountId)).limit(1);
  if (!a) return;
  if (LIFECYCLE_ORDER.indexOf(stage) > LIFECYCLE_ORDER.indexOf(a.lifecycleStage)) {
    await db.update(crmAccounts).set({ lifecycleStage: stage, updatedAt: new Date() }).where(eq(crmAccounts.id, accountId));
  }
}

/**
 * Idempotent backfill: give every existing company a crm_accounts row and link
 * org/lead/opportunity. Safe to run repeatedly (only touches rows with no
 * account_id yet). Shared by the CLI script and the admin one-click endpoint.
 */
export async function backfillAllAccounts(): Promise<{ orgs: number; leads: number; opps: number }> {
  let orgs = 0, leads = 0, opps = 0;

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

  const allLeads = await db.select({ id: landingPageRequests.id, companyName: landingPageRequests.companyName, fullName: landingPageRequests.fullName, email: landingPageRequests.email, country: landingPageRequests.country, accountId: landingPageRequests.accountId }).from(landingPageRequests);
  for (const l of allLeads) {
    if (l.accountId) continue;
    const accountId = await ensureAccount({ name: l.companyName || l.fullName, email: l.email, country: l.country });
    if (accountId) { await db.update(landingPageRequests).set({ accountId }).where(eq(landingPageRequests.id, l.id)); leads++; }
  }

  const allOpps = await db.select({ id: opportunities.id, leadId: opportunities.leadId, orgId: opportunities.orgId, accountId: opportunities.accountId }).from(opportunities);
  for (const op of allOpps) {
    if (op.accountId) continue;
    let accountId: string | null = null;
    if (op.leadId) { const [l] = await db.select({ accountId: landingPageRequests.accountId }).from(landingPageRequests).where(eq(landingPageRequests.id, op.leadId)).limit(1); accountId = l?.accountId ?? null; }
    if (!accountId && op.orgId) { const [o] = await db.select({ accountId: organisations.accountId }).from(organisations).where(eq(organisations.id, op.orgId)).limit(1); accountId = o?.accountId ?? null; }
    if (accountId) { await db.update(opportunities).set({ accountId }).where(eq(opportunities.id, op.id)); opps++; }
  }

  return { orgs, leads, opps };
}
