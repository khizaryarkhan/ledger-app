/**
 * READ-ONLY. Lists every unit / pack-type value actually stored, so EDI unit
 * codes can be checked against real data before anything changes:
 *   - trade_document_lines.order_uom (by document kind)
 *   - ap_items.base_uom
 *   - item_skus inner/addl/outer pack types
 *   - item_supplier_skus supplier_uom and inner/outer pack types
 *
 *   npx tsx scripts/_scan_edi_unit_values.ts --env .env.production.vercel
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
  const rows = (r: any) => (r.rows ?? r) as any[];
  const show = async (label: string, q: any) => {
    const list = rows(await db.execute(q));
    console.log(`\n${label}:`);
    for (const x of list) console.log(`  ${JSON.stringify(x)}`);
  };
  await show("order_uom on trade document lines", sql`
    select d.kind, coalesce(l.order_uom, '(null)') as v, l.pack_level, count(*)::int as n
    from trade_document_lines l join trade_documents d on d.id = l.document_id
    group by d.kind, l.order_uom, l.pack_level order by d.kind, n desc`);
  await show("ap_items.base_uom", sql`
    select coalesce(base_uom, '(null)') as v, count(*)::int as n from ap_items group by base_uom order by n desc`);
  await show("item_skus pack types", sql`
    select 'inner' as lvl, inner_pack_type as v, count(*)::int as n from item_skus where inner_pack_type is not null group by inner_pack_type
    union all select 'addl', addl_inner_pack_type, count(*)::int from item_skus where addl_inner_pack_type is not null group by addl_inner_pack_type
    union all select 'outer', outer_pack_type, count(*)::int from item_skus where outer_pack_type is not null group by outer_pack_type
    order by 1, 3 desc`);
  await show("item_supplier_skus units and pack types", sql`
    select 'supplier_uom' as lvl, supplier_uom as v, count(*)::int as n from item_supplier_skus where supplier_uom is not null group by supplier_uom
    union all select 'inner', inner_pack_type, count(*)::int from item_supplier_skus where inner_pack_type is not null group by inner_pack_type
    union all select 'outer', outer_pack_type, count(*)::int from item_supplier_skus where outer_pack_type is not null group by outer_pack_type
    order by 1, 3 desc`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
