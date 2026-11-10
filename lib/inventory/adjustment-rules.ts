/**
 * Pure rules for stock counts (no db import, so they can be unit-tested).
 *
 * OPENING STOCK is the stock a company already holds on the day it starts
 * keeping its books here. It is not a count gain: a gain credits Inventory
 * adjustments, a cost-of-sales account, which would overstate the first
 * period's margin by the whole value of the opening stock. Opening stock
 * credits Opening Balance Equity instead, like every other opening balance.
 */

export type CountShape = {
  opening?: boolean;
  lines?: { lotId: string; countedQty: number }[];
  found?: { itemId: string; qty: number; unitCost: number }[];
};

/** Which account the stock side of a count posts against. */
export type CountContra = "OPENING_EQUITY" | "INVENTORY_ADJUSTMENT";
export const countContra = (opening?: boolean): CountContra => (opening ? "OPENING_EQUITY" : "INVENTORY_ADJUSTMENT");

/**
 * null when the count may be posted as opening stock, else why not. Opening
 * stock is new stock only: an existing lot already has a history (a receipt, a
 * build), so changing it is a count difference, never an opening balance.
 */
export function openingCountError(input: CountShape): string | null {
  if (!input.opening) return null;
  if ((input.lines ?? []).length) return "Opening stock is entered as new stock only. Count existing lots in a separate count.";
  const found = (input.found ?? []).filter(f => f?.itemId && Number(f.qty) > 0);
  if (!found.length) return "Enter the quantity and unit cost of the opening stock.";
  if (found.some(f => !(Number(f.unitCost) > 0))) return "Opening stock needs a unit cost above zero: it is the value the stock is carried at.";
  return null;
}
