/**
 * Fills inventory_lots.supplier_sku_id for lots that were received against a PO line,
 * from that line's supplier SKU (goods_receipt_lines.lot_id -> po_line_id ->
 * trade_document_lines.supplier_sku_id). DRY RUN by default; --commit applies.
 * Lots with no PO link (counts, opening stock, production, no-PO receipts) stay NULL
 * on purpose: under a BOM SKU limit a lot with an unknown SKU is refused, and guessing
 * one here would make a limit lie.
 *
 *   npx tsx scripts/_backfill_lot_supplier_sku.ts [--env .env.production.vercel] [--commit]
 */
import { config as loadEnv } from "dotenv";
const argv = process.argv.slice(2);
const arg = (name: string) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; };
loadEnv({ path: arg("--env") ?? ".env.local", quiet: true });
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;
const commit = argv.includes("--commit");

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const { db } = await import("../db");
  const { sql } = await import("drizzle-orm");
  const { dbIdentity, formatIdentity } = await import("./db-identity");
  console.log(formatIdentity(await dbIdentity(process.env.DATABASE_URL!)));
  const rows = (r: any) => (r.rows ?? r) as any[];

  const total = rows(await db.execute(sql`select count(*)::int as n from inventory_lots`))[0].n;
  const have = rows(await db.execute(sql`select count(*)::int as n from inventory_lots where supplier_sku_id is not null`))[0].n;
  const fixable = rows(await db.execute(sql`
    select count(distinct l.id)::int as n
    from inventory_lots l
    join goods_receipt_lines g on g.lot_id = l.id
    join trade_document_lines t on t.id = g.po_line_id
    where l.supplier_sku_id is null and t.supplier_sku_id is not null`))[0].n;
  console.log(`lots: ${total}; already have a supplier SKU: ${have}; would be filled from their PO line: ${fixable}; stay unknown: ${total - have - fixable}`);

  if (!commit) { console.log("\nDry run. Re-run with --commit to apply."); process.exit(0); }
  await db.execute(sql`
    update inventory_lots l set supplier_sku_id = t.supplier_sku_id
    from goods_receipt_lines g join trade_document_lines t on t.id = g.po_line_id
    where g.lot_id = l.id and l.supplier_sku_id is null and t.supplier_sku_id is not null`);
  const after = rows(await db.execute(sql`select count(*)::int as n from inventory_lots where supplier_sku_id is not null`))[0].n;
  console.log(`Applied. Lots with a supplier SKU: ${after}.`);
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
