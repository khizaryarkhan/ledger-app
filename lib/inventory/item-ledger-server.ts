/**
 * Database half of the Item Ledger (rules and types in lib/inventory/item-ledger.ts). Read-only.
 *
 * Opening balances are summed in SQL so a long history is never loaded just to be added up; only the period's own
 * movements come back, capped so one request cannot be asked for the whole ledger of a busy item.
 */

import { db } from "@/db";
import { sql } from "drizzle-orm";
import { stockVsGl } from "@/lib/accounting/account-roles-server";
import { buildItemLedgers, type ItemLedger, type LedgerItem, type LedgerMovement, type Opening } from "@/lib/inventory/item-ledger";

/** Most movements returned for one request; beyond this the report says so rather than showing a partial balance as whole. */
export const ITEM_LEDGER_MAX_ROWS = 5000;

const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : (r?.rows ?? []));
const num = (v: any) => Number(v ?? 0);

export type ItemLedgerResult = {
  from: string | null; to: string;
  ledgers: ItemLedger[];
  /** True when the period holds more movements than were returned — balances shown are then not the full story. */
  truncated: boolean;
  /** Every item that has ever moved, for the picker. */
  itemOptions: { id: string; name: string }[];
  /** All stock at the end date against the inventory accounts of the books, org-wide whatever the item filter. */
  tie: { stockValue: number; glBalance: number; difference: number };
};

export async function loadItemLedger(orgId: string, opts: { from: string | null; to: string; itemId: string | null }): Promise<ItemLedgerResult> {
  const { from, to, itemId } = opts;
  const onItem = itemId ? sql`and m.item_id = ${itemId}` : sql``;

  const [openRows, moveRows, optionRows, tie] = await Promise.all([
    from ? db.execute(sql`
      select m.item_id as id, coalesce(sum(m.qty::numeric), 0) as q, coalesce(sum(m.total_cost::numeric), 0) as v
      from inventory_movements m
      where m.org_id = ${orgId} and m.movement_type <> 'transfer' and coalesce(m.movement_date, m.created_at::date) < ${from} ${onItem}
      group by m.item_id`) : Promise.resolve([]),
    db.execute(sql`
      select m.id, m.item_id, to_char(coalesce(m.movement_date, m.created_at::date), 'YYYY-MM-DD') as d, m.created_at,
             m.movement_type, m.qty, m.unit_cost, m.total_cost, l.lot_no, je.doc_number, je.source_type, m.entry_id
      from inventory_movements m
      left join inventory_lots l on l.id = m.lot_id
      left join journal_entries je on je.id = m.entry_id
      where m.org_id = ${orgId} and m.movement_type <> 'transfer'
        and coalesce(m.movement_date, m.created_at::date) <= ${to}
        ${from ? sql`and coalesce(m.movement_date, m.created_at::date) >= ${from}` : sql``} ${onItem}
      order by coalesce(m.movement_date, m.created_at::date), m.created_at
      limit ${ITEM_LEDGER_MAX_ROWS + 1}`),
    db.execute(sql`
      select distinct i.id, i.name from inventory_movements m join ap_items i on i.id = m.item_id
      where m.org_id = ${orgId} and m.movement_type <> 'transfer' order by i.name`),
    stockVsGl(orgId, to, { provision: false }),
  ]);

  const moves = rowsOf(moveRows);
  const truncated = moves.length > ITEM_LEDGER_MAX_ROWS;
  const movements: LedgerMovement[] = moves.slice(0, ITEM_LEDGER_MAX_ROWS).map(r => ({
    id: String(r.id), itemId: String(r.item_id), date: String(r.d), createdAt: new Date(r.created_at).toISOString(),
    movementType: String(r.movement_type), qty: num(r.qty), unitCost: r.unit_cost == null ? null : num(r.unit_cost), totalCost: num(r.total_cost),
    lotNo: r.lot_no ?? null, docNo: r.doc_number ?? null, docType: r.source_type ?? null, entryId: r.entry_id ? String(r.entry_id) : null,
  }));
  const opening = new Map<string, Opening>(rowsOf(openRows).map(r => [String(r.id), { qty: num(r.q), value: num(r.v) }]));

  const ids = [...new Set([...movements.map(m => m.itemId), ...opening.keys()])];
  const itemRows = ids.length
    ? rowsOf(await db.execute(sql`select id, name, base_uom from ap_items where org_id = ${orgId} and id in (${sql.join(ids.map(i => sql`${i}`), sql`, `)})`))
    : [];
  const items: LedgerItem[] = itemRows.map(r => ({ id: String(r.id), name: String(r.name), uom: r.base_uom ?? null }));

  const r2 = (n: number) => Math.round(n * 100) / 100;
  const stockValue = r2(tie.rows.reduce((s, r) => s + r.stockValue, 0));
  const glBalance = r2(tie.rows.reduce((s, r) => s + r.glBalance, 0));

  return {
    from, to,
    ledgers: buildItemLedgers(items, opening, movements),
    truncated,
    itemOptions: rowsOf(optionRows).map(r => ({ id: String(r.id), name: String(r.name) })),
    tie: { stockValue, glBalance, difference: r2(glBalance - stockValue) },
  };
}
