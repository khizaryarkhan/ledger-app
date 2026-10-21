/**
 * READ-ONLY scan: how many existing items would newly fail Phase 1's item-
 * account-mapping validation (account-roles-server.ts's prepareItemAccounting)
 * the next time they're saved? Untracked kinds only (Service, Non-Inventory,
 * Other Charge) — tracked items were already enforced via posting groups.
 *
 * Usage:
 *   npx tsx scripts/_scan_missing_item_accounts.ts --env .env.production.vercel
 *
 * NOTE: makes NO writes. Report only.
 */
import { config as loadEnv } from "dotenv";

const envArg = process.argv.includes("--env")
  ? process.argv[process.argv.indexOf("--env") + 1]
  : ".env.local";
loadEnv({ path: envArg, quiet: true });

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error(`No DATABASE_URL(_UNPOOLED) found in ${envArg}`);
  process.env.DATABASE_URL = url;

  const { db } = await import("../db");
  const { apItems, organisations } = await import("../db/schema");
  const { eq } = await import("drizzle-orm");
  const { groupTypeForKind } = await import("../lib/accounting/account-roles");
  const { itemCanBeSold, itemCanBePurchased } = await import("../lib/inventory/item-kinds");

  const host = url.replace(/\/\/[^@]*@/, "//***@").split("/")[2];
  console.log(`database: ${host}\n`);

  const rows = await db.select({
    id: apItems.id, orgId: apItems.orgId, name: apItems.name, productType: apItems.productType,
    canBeSold: apItems.canBeSold, canBePurchased: apItems.canBePurchased,
    incomeAccountId: apItems.incomeAccountId, expenseAccountId: apItems.expenseAccountId,
  }).from(apItems);

  const untracked = rows.filter(r => !groupTypeForKind(r.productType));
  console.log(`${untracked.length} untracked items (Service/Non-Inventory) out of ${rows.length} total\n`);

  const missing: typeof rows = [];
  for (const r of untracked) {
    const sellable = itemCanBeSold(r);
    const purchasable = itemCanBePurchased(r);
    const missingIncome = sellable && !r.incomeAccountId;
    const missingExpense = purchasable && !r.expenseAccountId;
    if (missingIncome || missingExpense) missing.push(r);
  }

  if (!missing.length) {
    console.log("None — every existing untracked item already has what it needs.");
    return;
  }

  console.log(`${missing.length} item(s) would be blocked on their NEXT edit until mapped:\n`);
  const orgIds = [...new Set(missing.map(m => m.orgId))];
  const orgNames = new Map<string, string>();
  for (const id of orgIds) {
    const [o] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, id)).limit(1);
    orgNames.set(id, o?.name ?? id);
  }
  const byOrg = new Map<string, number>();
  for (const m of missing) {
    byOrg.set(m.orgId, (byOrg.get(m.orgId) ?? 0) + 1);
    const sellable = itemCanBeSold(m), purchasable = itemCanBePurchased(m);
    const gap = [sellable && !m.incomeAccountId ? "no income account" : null, purchasable && !m.expenseAccountId ? "no expense account" : null].filter(Boolean).join(", ");
    console.log(`  [${orgNames.get(m.orgId)}] ${m.name} (${m.productType}) — ${gap}`);
  }
  console.log(`\nBy org:`);
  for (const [id, n] of byOrg) console.log(`  ${orgNames.get(id)}: ${n}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
