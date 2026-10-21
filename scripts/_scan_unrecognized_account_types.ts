/**
 * READ-ONLY: find any `accounts` row whose `type` doesn't match one of the
 * 15 canonical AccountTypeDef.type values lib/accounting/account-types.ts
 * defines. Such a row silently falls through place()'s default branch in
 * lib/accounting/financials.ts — shown as a debit-normal Current Asset
 * regardless of what it actually is, which is exactly the failure mode a
 * mis-mapped Xero AccountType (e.g. PAYGLIABILITY, SUPERANNUATIONLIABILITY)
 * produces. This answers whether that's a live production bug or a
 * theoretical one.
 *
 * Usage: npx tsx scripts/_scan_unrecognized_account_types.ts --env .env.production.vercel
 */
import { config as loadEnv } from "dotenv";

const envArg = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : ".env.local";
loadEnv({ path: envArg, quiet: true });

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error(`No DATABASE_URL(_UNPOOLED) found in ${envArg}`);
  process.env.DATABASE_URL = url;

  const { db } = await import("../db");
  const { accounts, organisations } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  const { ACCOUNT_TYPE_NAMES } = await import("../lib/accounting/account-types");

  const host = url.replace(/\/\/[^@]*@/, "//***@").split("/")[2];
  console.log(`database: ${host}`);
  console.log(`canonical types: ${ACCOUNT_TYPE_NAMES.join(", ")}\n`);

  const rows = await db.select({
    id: accounts.id, orgId: accounts.orgId, name: accounts.name, type: accounts.type,
    classification: accounts.classification, source: accounts.source, status: accounts.status,
  }).from(accounts);

  console.log(`scanned ${rows.length} accounts total\n`);

  const bad = rows.filter(r => !r.type || !ACCOUNT_TYPE_NAMES.includes(r.type as any));
  if (!bad.length) { console.log("None found — every account's type matches the canonical list."); return; }

  const orgIds = [...new Set(bad.map(b => b.orgId))];
  const orgNames = new Map<string, string>();
  for (const id of orgIds) {
    const [o] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, id)).limit(1);
    orgNames.set(id, o?.name ?? id);
  }

  console.log(`${bad.length} account(s) with an unrecognized/missing type:\n`);
  for (const b of bad) {
    console.log(`  [${orgNames.get(b.orgId)}] "${b.name}" (source=${b.source}, status=${b.status}) — type="${b.type}" classification="${b.classification}"`);
  }
  const byOrg = new Map<string, number>();
  for (const b of bad) byOrg.set(b.orgId, (byOrg.get(b.orgId) ?? 0) + 1);
  console.log(`\nBy org:`);
  for (const [id, n] of byOrg) console.log(`  ${orgNames.get(id)}: ${n}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
