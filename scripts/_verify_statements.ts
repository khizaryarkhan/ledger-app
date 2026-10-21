/**
 * READ-ONLY: actually run profitAndLoss / balanceSheet / cashFlow for every
 * real org and report whether they're correct, not just unit-tested in
 * isolation. Checks:
 *   - balanceSheet().balanced (Assets === Equity + Liabilities)
 *   - cashFlow().reconciles (computed net change === actual Bank movement)
 *   - whether an unrecognized account type logs a warning for any real account
 *
 * Usage: npx tsx scripts/_verify_statements.ts --env .env.production.vercel
 */
import { config as loadEnv } from "dotenv";

const envArg = process.argv.includes("--env") ? process.argv[process.argv.indexOf("--env") + 1] : ".env.local";
loadEnv({ path: envArg, quiet: true });

async function main() {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!url) throw new Error(`No DATABASE_URL(_UNPOOLED) found in ${envArg}`);
  process.env.DATABASE_URL = url;

  const { db } = await import("../db");
  const { organisations } = await import("../db/schema");
  const { profitAndLoss, balanceSheet } = await import("../lib/accounting/financials");
  const { cashFlow } = await import("../lib/accounting/analysis");

  const host = url.replace(/\/\/[^@]*@/, "//***@").split("/")[2];
  console.log(`database: ${host}\n`);

  const orgs = await db.select({ id: organisations.id, name: organisations.name }).from(organisations);
  const today = new Date().toISOString().slice(0, 10);
  const yearStart = `${today.slice(0, 4)}-01-01`;

  let loggedAnything = false;
  const origError = console.error;
  console.error = (...args: any[]) => { loggedAnything = true; origError("  [LOGGED]", ...args); };

  let failures = 0;
  for (const org of orgs) {
    const [pl, bs, cf] = await Promise.all([
      profitAndLoss([org.id], yearStart, today).catch((e: any) => ({ error: String(e) })),
      balanceSheet([org.id], today).catch((e: any) => ({ error: String(e) })),
      cashFlow(org.id, yearStart, today).catch((e: any) => ({ error: String(e) })),
    ]);
    const plOk = !("error" in pl);
    const bsOk = !("error" in bs) && (bs as any).balanced;
    const cfOk = !("error" in cf) && (cf as any).reconciles;
    const line = `[${org.name}] P&L: ${plOk ? "ok" : "FAILED"} - Balance Sheet: ${bsOk ? "balanced" : "NOT BALANCED"} - Cash Flow: ${cfOk ? "reconciles" : "DOES NOT RECONCILE"}`;
    console.log(line);
    if ("error" in bs) console.log(`    Balance Sheet error: ${(bs as any).error}`);
    if ("error" in cf) console.log(`    Cash Flow error: ${(cf as any).error}`);
    if (!bsOk && !("error" in bs)) console.log(`    Assets ${(bs as any).assets?.total} vs Equity+Liabilities ${(bs as any).totalEquityAndLiabilities}`);
    if (!cfOk && !("error" in cf)) console.log(`    Net change ${(cf as any).netChange} vs actual cash movement ${(cf as any).closingCash - (cf as any).openingCash}`);
    if (!plOk || !bsOk || !cfOk) failures++;
  }
  console.error = origError;

  console.log(`\n${orgs.length} orgs checked, ${failures} with a statement problem.`);
  console.log(loggedAnything ? "\nAt least one account logged an unrecognized type - see [LOGGED] lines above." : "\nNo unrecognized-type warnings fired for any real account.");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
