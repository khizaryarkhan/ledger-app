/**
 * One-off backfill: the system-seeded "Scrap & offcuts" item predates the
 * canBePurchased: false fix in ensureScrapItem (account-roles-server.ts). It's
 * sell-only by design (nobody buys scrap), so this sets canBePurchased: false
 * on the exact row(s) matching that seeded shape — never touches a item a user
 * renamed or genuinely made purchasable themselves (those have an
 * expenseAccountId already, or aren't NonInventory, and are excluded by the
 * where clause).
 *
 * Dry run by default; --commit applies it.
 *
 * Usage:
 *   npx tsx scripts/_backfill_scrap_item_flags.ts --env .env.production.vercel
 *   npx tsx scripts/_backfill_scrap_item_flags.ts --env .env.production.vercel --commit
 */
import { config as loadEnv } from "dotenv";

const envArg = process.argv.includes("--env")
  ? process.argv[process.argv.indexOf("--env") + 1]
  : ".env.local";
const commit = process.argv.includes("--commit");
loadEnv({ path: envArg, quiet: true });

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error(`No DATABASE_URL(_UNPOOLED) found in ${envArg}`);
  process.env.DATABASE_URL = url;

  const { db } = await import("../db");
  const { apItems, organisations } = await import("../db/schema");
  const { eq, and, sql, isNull } = await import("drizzle-orm");

  const host = url.replace(/\/\/[^@]*@/, "//***@").split("/")[2];
  console.log(`database: ${host}`);
  console.log(commit ? "mode: COMMIT (will write)\n" : "mode: dry run (no writes)\n");

  const rows = await db.select({ id: apItems.id, orgId: apItems.orgId, name: apItems.name, canBePurchased: apItems.canBePurchased })
    .from(apItems)
    .where(and(
      sql`lower(trim(${apItems.name})) = 'scrap & offcuts'`,
      eq(apItems.productType, "NonInventory"),
      isNull(apItems.expenseAccountId),
    ));

  const toFix = rows.filter(r => r.canBePurchased !== false);
  if (!toFix.length) { console.log("Nothing to fix."); return; }

  for (const r of toFix) {
    const [o] = await db.select({ name: organisations.name }).from(organisations).where(eq(organisations.id, r.orgId)).limit(1);
    console.log(`  [${o?.name ?? r.orgId}] ${r.id}: canBePurchased ${r.canBePurchased} -> false`);
  }

  if (!commit) { console.log("\nDry run only — re-run with --commit to apply."); return; }

  for (const r of toFix) await db.update(apItems).set({ canBePurchased: false }).where(eq(apItems.id, r.id));
  console.log(`\nUpdated ${toFix.length} row(s).`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
