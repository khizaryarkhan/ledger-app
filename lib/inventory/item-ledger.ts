/**
 * Item Ledger (the stock card): for each item, what came in and went out in a period, with the running quantity
 * and value. The General Ledger cannot show this — it posts one line per account per document, so several items
 * share a line and it carries no quantity. The item-level truth is `inventory_movements`, one row per item per
 * movement; this reads it the way a ledger reads.
 *
 * Pure (no db), so the rules are testable. The loader is lib/inventory/item-ledger-server.ts.
 *
 * Same inclusion rule as Stock vs GL (`stockValueByItem`): transfers are left out. A transfer changes WHERE stock
 * is, never how much or what it cost, so it has no place in a quantity-and-value ledger.
 */

export type LedgerMovement = {
  id: string; itemId: string;
  /** YYYY-MM-DD — the movement's own date, falling back to the day it was recorded. */
  date: string; createdAt: string;
  movementType: string;
  /** Signed: + into stock, - out. */
  qty: number; unitCost: number | null; totalCost: number;
  lotNo: string | null; docNo: string | null; docType: string | null;
  /** The journal entry this movement posted. null with a value = it never reached the ledger; null at zero value = nothing to post. */
  entryId: string | null;
};
export type LedgerItem = { id: string; name: string; uom: string | null };
export type Opening = { qty: number; value: number };

export type LedgerLine = LedgerMovement & { label: string; qtyIn: number; qtyOut: number; balanceQty: number; balanceValue: number };
export type ItemLedger = {
  item: LedgerItem;
  openingQty: number; openingValue: number;
  lines: LedgerLine[];
  inQty: number; outQty: number; inValue: number; outValue: number;
  closingQty: number; closingValue: number;
  /** Lines that moved stock with no ledger entry behind them. */
  unposted: number;
};

export const MOVEMENT_LABEL: Record<string, string> = {
  receipt: "Receipt", issue_sale: "Sale", issue_production: "Used in production", produce: "Produced",
  adjustment: "Adjustment", transfer: "Transfer",
};
export const movementLabel = (t: string) => MOVEMENT_LABEL[t] ?? t;

const r6 = (n: number) => Math.round((n + Number.EPSILON) * 1e6) / 1e6;
const r4 = (n: number) => Math.round((n + Number.EPSILON) * 1e4) / 1e4;

/**
 * One ledger per item that has an opening balance or a movement in the period, ordered by name. `opening` is what
 * each item held before the period (movements dated earlier), `movements` are those inside it. Order within an item
 * is by date, then by when it was recorded, so same-day entries read in the order they happened.
 */
export function buildItemLedgers(items: LedgerItem[], opening: Map<string, Opening>, movements: LedgerMovement[]): ItemLedger[] {
  const byItem = new Map<string, LedgerMovement[]>();
  for (const m of movements) {
    if (m.movementType === "transfer") continue;
    const list = byItem.get(m.itemId) ?? []; list.push(m); byItem.set(m.itemId, list);
  }
  const out: ItemLedger[] = [];
  for (const item of items) {
    const op = opening.get(item.id) ?? { qty: 0, value: 0 };
    const ms = (byItem.get(item.id) ?? []).slice().sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.localeCompare(b.createdAt));
    if (ms.length === 0 && Math.abs(op.qty) < 1e-9 && Math.abs(op.value) < 1e-9) continue;
    let q = op.qty, v = op.value, inQty = 0, outQty = 0, inValue = 0, outValue = 0, unposted = 0;
    const lines: LedgerLine[] = ms.map(m => {
      q = r6(q + m.qty); v = r4(v + m.totalCost);
      if (m.qty >= 0) { inQty = r6(inQty + m.qty); inValue = r4(inValue + m.totalCost); } else { outQty = r6(outQty + -m.qty); outValue = r4(outValue + -m.totalCost); }
      // Only stock that CARRIES value can be missing from the books; a zero-value receipt has nothing to post.
      if (!m.entryId && Math.abs(m.totalCost) > 0.005) unposted++;
      return { ...m, label: movementLabel(m.movementType), qtyIn: m.qty >= 0 ? m.qty : 0, qtyOut: m.qty < 0 ? -m.qty : 0, balanceQty: q, balanceValue: v };
    });
    out.push({ item, openingQty: r6(op.qty), openingValue: r4(op.value), lines, inQty, outQty, inValue, outValue, closingQty: q, closingValue: v, unposted });
  }
  return out.sort((a, b) => a.item.name.localeCompare(b.item.name));
}

/** Closing value over every item shown — what the footer compares with the books. */
export function totalClosingValue(ledgers: ItemLedger[]): number {
  return r4(ledgers.reduce((s, l) => s + l.closingValue, 0));
}
