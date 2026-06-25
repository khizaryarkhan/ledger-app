import { db } from "@/db";
import { crmAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";

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
}): Promise<string | null> {
  const mk = deriveMatchKey(input);
  if (!mk) return null;

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
  return again?.id ?? null;
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
