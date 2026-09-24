/**
 * Costing one manufacturing-order completion — pure, no db, so every rule here
 * is provable in tests (tests/mo-costing.test.ts).
 *
 * What goes in: the ingredient cost consumed, the packaging consumed for each
 * output pack, and the labour and overhead charged (hours × the work centre's
 * rates, as copied onto the MO). What comes out: good output lots, and — only
 * for loss BEYOND the BOM's expected yield — scrap.
 *
 * Yield (spec 2.5): normal loss is absorbed into the good output's cost; only
 * abnormal loss is written off. With an expected yield of y%, a run that
 * produced G good and R rejected base units may lose (G+R)·(1−y) normally. Any
 * rejection above that allowance is abnormal, and is valued at the SAME unit
 * cost as good output — so the good units carry exactly the normal loss, never
 * the abnormal. No expected yield on the BOM means 100%: every rejected unit is
 * abnormal. Packaging is outside this: a pack is filled only with good product,
 * so its packaging belongs to the pack.
 */

import { round2, roundQty } from "@/lib/inventory/round";

export type CompletionCostInput = {
  ingredientCost: number;                        // common to every pack
  packagingCostBySku: Record<string, number>;    // consumed for that pack
  labourCost: number;
  overheadCost: number;
  outputs: { skuId: string; goodPacks: number; unitContent: number }[];
  rejectedBase: number;                          // base UoM
  expYieldPct: number | null;                    // e.g. 95; null = 100
};

export type CompletionCost = {
  goodBase: number;
  normalLossBase: number;
  abnormalBase: number;
  commonCost: number;       // ingredients + labour + overhead
  scrapCost: number;        // to Scrap & yield loss
  outputs: { skuId: string; packs: number; baseQty: number; amount: number; unitCost: number }[];
  total: number;            // everything consumed = Σ outputs + scrap
};

export function costCompletion(i: CompletionCostInput): CompletionCost {
  const y = i.expYieldPct == null || !(i.expYieldPct > 0) ? 1 : Math.min(1, i.expYieldPct / 100);
  const outs = i.outputs.map(o => ({ ...o, baseQty: roundQty(Math.max(0, o.goodPacks) * Math.max(0, o.unitContent)) }));
  const goodBase = roundQty(outs.reduce((s, o) => s + o.baseQty, 0));
  const rejected = roundQty(Math.max(0, i.rejectedBase));
  const allowance = roundQty((goodBase + rejected) * (1 - y));
  const normalLossBase = roundQty(Math.min(rejected, allowance));
  const abnormalBase = roundQty(Math.max(0, rejected - allowance));

  const commonCost = round2(i.ingredientCost + i.labourCost + i.overheadCost);
  const packSkus = new Set(outs.filter(o => o.baseQty > 0).map(o => o.skuId));
  // Packaging consumed for a pack that produced nothing good has nothing to
  // sit in: it is lost, and goes to scrap with the product.
  const orphanPackaging = round2(Object.entries(i.packagingCostBySku).filter(([sku]) => !packSkus.has(sku)).reduce((s, [, v]) => s + v, 0));

  let scrapCost: number;
  if (goodBase <= 0) {
    scrapCost = round2(commonCost + orphanPackaging);
  } else {
    const unit = commonCost / (goodBase + abnormalBase);
    scrapCost = round2(abnormalBase * unit + orphanPackaging);
  }
  const commonToOutput = round2(commonCost + orphanPackaging - scrapCost);

  // Common cost by each pack's share of the good base; its own packaging on top.
  const rows = outs.filter(o => o.baseQty > 0).map(o => ({
    skuId: o.skuId, packs: o.goodPacks, baseQty: o.baseQty,
    amount: round2((goodBase > 0 ? (o.baseQty / goodBase) * commonToOutput : 0) + (i.packagingCostBySku[o.skuId] ?? 0)),
    unitCost: 0,
  }));
  const total = round2(commonCost + Object.values(i.packagingCostBySku).reduce((s, v) => s + v, 0));
  // Rounding lands on the largest pack, so outputs + scrap equal what went in to the cent.
  const resid = round2(total - scrapCost - rows.reduce((s, r) => s + r.amount, 0));
  if (resid !== 0 && rows.length) { const big = rows.reduce((a, b) => (b.amount > a.amount ? b : a)); big.amount = round2(big.amount + resid); }
  for (const r of rows) r.unitCost = r.baseQty > 0 ? Math.round((r.amount / r.baseQty) * 1e6) / 1e6 : 0;

  return { goodBase, normalLossBase, abnormalBase, commonCost, scrapCost, outputs: rows, total };
}

/**
 * Split one packaging item's consumed cost across the packs it serves, by what
 * each pack was planned to use of it.
 */
export function splitPackaging(cost: number, plannedBySku: Record<string, number>): Record<string, number> {
  const entries = Object.entries(plannedBySku).filter(([, q]) => q > 0);
  const sum = entries.reduce((s, [, q]) => s + q, 0);
  const out: Record<string, number> = {};
  if (!entries.length || sum <= 0) return out;
  let given = 0;
  entries.forEach(([sku, q], idx) => {
    const v = idx === entries.length - 1 ? round2(cost - given) : round2(cost * q / sum);
    out[sku] = round2((out[sku] ?? 0) + v); given = round2(given + v);
  });
  return out;
}

/** Default hours for a completion: the planned hours in proportion to what this run made. */
export function proportionalHours(plannedHours: number, runBase: number, plannedBase: number): number {
  if (!(plannedBase > 0)) return plannedHours;
  return roundQty(plannedHours * Math.min(1, Math.max(0, runBase / plannedBase)));
}
