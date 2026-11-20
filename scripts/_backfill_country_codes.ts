/**
 * Proposes ISO 3166 country codes for records that hold only a country NAME
 * (migration 0139 added the code columns empty). DRY RUN by default: it reads
 * names and reports what each would get. --commit writes the codes, and only
 * where the code column is still empty, so it never overwrites a code someone
 * chose. Exact name / explicit alias matches only (lib/countries.ts); a name
 * that matches nothing is LISTED for a person to fix, never guessed.
 *
 *   npx tsx scripts/_backfill_country_codes.ts --env .env.production.vercel            (dry run)
 *   npx tsx scripts/_backfill_country_codes.ts --env .env.production.vercel --commit   (after 0139 is applied)
 *   --names-only  reads names without touching the new columns (works before 0139 is applied)
 */
import { config as loadEnv } from "dotenv";
const argv = process.argv.slice(2);
const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
const COMMIT = argv.includes("--commit");
const NAMES_ONLY = argv.includes("--names-only");
loadEnv({ path: arg("--env") ?? ".env.local", quiet: true });
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  if (COMMIT && NAMES_ONLY) throw new Error("--commit cannot be combined with --names-only");
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const { dbIdentity, formatIdentity } = await import("./db-identity");
  const { countryCodeFromName } = await import("../lib/countries");
  console.log(formatIdentity(await dbIdentity(process.env.DATABASE_URL!)));
  console.log(COMMIT ? "MODE: COMMIT (writes codes where the column is empty)\n" : "MODE: dry run (no writes)\n");
  const rows = (r: any) => (r.rows ?? r) as any[];
  const emptyCode = (col: string) => (NAMES_ONLY ? sql`true` : sql.raw(`${col} is null`));

  type Plan = { table: string; label: string; items: { id: string; name: string; code: string | null }[] };
  const plans: Plan[] = [];

  // The org's own country list first: a party picking from it gets this code.
  const list = rows(await db.execute(sql`select id, name from countries where ${emptyCode("iso_code")}`));
  plans.push({ table: "countries", label: "Org country lists", items: list.map(r => ({ id: r.id, name: r.name, code: countryCodeFromName(r.name) })) });

  const orgs = rows(await db.execute(sql`select id, address_country as name from organisations where address_country is not null and address_country <> '' and ${emptyCode("address_country_code")}`));
  plans.push({ table: "organisations", label: "Organisations", items: orgs.map(r => ({ id: r.id, name: r.name, code: countryCodeFromName(r.name) })) });

  // Parties: the org-list entry's name when one is linked, else the free-text name.
  const ps = rows(await db.execute(sql`
    select p.id, coalesce(nullif(c.name, ''), nullif(p.country, '')) as name
    from parties p left join countries c on c.id = p.country_id
    where coalesce(nullif(c.name, ''), nullif(p.country, '')) is not null and ${emptyCode("p.country_code")}`));
  plans.push({ table: "parties", label: "Customers and suppliers", items: ps.map(r => ({ id: r.id, name: r.name, code: countryCodeFromName(r.name) })) });

  for (const p of plans) {
    const matched = p.items.filter(i => i.code);
    const unmatched = p.items.filter(i => !i.code);
    console.log(`${p.label}: ${p.items.length} with a name, ${matched.length} matched, ${unmatched.length} not matched`);
    const byName = new Map<string, number>();
    for (const u of unmatched) byName.set(u.name, (byName.get(u.name) ?? 0) + 1);
    for (const [n, c] of byName) console.log(`   not matched: "${n}" x${c}`);
    if (COMMIT) {
      const col = p.table === "countries" ? "iso_code" : p.table === "organisations" ? "address_country_code" : "country_code";
      for (const m of matched) {
        await db.execute(sql`update ${sql.raw(p.table)} set ${sql.raw(col)} = ${m.code} where id = ${m.id} and ${sql.raw(col)} is null`);
      }
      console.log(`   wrote ${matched.length}`);
    }
  }
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
