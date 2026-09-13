/**
 * Building the account map a QBO→GL mapping needs, for one org.
 *
 * Separated from lib/accounting/qbo-gl.ts on purpose: that file is pure and
 * unit-tested, this one touches the database. Keeping the I/O here is what
 * lets the accounting logic be proven without a database.
 */

import { db } from "@/db";
import { accounts } from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { ensureSystemAccounts, systemAccountId, ensureSuspenseAccount } from "./system-accounts";
import type { GlMapContext } from "./qbo-gl";

export class GlContextError extends Error {}

/** Subtypes the mapping cannot proceed without. */
const REQUIRED = {
  ar: "AccountsReceivable",
  ap: "AccountsPayable",
  tax: "SalesTaxPayable",
  undeposited: "UndepositedFunds",
} as const;

/**
 * Resolve everything a mapping needs for `orgId`.
 *
 * `ensureSystemAccounts` runs first so an org that has never posted natively —
 * which is every QBO-connected org today — gets its control accounts created
 * rather than failing. It is idempotent and matches on subtype OR name, so it
 * will adopt a Retained Earnings (or A/R) that the COA sync already brought
 * over from QBO rather than creating a duplicate.
 *
 * Throws rather than substituting a fallback for a missing control account: a
 * mapping that silently posted A/R into suspense would produce a ledger that
 * balances and is meaningless. Suspense is for individual unmappable LINES,
 * never for the control accounts themselves.
 */
export async function buildGlMapContext(orgId: string): Promise<GlMapContext> {
  await ensureSystemAccounts(orgId);

  // Suspense is created on demand rather than seeded for every org — see
  // ensureSuspenseAccount. Only an org whose transactions we actually ingest
  // gets one, so this work stays invisible to everyone else.
  const [ar, ap, tax, undeposited, suspense] = await Promise.all([
    systemAccountId(orgId, REQUIRED.ar),
    systemAccountId(orgId, REQUIRED.ap),
    systemAccountId(orgId, REQUIRED.tax),
    systemAccountId(orgId, REQUIRED.undeposited),
    ensureSuspenseAccount(orgId),
  ]);

  const missing = Object.entries({ ar, ap, tax, undeposited, suspense })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) {
    throw new GlContextError(`org ${orgId} is missing control account(s): ${missing.join(", ")}`);
  }

  return {
    accountByQboId: await loadAccountMap(orgId),
    arAccountId: ar!,
    apAccountId: ap!,
    taxPayableAccountId: tax!,
    undepositedFundsAccountId: undeposited!,
    suspenseAccountId: suspense!,
  };
}

/**
 * QBO Account.Id → our accounts.id, from the COA the sync already brought over.
 *
 * `external_id` is only meaningful alongside the provider it came from, but
 * `accounts` has no external_source column — so this is scoped by org only.
 * That is safe today because an org connects to one provider at a time; if
 * dual-provider orgs ever exist, this needs the source alongside the id.
 */
export async function loadAccountMap(orgId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: accounts.id, externalId: accounts.externalId })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), isNotNull(accounts.externalId)));

  const map = new Map<string, string>();
  for (const r of rows) if (r.externalId) map.set(String(r.externalId), r.id);
  return map;
}

/**
 * How much of this org's chart of accounts we can actually resolve.
 *
 * Worth checking BEFORE an ingestion run rather than discovering it afterwards
 * as a large suspense balance: an org whose COA sync never ran maps nothing, and
 * every line of every transaction would land in suspense — technically balanced,
 * entirely useless. The caller decides the threshold; this only reports.
 */
export async function accountCoverage(orgId: string): Promise<{ total: number; mapped: number }> {
  const rows = await db
    .select({ externalId: accounts.externalId })
    .from(accounts)
    .where(eq(accounts.orgId, orgId));
  return { total: rows.length, mapped: rows.filter(r => r.externalId != null).length };
}
