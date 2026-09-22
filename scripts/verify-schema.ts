/**
 * Prove a database actually matches db/schema.ts — don't assume the migrations
 * "went well" because they printed ✓.
 *
 * Usage:
 *   npm run db:verify                                    # DATABASE_URL from .env.local
 *   DATABASE_URL="<url>" npm run db:verify               # a Neon branch, or production
 *   npm run db:verify -- --env .env.production.vercel    # read the URL from another env file
 *
 * WHY THIS EXISTS. CLAUDE.md records two ways this repo has been bitten, and a
 * green migration run detects neither:
 *
 *   1. A column exists in schema.ts and the app writes to it, but no migration
 *      ever created it — applied by hand or `drizzle-kit push` against a live
 *      database. Invisible until someone migrates a FRESH one. That is exactly
 *      how 0066/0067 were found, and `0018_invoice_escalation.sql` still sits on
 *      disk having never run.
 *   2. A column is NARROWER than the code believes, so writes are silently
 *      truncated — quantities stored at scale 4 while the app renders 5
 *      decimals (migration 0088). Nothing errors; the number is just wrong.
 *
 * Neither shows up in `tsc`, and neither shows up in the unit suite, which by
 * design never touches a database. This script is the missing check: it walks
 * every table and column drizzle declares and asks the database whether it
 * really has them, at the right width, with the right nullability.
 *
 * It only READS — information_schema and the drizzle journal. It is safe to
 * point at production, and pointing it at production is the entire idea.
 */

import { config as loadEnv } from "dotenv";
import { readFileSync } from "fs";

const argv = process.argv.slice(2);
const envArg = argv.indexOf("--env");
loadEnv({ path: envArg >= 0 ? argv[envArg + 1] : ".env.local", quiet: true });

import { neon } from "@neondatabase/serverless";
import { getTableConfig } from "drizzle-orm/pg-core";
import { isTable } from "drizzle-orm";
import * as schema from "@/db/schema";
import { dbIdentity, formatIdentity } from "./db-identity";

// Vercel-pulled env files leave DATABASE_URL empty and put the real string in
// DATABASE_URL_UNPOOLED, so fall through rather than reporting "not set".
const URL_ = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
if (!URL_) { console.error("DATABASE_URL is not set."); process.exit(1); }
const sql = neon(URL_);

/**
 * Migrations drizzle will never apply, and must not be "fixed" into the
 * journal. 0016/0017 carry `when` values older than 0015 so the migrator skips
 * them; 0085_heal_skipped_0016_0017 already applied their effect by hand.
 * Adding them back would re-run bare ADD COLUMNs against a database that has
 * those columns and break every future deploy, because migrations run inside
 * vercel-build. CLAUDE.md spells this out; it is repeated here because this is
 * the script that would otherwise appear to demand it.
 */
const GRANDFATHERED = new Set(["0016_contacts_updated_at", "0017_communications_message_id"]);

const errors: string[] = [];
const warns: string[] = [];
const err = (m: string) => errors.push(m);
const warn = (m: string) => warns.push(m);

/**
 * Postgres and drizzle spell the same type differently. These pairs are
 * genuinely identical, so treating them as drift would bury the real findings
 * under hundreds of lines of noise — and a check nobody reads is not a check.
 * `timestamp with time zone` is deliberately NOT normalised onto `timestamp`:
 * those two really do behave differently.
 */
const TYPE_ALIASES: Record<string, string> = {
  "timestamp without time zone": "timestamp",
  "character varying": "varchar",
  "double precision": "double precision",
  int4: "integer",
  int8: "bigint",
  bool: "boolean",
  "bit varying": "varbit",
};
const normType = (t: string) => TYPE_ALIASES[t] ?? t;

/** drizzle's SQL type → { base, precision, scale, length } */
function parseType(t: string) {
  const m = /^([a-z0-9_ ]+?)\s*(?:\(([^)]*)\))?$/i.exec(t.trim());
  const base = normType((m?.[1] ?? t).trim().toLowerCase());
  const args = (m?.[2] ?? "").split(",").map(s => s.trim()).filter(Boolean);
  if (base.startsWith("numeric") || base.startsWith("decimal")) {
    return { base: "numeric", precision: Number(args[0]) || null, scale: Number(args[1]) || 0, length: null as number | null };
  }
  if (base.startsWith("varchar") || base.startsWith("character varying")) {
    return { base: "varchar", precision: null, scale: null, length: Number(args[0]) || null };
  }
  return { base, precision: null, scale: null, length: null as number | null };
}

/** Postgres information_schema row → the same shape, so the two can be compared. */
function pgType(row: any) {
  const d = normType(String(row.data_type).toLowerCase());
  if (d === "numeric") return { base: "numeric", precision: row.numeric_precision, scale: row.numeric_scale ?? 0, length: null };
  if (d === "character varying") return { base: "varchar", precision: null, scale: null, length: row.character_maximum_length };
  return { base: d, precision: null, scale: null, length: null };
}

