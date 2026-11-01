/**
 * Reorder suggestions — pure rules, no db, client-safe.
 *
 * available = onHand + expected - committed        (same as Stock Status)
 * shortfall = minOh - available                    (> 0 means the item needs stock)
 *
 * The suggested order quantity covers the shortfall and is never below the
 * preferred supplier's minimum order quantity. All quantities are BASE UoM;
 * a supplier's MOQ and price are quoted per supplier UoM and are converted
 * through `conversionFactor` (base units per one supplier UoM).
 */

import { roundQty, round2, round6, QTY_EPSILON } from "./round";

export type ReorderUrgency = "stocked_out" | "below_min" | "ok";

export type ReorderSupplierInfo = {
  supplierId: string;
  supplierName: string;
  currency: string | null;
  /** Per ONE supplier UoM. */
  minOrderQty: number | null;
  /** Per ONE supplier UoM. */
  unitPrice: number | null;
  /** Base UoM per one supplier UoM; null/0 is read as 1. */
  conversionFactor: number | null;
  /** Item-link lead time, falling back to the supplier's default. */
  leadTimeDays: number | null;
};

export type ReorderInput = {
  onHand: number;
  expected: number;
  committed: number;
  minOh: number;
  supplier: ReorderSupplierInfo | null;
};

export type ReorderResult = {
  available: number;
  shortfall: number;
  suggestedQty: number;
  /** MOQ in base units, null when the supplier states none. */
  moqBase: number | null;
  /** Cost per base unit, null when no price is known. */
  unitCostBase: number | null;
  estimatedCost: number | null;
  urgency: ReorderUrgency;
  needsReorder: boolean;
};

const factorOf = (s: ReorderSupplierInfo) => (s.conversionFactor && s.conversionFactor > 0 ? s.conversionFactor : 1);

export function computeReorder(input: ReorderInput): ReorderResult {
  const onHand = Number(input.onHand) || 0;
  const expected = Number(input.expected) || 0;
  const committed = Number(input.committed) || 0;
  const minOh = Number(input.minOh) || 0;

  const available = roundQty(onHand + expected - committed);
  const shortfall = roundQty(minOh - available);
  const needsReorder = shortfall > QTY_EPSILON;

  const urgency: ReorderUrgency = !needsReorder ? "ok" : onHand <= QTY_EPSILON ? "stocked_out" : "below_min";

  const s = input.supplier;
  const moqBase = s && s.minOrderQty != null && s.minOrderQty > 0 ? roundQty(s.minOrderQty * factorOf(s)) : null;
  const unitCostBase = s && s.unitPrice != null && s.unitPrice > 0 ? round6(s.unitPrice / factorOf(s)) : null;

  if (!needsReorder) {
    return { available, shortfall: Math.max(0, shortfall), suggestedQty: 0, moqBase, unitCostBase, estimatedCost: null, urgency, needsReorder };
  }

  const suggestedQty = roundQty(moqBase != null ? Math.max(shortfall, moqBase) : shortfall);
  const estimatedCost = unitCostBase != null ? round2(suggestedQty * unitCostBase) : null;
  return { available, shortfall, suggestedQty, moqBase, unitCostBase, estimatedCost, urgency, needsReorder };
}

/** Stocked-out first, then below-min; ties by largest shortfall. */
export const URGENCY_RANK: Record<ReorderUrgency, number> = { stocked_out: 0, below_min: 1, ok: 2 };

export function compareUrgency(a: { urgency: ReorderUrgency; shortfall: number }, b: { urgency: ReorderUrgency; shortfall: number }): number {
  return URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency] || b.shortfall - a.shortfall;
}

export const URGENCY_LABEL: Record<ReorderUrgency, string> = {
  stocked_out: "Stocked out",
  below_min: "Below minimum",
  ok: "OK",
};

/**
 * Pick the supplier link to order from: the preferred one, else the only one,
 * else the first by supplier name so the choice is stable. Null when none.
 */
export function pickPreferredLink<T extends { isPreferred: boolean; supplierName: string }>(links: T[]): T | null {
  if (!links.length) return null;
  const preferred = links.filter((l) => l.isPreferred);
  const pool = preferred.length ? preferred : links;
  return [...pool].sort((a, b) => a.supplierName.localeCompare(b.supplierName))[0];
}
