/**
 * Re-derive paid / balance / status of native bills in Payables (ap_bills) from the
 * payment and credit links applied to them. Repairs bills paid before
 * syncNativeBillPaid existed. Dry run by default; --commit writes. Idempotent.
 *
 *   npx tsx scripts/resync-native-bill-paid.ts --env .env.production.vercel --org-name "Test Organization"
 *   npx tsx scripts/resync-native-bill-paid.ts --env .env.production.vercel --org-name "Test Organization" --commit
 */
import { config as loadEnv } from "dotenv";
const argv = process.argv.slice(2);
const arg = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
loadEnv({ path: arg("--env") ?? ".env.local", quiet: true });
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

(async () => {
  const name = arg("--org-name");
  if (!name) throw new Error("--org-name <organisation name> is required (one organisation at a time)");
  const { db } = await import("../db");
  const { organisations, apBills } = await import("../db/schema");
  const { and, eq, isNotNull } = await import("drizzle-orm");
  const { dbIdentity, formatIdentity } = await import("./db-identity");
  console.log(formatIdentity(await dbIdentity(process.env.DATABASE_URL!)));
  const [org] = await db.select({ id: organisations.id, name: organisations.name }).from(organisations).where(eq(organisations.name, name)).limit(1);
  if (!org) throw new Error(`No organisation named "${name}"`);
  const { syncNativeBillPaid } = await import("../lib/accounting/documents");
  const commit = argv.includes("--commit");
  const bills = await db.select({ id: apBills.id, entryId: apBills.entryId, billNumber: apBills.billNumber, status: apBills.accountingPaymentStatus, balance: apBills.balance })
    .from(apBills).where(and(eq(apBills.orgId, org.id), eq(apBills.source, "native"), isNotNull(apBills.entryId)));
  console.log(`${commit ? "COMMIT" : "DRY RUN (nothing written)"} — ${org.name}: ${bills.length} native bills`);
  for (const b of bills) {
    if (commit) await syncNativeBillPaid(org.id, b.entryId!);
    const [after] = commit ? await db.select({ status: apBills.accountingPaymentStatus, balance: apBills.balance }).from(apBills).where(eq(apBills.id, b.id)) : [null];
    console.log(`  ${b.billNumber}: ${b.status} / ${b.balance}${after ? `  ->  ${after.status} / ${after.balance}` : ""}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
