/**
 * Ingest a QBO company's transactions into our own general ledger, and prove
 * the result against QuickBooks' own TrialBalance.
 *
 * SHADOW ONLY. This writes journal_entries/journal_lines and nothing else — no
 * mirror table is touched, and nothing in the app reads these entries yet. A
 * paying client's AR management is unaffected whether this runs or not.
 *
 * ⚠️  RUN THIS AGAINST A NEON BRANCH FIRST, NOT PRODUCTION.
 *     Create a branch of the production database, point DATABASE_URL at it, and
 *     run there until --verify comes back clean. The QBO side is read-only
 *     either way (we only ever query), so the only thing at risk is our own
 *     ledger — and on a branch, nothing.
 *
 * Usage:
 *   DATABASE_URL="<neon-branch-url>" npx tsx scripts/qbo-gl-ingest.ts --org <uuid> --dry-run
 *   DATABASE_URL="<neon-branch-url>" npx tsx scripts/qbo-gl-ingest.ts --org <uuid> --from 2026-01-01
 *   DATABASE_URL="<neon-branch-url>" npx tsx scripts/qbo-gl-ingest.ts --org <uuid> --verify
 *
 * Flags:
 *   --org <uuid>         required
 *   --from <YYYY-MM-DD>  only transactions on or after this date (default: all history)
 *   --only <A,B,C>       restrict to these QBO entities
 *   --dry-run            map and validate everything, write nothing
 *   --verify             after ingesting, diff our trial balance against QBO's
 *   --verify-only        skip ingestion, just run the comparison
 *   --as-of <YYYY-MM-DD> the date to compare trial balances at (default: today)
 *
 * Exit code is 1 when anything failed to map or the trial balances disagree, so
 * this can gate the decision to move any read path onto the GL.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null;
};
const flag = (name: string) => process.argv.includes(`--${name}`);
const money = (n: number) => (n < 0 ? "-" : " ") + Math.abs(n).toFixed(2).padStart(12);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const orgId = arg("org");
  if (!orgId) throw new Error("--org <uuid> is required");

  const from = arg("from");
  const only = arg("only")?.split(",").map(s => s.trim()).filter(Boolean);
  const dryRun = flag("dry-run");
  const asOf = arg("as-of") ?? new Date().toISOString().slice(0, 10);

  // Imported after env is loaded — @/db reads DATABASE_URL at module load.
  const { ingestOrgTransactions } = await import("../lib/accounting/qbo-ingest");
  const { compareTrialBalance } = await import("../lib/accounting/qbo-gl-verify");

  let failed = 0;

  if (!flag("verify-only")) {
    console.log(`\n── Ingesting QBO → GL ──────────────────────────────────────`);
    console.log(`org        ${orgId}`);
    console.log(`from       ${from ?? "(all history)"}`);
    console.log(`mode       ${dryRun ? "DRY RUN — nothing will be written" : "WRITING to journal_entries"}`);
    if (only) console.log(`entities   ${only.join(", ")}`);

    const t0 = Date.now();
    const report = await ingestOrgTransactions(orgId, { from, dryRun, only });

    console.log(`\nchart of accounts: ${report.coverage.mapped}/${report.coverage.total} carry a QBO id`);
    if (report.coverage.mapped === 0) {
      console.log(`⚠️  NOTHING in this org's chart of accounts maps to QBO. Every line will`);
      console.log(`   land in Suspense. Run the COA sync before reading anything into this.`);
    }

    console.log(`\n${"entity".padEnd(15)}${"scanned".padStart(9)}${"posted".padStart(9)}${"replaced".padStart(10)}${"skipped".padStart(9)}${"failed".padStart(8)}`);
    for (const e of report.entities) {
      if (e.scanned === 0) continue;
      console.log(`${e.entity.padEnd(15)}${String(e.scanned).padStart(9)}${String(e.posted).padStart(9)}${String(e.replaced).padStart(10)}${String(e.skipped).padStart(9)}${String(e.failed).padStart(8)}`);
    }
    const t = report.totals;
    console.log(`${"TOTAL".padEnd(15)}${String(t.scanned).padStart(9)}${String(t.posted).padStart(9)}${String(t.replaced).padStart(10)}${String(t.skipped).padStart(9)}${String(t.failed).padStart(8)}`);
    console.log(`\ntook ${((Date.now() - t0) / 1000).toFixed(1)}s`);

    // Unmapped accounts are the single most useful diagnostic here: they are
    // why a trial balance would come out wrong, and they name the exact QBO
    // account to go and look at.
    const unmapped: Record<string, number> = {};
    for (const e of report.entities) for (const [k, v] of Object.entries(e.unmapped)) unmapped[k] = (unmapped[k] ?? 0) + v;
    const unmappedKeys = Object.keys(unmapped);
    if (unmappedKeys.length) {
      console.log(`\n⚠️  ${unmappedKeys.length} QBO account(s) could not be resolved — those lines went to Suspense:`);
      for (const k of unmappedKeys.sort((a, b) => unmapped[b] - unmapped[a]).slice(0, 20)) {
        console.log(`   QBO account ${k.padEnd(24)} ${unmapped[k]} line(s)`);
      }
    }

    if (t.failed > 0) {
      failed = 1;
      console.log(`\n❌ ${t.failed} transaction(s) failed to map:`);
      for (const e of report.entities) {
        for (const err of e.errors.slice(0, 10)) console.log(`   ${e.entity} ${err.id}: ${err.reason}`);
        if (e.errors.length > 10) console.log(`   …and ${e.errors.length - 10} more ${e.entity} failures`);
      }
    }
  }

  if (flag("verify") || flag("verify-only")) {
    console.log(`\n── Trial balance: ours vs QuickBooks, as at ${asOf} ─────────`);
    const cmp = await compareTrialBalance(orgId, asOf);
    console.log(`accounts agreeing: ${cmp.matched}`);
    console.log(`QBO total ${money(cmp.qboTotal)}   ours ${money(cmp.ourTotal)}`);

    if (cmp.clean) {
      console.log(`\n✅ Every account agrees. Our ledger reproduces QuickBooks' books.`);
    } else {
      failed = 1;
      console.log(`\n❌ ${cmp.rows.length} account(s) disagree (largest first):\n`);
      console.log(`${"account".padEnd(38)}${"QBO".padStart(13)}${"ours".padStart(14)}${"diff".padStart(14)}  note`);
      for (const r of cmp.rows.slice(0, 40)) {
        console.log(`${r.name.slice(0, 36).padEnd(38)}${money(r.qbo)}${money(r.ours)}${money(r.diff)}  ${r.note ?? ""}`);
      }
      if (cmp.rows.length > 40) console.log(`…and ${cmp.rows.length - 40} more`);
      console.log(`\nA "Suspense (Unmapped)" row means lines could not be mapped to an account.`);
      console.log(`"missing-in-ours" means QBO has a balance we posted nothing for — usually a`);
      console.log(`transaction type not yet ingested, or one that failed to map above.`);
    }
  }

  process.exit(failed);
}

main().catch(e => { console.error(e); process.exit(1); });
