/**
 * System accounts — the special accounts QuickBooks (Desktop & Online)
 * auto-creates for every company and never lets you delete, because the books
 * and the year-end close depend on them. We create the same set for every org
 * and flag them is_system so they can't be removed or deactivated.
 *
 * Identified by QBO's canonical AccountSubType, so if the org already synced an
 * equivalent from QBO/Xero we reuse (and protect) it instead of duplicating.
 */

import { db } from "@/db";
import { accounts } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import type { CoaSeed } from "./standard-coa";

export const SYSTEM_ACCOUNTS: CoaSeed[] = [
  // Control accounts — the subledgers (AR / AP) roll up into these.
  { name: "Accounts Receivable (A/R)", code: "1100", classification: "Asset",     type: "Accounts Receivable",      subtype: "AccountsReceivable" },
  { name: "Accounts Payable (A/P)",    code: "2000", classification: "Liability",  type: "Accounts Payable",         subtype: "AccountsPayable" },
  // Payment holding + tax control.
  { name: "Undeposited Funds",         code: "1150", classification: "Asset",     type: "Other Current Asset",      subtype: "UndepositedFunds" },
  { name: "Sales Tax Payable",         code: "2200", classification: "Liability", type: "Other Current Liability",  subtype: "SalesTaxPayable" },
  // Equity — opening balances + the year-end close target.
  { name: "Opening Balance Equity",    code: "3000", classification: "Equity",    type: "Equity",                   subtype: "OpeningBalanceEquity" },
  { name: "Retained Earnings",         code: "3900", classification: "Equity",    type: "Equity",                   subtype: "RetainedEarnings" },
  // Catch-alls used by opening balances / unmatched transactions.
  { name: "Uncategorised Income",      code: "4999", classification: "Revenue",   type: "Income",                   subtype: "UnappliedCashPaymentIncome" },
  { name: "Uncategorised Expense",     code: "6999", classification: "Expense",   type: "Expense",                  subtype: "OtherMiscellaneousServiceCost" },
  // Multi-currency: realised FX difference on settling foreign transactions.
  { name: "Exchange Gain or Loss",     code: "6950", classification: "Expense",   type: "Other Expense",            subtype: "ExchangeGainOrLoss" },
  // NOT here any more: Inventory Asset, Cost of Goods Sold, Inventory
  // Adjustments, GR/IR and Materials with Job Worker. Inventory accounts are
  // ROLES now (lib/accounting/account-roles.ts), seeded by
  // provisionInventoryAccounting only for an org that actually does inventory —
  // listing them here put a stock ledger into every Receivables-only tenant's
  // chart, because ensureSystemAccounts runs from ~20 unrelated paths. Orgs that
  // already have them keep them; the existing GR/IR, COGS and Adjustments
  // accounts are ADOPTED into their roles rather than duplicated.
]

/**
 * Mirrored-ledger suspense. When a provider transaction is posted into our GL
 * and one of its lines references an account we cannot resolve (deleted or
 * merged in QBO after the fact, or a COA sync that has not caught up), the line
 * lands HERE rather than being dropped.
 *
 * Dropping it is the dangerous option: every provider transaction is internally
 * balanced, so removing one line unbalances the entry — postJournalEntry then
 * rejects the whole transaction, silently leaving a gap in the ledger. Routing
 * to suspense keeps the entry balanced and makes the problem VISIBLE as a
 * non-zero suspense balance somebody has to clear.
 *
 * Deliberately a balance-sheet account, not Uncategorised Income/Expense: an
 * unmappable line must never quietly become revenue or cost and distort the
 * P&L. A suspense balance is an obvious "unfinished" signal; a slightly wrong
 * profit figure is not.
 *
 * NOT in SYSTEM_ACCOUNTS on purpose. ensureSystemAccounts is called from many
 * existing paths, so listing it there would make a new account appear in every
 * org's Chart of Accounts — including a paying client's — the next time any of
 * them ran, purely because of work that is otherwise invisible to them. It is
 * created on demand instead, by the GL ingestion that actually needs it.
 */
export const SUSPENSE_ACCOUNT: CoaSeed =
  { name: "Suspense (Unmapped)", code: "1999", classification: "Asset", type: "Other Current Asset", subtype: "Suspense" };

/** Canonical subtype for the mirrored-ledger suspense account. */
export const SUSPENSE_SUBTYPE = "Suspense";

/**
 * Resolve the suspense account, creating it if this org has never needed one.
 * Idempotent, and only ever called from the provider-GL ingestion path.
 */
export async function ensureSuspenseAccount(orgId: string): Promise<string> {
  const existing = await systemAccountId(orgId, SUSPENSE_SUBTYPE);
  if (existing) return existing;
  const a = SUSPENSE_ACCOUNT;
  const [row] = await db.insert(accounts).values({
    orgId, source: "native", name: a.name, code: a.code,
    classification: a.classification, type: a.type, subtype: a.subtype ?? null,
    status: "Active", isSystem: true,
  }).returning({ id: accounts.id });
  return row.id;
}

/** Look up a system account for an org by its canonical subtype (case-insensitive). */
export async function systemAccountId(orgId: string, subtype: string): Promise<string | null> {
  const rows = await db.select({ id: accounts.id, subtype: accounts.subtype })
    .from(accounts).where(eq(accounts.orgId, orgId));
  const hit = rows.find(r => (r.subtype ?? "").toLowerCase() === subtype.toLowerCase());
  return hit?.id ?? null;
}

// INV_SUBTYPE is gone on purpose. Resolving an inventory account by subtype
// returned the FIRST match in the org — a second "Inventory"-subtyped account
// silently became the one stock posted to. Use roleAccount() /
// loadItemCostInfo (lib/accounting/account-roles-server.ts).

const SYSTEM_SUBTYPES = SYSTEM_ACCOUNTS.map(a => a.subtype!).filter(Boolean);

/**
 * Guarantee the org has all system accounts and that any matching account
 * (native OR synced) is flagged is_system. Idempotent — safe to call often.
 * Matches an existing account by canonical subtype OR by name so we never
 * duplicate a Retained Earnings that QBO/Xero already synced.
 */
export async function ensureSystemAccounts(orgId: string): Promise<void> {
  const existing = await db
    .select({ id: accounts.id, name: accounts.name, subtype: accounts.subtype, isSystem: accounts.isSystem })
    .from(accounts)
    .where(eq(accounts.orgId, orgId));

  // 1. Protect any existing account that IS a system account (by subtype).
  const toProtect = existing.filter(a => a.subtype && SYSTEM_SUBTYPES.includes(a.subtype) && !a.isSystem).map(a => a.id);
  if (toProtect.length) {
    await db.update(accounts).set({ isSystem: true }).where(and(eq(accounts.orgId, orgId), inArray(accounts.id, toProtect)));
  }

  // 2. Insert any system account the org doesn't have yet (match by subtype or name).
  const haveSub = new Set(existing.map(a => (a.subtype ?? "").toLowerCase()).filter(Boolean));
  const haveName = new Set(existing.map(a => a.name.trim().toLowerCase()));
  const missing = SYSTEM_ACCOUNTS.filter(a => !haveSub.has((a.subtype ?? "").toLowerCase()) && !haveName.has(a.name.toLowerCase()));
  if (missing.length) {
    await db.insert(accounts).values(missing.map(a => ({
      orgId, source: "native", name: a.name, code: a.code,
      classification: a.classification, type: a.type, subtype: a.subtype ?? null,
      status: "Active", isSystem: true,
    })));
  }
}
