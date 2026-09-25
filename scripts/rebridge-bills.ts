/**
 * Mirror posted native bills that have no Payables (ap_bills) row.
 * Dry run by default; --commit writes. Idempotent.
 *
 *   npx tsx scripts/rebridge-bills.ts --env .env.production.vercel --org <orgId>
 *   npx tsx scripts/rebridge-bills.ts --env .env.production.vercel --org <orgId> --commit
 */
import { config as loadEnv } from "dotenv";
const argv = process.argv.slice(2);
const arg = (n: string) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
loadEnv({ path: arg("--env") ?? ".env.local", quiet: true });
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

(async () => {
  const org = arg("--org");
  if (!org) throw new Error("--org <orgId> is required");
  const { dbIdentity, formatIdentity } = await import("./db-identity");
  console.log(formatIdentity(await dbIdentity(process.env.DATABASE_URL!)));
  const { rebridgeNativeBills } = await import("../lib/accounting/documents");
  const commit = argv.includes("--commit");
  const res = await rebridgeNativeBills(org, { dryRun: !commit });
  console.log(commit ? "COMMIT" : "DRY RUN (nothing written)");
  for (const r of res) console.log(`  ${r.docNumber ?? "—"}: ${r.bridged ? "bridged" : r.reason ?? "would bridge"}`);
  if (!res.length) console.log("  nothing to bridge");
})().catch(e => { console.error(e); process.exit(1); });