async function main() {
  // Say plainly WHICH database this is before reporting anything about it. A
  // verification report with no subject is how two branches of one project got
  // mistaken for each other repeatedly.
  console.log(formatIdentity(await dbIdentity(URL_!)) + "\n");

  // ── 1. Migrations: journal vs what the database says it has applied ────────
  const appliedRows = await sql`select created_at from drizzle.__drizzle_migrations order by created_at`;
  const applied = new Set(appliedRows.map((r: any) => Number(r.created_at)));
  const journal = JSON.parse(readFileSync("db/migrations/meta/_journal.json", "utf8"));
  const pending = journal.entries.filter((e: any) => !applied.has(e.when));
  const realPending = pending.filter((e: any) => !GRANDFATHERED.has(e.tag));

  console.log(`MIGRATIONS  ${applied.size}/${journal.entries.length} applied`);
  for (const e of pending) {
    const ok = GRANDFATHERED.has(e.tag);
    console.log(`  ${ok ? "skipped (expected)" : "PENDING"}  ${e.tag}`);
  }
  if (realPending.length) err(`${realPending.length} migration(s) not applied: ${realPending.map((e: any) => e.tag).join(", ")}`);

  // ── 2. Every table & column drizzle declares must really exist ─────────────
  // Several exports can point at the same pgTable (a table plus its aliases),
  // which would otherwise report every finding two or three times over.
  const tables = [...new Map((Object.values(schema).filter(isTable) as any[])
    .map(t => [getTableConfig(t).name, t])).values()];
  const cols = await sql`
    select table_name, column_name, data_type, is_nullable,
           numeric_precision, numeric_scale, character_maximum_length
    from information_schema.columns where table_schema = 'public'`;
  const viewRows = await sql`select table_name from information_schema.tables where table_schema='public' and table_type='VIEW'`;
  const views = new Set((viewRows as any[]).map(r => r.table_name));

  const byTable = new Map<string, Map<string, any>>();
  for (const c of cols as any[]) {
    if (!byTable.has(c.table_name)) byTable.set(c.table_name, new Map());
    byTable.get(c.table_name)!.set(c.column_name, c);
  }

  let checkedCols = 0;
  for (const t of tables) {
    const cfg = getTableConfig(t);
    const live = byTable.get(cfg.name);
    if (!live) { err(`table "${cfg.name}" is declared in schema.ts but does not exist`); continue; }
    const isView = views.has(cfg.name);

    for (const col of cfg.columns) {
      checkedCols++;
      const lc = live.get(col.name);
      if (!lc) { err(`${cfg.name}.${col.name} is declared in schema.ts but does not exist`); continue; }

      // Nullability — only the dangerous direction is an error. schema.ts
      // saying NOT NULL while the database allows nulls means the app assumes a
      // value that may not be there.
      // Skipped for views: `customers` and `ap_suppliers` are compatibility
      // VIEWS over `parties` (migration 0079), and Postgres reports EVERY view
      // column as nullable no matter what the underlying table enforces. Their
      // constraints live on parties, which is checked on its own.
      const dbNullable = lc.is_nullable === "YES";
      if (!isView) {
        if (col.notNull && dbNullable) err(`${cfg.name}.${col.name} is NOT NULL in schema.ts but nullable in the database`);
        if (!col.notNull && !dbNullable) warn(`${cfg.name}.${col.name} is nullable in schema.ts but NOT NULL in the database`);
      }

      const want = parseType(col.getSQLType());
      const got = pgType(lc);
      if (want.base !== got.base) {
        warn(`${cfg.name}.${col.name} type ${col.getSQLType()} vs database ${lc.data_type}`);
        continue;
      }
      // A column narrower than the code believes silently truncates on write —
      // the 0088 class of defect, and the one that produces wrong numbers
      // rather than errors.
      if (want.base === "numeric" && want.scale != null && got.scale != null && got.scale < want.scale) {
        err(`${cfg.name}.${col.name} scale ${got.scale} is NARROWER than schema.ts's ${want.scale} — writes are silently truncated`);
      }
      if (want.base === "numeric" && want.precision && got.precision && got.precision < want.precision) {
        err(`${cfg.name}.${col.name} precision ${got.precision} is narrower than schema.ts's ${want.precision}`);
      }
      if (want.base === "varchar" && want.length && got.length && got.length < want.length) {
        err(`${cfg.name}.${col.name} varchar(${got.length}) is shorter than schema.ts's varchar(${want.length})`);
      }
    }
  }
  console.log(`\nSCHEMA      ${tables.length} tables, ${checkedCols} columns checked against the database`);

  // ── 3. Report only the failures; a clean run should be quiet ───────────────
  if (warns.length) {
    console.log(`\nWARNINGS (${warns.length}) — differences that are not, by themselves, unsafe:`);
    for (const w of warns) console.log(`  · ${w}`);
  }
  if (errors.length) {
    console.log(`\nFAILURES (${errors.length}):`);
    for (const e of errors) console.log(`  ✗ ${e}`);
    console.log("\n✗ This database does not match db/schema.ts.");
    process.exit(1);
  }
  console.log(`\n✓ Database matches db/schema.ts${warns.length ? ` (${warns.length} warning(s) above)` : ""}.`);
}

main().catch(e => { console.error("verify failed:", e.message); process.exit(1); });
