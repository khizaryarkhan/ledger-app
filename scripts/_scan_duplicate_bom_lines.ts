/**
 * READ-ONLY. Finds BOM lines that the 0134 unique indexes would reject:
 *   - the same output SKU (or base-unit output) twice in one BOM
 *   - the same ingredient item twice in one BOM
 *   - the same packaging item twice for the same pack in one BOM
 * Run it before shipping the indexes; a migration that fails breaks vercel-build.
 *
 *   npx tsx scripts/_scan_duplicate_bom_lines.ts --env .env.production.vercel
 */
import { config as loadEnv } from "dotenv";
const argv = process.argv.slice(2);
const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
loadEnv({ path: arg("--env") ?? ".env.local", quiet: true });
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const { dbIdentity, formatIdentity } = await import("./db-identity");
  console.log(formatIdentity(await dbIdentity(process.env.DATABASE_URL!)));

  const outputs: any = await db.execute(sql`
    select l.bom_id, b.code, b.name, coalesce(l.sku_id::text, '(base unit)') as k, count(*)::int as n
    from bom_lines l join boms b on b.id = l.bom_id
    where l.role = 'output' group by l.bom_id, b.code, b.name, l.sku_id having count(*) > 1`);
  const inputs: any = await db.execute(sql`
    select l.bom_id, b.code, b.name, l.item_id::text as k, count(*)::int as n
    from bom_lines l join boms b on b.id = l.bom_id
    where l.role = 'input' group by l.bom_id, b.code, b.name, l.item_id having count(*) > 1`);
  const packs: any = await db.execute(sql`
    select l.bom_id, b.code, b.name, l.item_id::text || ' for ' || coalesce(l.packaging_for_sku_id::text, '(base)') as k, count(*)::int as n
    from bom_lines l join boms b on b.id = l.bom_id
    where l.role = 'pack' group by l.bom_id, b.code, b.name, l.item_id, l.packaging_for_sku_id having count(*) > 1`);

  const rows = (r: any) => (r.rows ?? r) as any[];
  for (const [label, r] of [["Duplicate outputs", outputs], ["Duplicate ingredients", inputs], ["Duplicate packaging", packs]] as const) {
    const list = rows(r);
    console.log(`\n${label}: ${list.length}`);
    for (const x of list) console.log(`  ${x.code || x.bom_id}  (${x.name})  key=${x.k}  x${x.n}`);
  }
  const total = rows(outputs).length + rows(inputs).length + rows(packs).length;
  console.log(total === 0 ? "\nSafe: the unique indexes can be added." : `\n${total} duplicate group(s). Resolve before adding the indexes.`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
