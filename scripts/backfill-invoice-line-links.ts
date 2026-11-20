/**
 * Rebuilds the line-level shipment_invoice links for invoices made from shipments before those links were kept, so
 * they can be sent by EDI (810). DRY RUN by default; --commit applies. Only provable cases are rebuilt
 * (lib/inventory/invoice-link-backfill.ts); every other invoice is listed with the reason and left alone.
 *
 *   npx tsx scripts/backfill-invoice-line-links.ts [--env .env.production.vercel] [--commit]
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
  const { planLineLinks } = await import("../lib/inventory/invoice-link-backfill");
  console.log(formatIdentity(await dbIdentity(process.env.DATABASE_URL!)));
  const rows = (r: any) => (r.rows ?? r) as any[];

  // Invoices with a per-shipment link but no line-level link.
  const invs = rows(await db.execute(sql`
    select distinct l.org_id, l.to_id as entry_id
    from transaction_links l
    where l.relation = 'shipment_invoice' and l.to_type = 'Invoice' and l.from_line_id is null
      and not exists (select 1 from transaction_links x where x.org_id = l.org_id and x.to_id = l.to_id
                      and x.relation = 'shipment_invoice' and x.from_line_id is not null)`));
  console.log(`invoices made from shipments without line links: ${invs.length}`);
  let fixable = 0, left = 0;
  for (const i of invs) {
    const ships = rows(await db.execute(sql`select from_id from transaction_links where org_id = ${i.org_id} and to_id = ${i.entry_id} and relation = 'shipment_invoice' and from_line_id is null`)).map(r => r.from_id as string);
    const lines = rows(await db.execute(sql`select id, shipment_id, qty_base, invoiced_qty, sale_rate from shipment_lines where org_id = ${i.org_id} and shipment_id in (${sql.join(ships.map(s => sql`${s}`), sql`,`)})`));
    const other = rows(await db.execute(sql`select count(distinct to_id)::int as n from transaction_links where org_id = ${i.org_id} and relation = 'shipment_invoice' and from_id in (${sql.join(ships.map(s => sql`${s}`), sql`,`)}) and to_id <> ${i.entry_id}`))[0].n;
    const net = rows(await db.execute(sql`select amount from invoices where org_id = ${i.org_id} and journal_entry_id = ${i.entry_id} limit 1`))[0]?.amount;
    if (net == null) { left++; console.log(`  leave ${i.entry_id}: not in the receivables register`); continue; }
    const plan = planLineLinks({ invoiceNet: Number(net), otherInvoices: other,
      lines: lines.map(l => ({ id: l.id, shipmentId: l.shipment_id, qtyBase: Number(l.qty_base), invoicedQty: Number(l.invoiced_qty), saleRate: Number(l.sale_rate) })) });
    if (plan.ok === false) { left++; console.log(`  leave ${i.entry_id}: ${plan.reason}`); continue; }
    fixable++;
    if (!commit) continue;
    for (const k of plan.links) {
      await db.execute(sql`insert into transaction_links (org_id, from_type, from_id, from_line_id, to_type, to_id, relation, amount, qty, context_entry_id)
        values (${i.org_id}, 'Shipment', ${k.shipmentId}, ${k.lineId}, 'Invoice', ${i.entry_id}, 'shipment_invoice', ${k.amount}, ${k.qty}, ${i.entry_id})`);
    }
  }
  console.log(`\nrebuildable: ${fixable}; left alone: ${left}`);
  console.log(commit ? "Committed." : "Dry run. Re-run with --commit to apply.");
  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
