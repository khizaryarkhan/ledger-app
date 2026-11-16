/**
 * The BOM Builder's editing state. Quantities are STRINGS (what the user is typing)
 * and always in the item's BASE unit: a one-line entry like "salt 200g" is converted
 * when it is added, so nothing downstream ever guesses a unit.
 */

import { uom as uomOf } from "@/lib/inventory/uom";
import type { BomInput } from "@/lib/inventory/bom-rules";

/** A packaged SKU of a producible item, as the output grid needs it. `content` = base units in ONE pack (0 when unknown). */
export interface SkuInfo { id: string; name: string; code: string | null; itemId: string; content: number }
export interface SkuLite { id: string; skuName?: string | null; skuCode?: string | null; innerUnitPackSize?: number | string | null }
/** `skuId` "" = a blank line. `qty` is only kept when a saved BOM carried one; blank = the SKU's own content. */
export interface DraftOutput { key: string; skuId: string; qty: string }
export interface DraftSub { key: string; itemId: string; qty: string; allowedSkuIds: string[] }
export interface DraftLine { key: string; itemId: string; qty: string; note?: string | null; subs: DraftSub[]; allowedSkuIds: string[] }
export const newLine = (itemId: string, qty: string): DraftLine => ({ key: newKey(), itemId, qty, subs: [], allowedSkuIds: [] });
/** Packaging substitute: `qty` is a RATIO per ONE unit of the main packaging item (1 = one-for-one). */
export interface DraftPackSub { key: string; itemId: string; qty: string }
export interface DraftPack { key: string; itemId: string; qty: string; forSkuId: string | null; subs: DraftPackSub[] }
export const blankOutput = (): DraftOutput => ({ key: newKey(), skuId: "", qty: "" });
export const blankPack = (): DraftPack => ({ key: newKey(), itemId: "", qty: "", forSkuId: null, subs: [] });
export interface DraftOp { key: string; workCentreId: string; hours: string; description: string }

export interface Draft {
  code: string; name: string; outputItemId: string; status: string;
  /** Unit the batch is counted in ("" = the output item's base unit). */
  batchUom: string; batchSize: string; expYield: string; processingStep: string; notes: string;
  outputs: DraftOutput[]; inputs: DraftLine[]; packs: DraftPack[]; ops: DraftOp[];
}

let seq = 0;
export const newKey = () => `k${++seq}`;

export const emptyDraft = (): Draft => ({
  code: "", name: "", outputItemId: "", status: "Active", batchUom: "", batchSize: "", expYield: "", processingStep: "", notes: "",
  outputs: [blankOutput(), blankOutput()], inputs: [newLine("", ""), newLine("", "")], packs: [blankPack(), blankPack()], ops: [],
});

/** Everything that is a real line (blank starter lines are ignored on save). */
export const isBlankOutput = (o: DraftOutput) => !o.skuId;
export const isBlankLine = (l: { itemId: string }) => !l.itemId;

/** The drawer is "dirty" when this changes: keys and blank starter lines do not count. */
export function fingerprint(d: Draft): string {
  const clean = { ...d, outputs: d.outputs.filter(o => !isBlankOutput(o)), inputs: d.inputs.filter(l => !isBlankLine(l)), packs: d.packs.filter(p => !isBlankLine(p)) };
  return JSON.stringify(clean, (k, v) => (k === "key" ? undefined : v));
}

/**
 * Packaging tags follow the outputs: a removed SKU clears its tags, and the line then stays untagged (Save is
 * blocked until the user chooses). Only a line that was NEVER tagged takes the single remaining SKU: re-tagging
 * a line whose SKU was just removed would silently put another SKU's packaging on the survivor.
 */
export function syncPackTags(packs: DraftPack[], outputs: DraftOutput[]): DraftPack[] {
  const ids = outputs.filter(o => o.skuId).map(o => o.skuId);
  return packs.map(p => {
    const wasTagged = !!p.forSkuId;
    const tag = wasTagged && ids.includes(p.forSkuId as string) ? p.forSkuId : null;
    return { ...p, forSkuId: tag ?? (!wasTagged && ids.length === 1 && p.itemId ? ids[0] : null) };
  });
}

export const parseNum = (v: string | number | null | undefined): number => {
  if (v == null || v === "") return NaN;
  return Number(String(v).replace(",", "."));
};
const str = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? "" : String(n));

/** Server shape → editing state. Every row gets a fresh key, so it is safe for copying too. */
export function draftFromInput(i: BomInput): Draft {
  return {
    code: i.code ?? "", name: i.name, outputItemId: i.outputItemId ?? "", status: i.status, batchUom: i.batchUom ?? "",
    batchSize: str(i.batchSize), expYield: str(i.expYield), processingStep: i.processingStep ?? "", notes: i.notes ?? "",
    outputs: [...i.outputs.map(o => ({ key: newKey(), skuId: o.skuId ?? "", qty: str(o.qty) })), blankOutput()],
    inputs: i.inputs.map(l => ({
      key: newKey(), itemId: l.itemId, qty: str(l.qty), allowedSkuIds: l.allowedSkuIds ?? [],
      subs: (l.substitutes ?? []).map(s => ({ key: newKey(), itemId: s.itemId, qty: str(s.qty), allowedSkuIds: s.allowedSkuIds ?? [] })),
    })).concat([newLine("", "")]),
    packs: [...i.packs.map(p => ({ key: newKey(), itemId: p.itemId, qty: str(p.qty), forSkuId: p.forSkuId, subs: (p.substitutes ?? []).map(s => ({ key: newKey(), itemId: s.itemId, qty: str(s.qty) })) })), blankPack()],
    ops: i.ops.map(o => ({ key: newKey(), workCentreId: o.workCentreId, hours: str(o.hoursPerBatch), description: o.description ?? "" })),
  };
}

export interface ItemLite {
  id: string; name: string; code?: string | null; productType?: string | null; baseUom?: string | null; unitCost?: number | null; onHandQty?: number; invValue?: number;
  /** Kilograms in ONE base unit, for items whose unit is not a mass (a litre, a bar). */
  weightPerUnitKg?: number | null;
  allergens?: string[];
  sourcingPolicy?: string | null;
}

/** Editing state → the shape the rules and the API take. Blank starter lines are dropped. */
export function draftToInput(d: Draft, byId: Map<string, ItemLite>, skus: Map<string, SkuInfo>, outputItemId: string): BomInput {
  const base = (id: string) => byId.get(id)?.baseUom ?? null;
  const outs = d.outputs.filter(o => !isBlankOutput(o));
  return {
    code: d.code.trim() || null, name: d.name.trim(), outputItemId: outputItemId || null, outputSkuId: outs[0]?.skuId || null,
    status: d.status, batchType: "Output", batchSize: parseNum(d.batchSize), batchUom: d.batchUom || null, expYield: d.expYield.trim() === "" ? null : parseNum(d.expYield),
    processingStep: d.processingStep.trim() || null, notes: d.notes.trim() || null,
    outputs: outs.map(o => ({ skuId: o.skuId || null, qty: d.outputs.length && parseNum(o.qty) > 0 ? parseNum(o.qty) : skus.get(o.skuId)?.content ?? 0 })),
    inputs: d.inputs.filter(l => !isBlankLine(l)).map(l => ({
      itemId: l.itemId, qty: parseNum(l.qty), uom: base(l.itemId), allowedSkuIds: l.allowedSkuIds,
      substitutes: l.subs.map(s => ({ itemId: s.itemId, qty: parseNum(s.qty), allowedSkuIds: s.allowedSkuIds })),
    })),
    packs: d.packs.filter(p => !isBlankLine(p)).map(p => ({
      itemId: p.itemId, qty: parseNum(p.qty), uom: base(p.itemId), forSkuId: p.forSkuId,
      substitutes: p.subs.map(s => ({ itemId: s.itemId, qty: parseNum(s.qty) })),
    })),
    ops: d.ops.map(o => ({ workCentreId: o.workCentreId, hoursPerBatch: parseNum(o.hours), description: o.description.trim() || null })),
  };
}

/** Kilograms in one BASE unit of the item: a mass unit knows it, anything else needs the item's own weight. */
export function kgPerUnit(it: ItemLite | undefined): number | null {
  const u = uomOf(it?.baseUom);
  if (u && u.dimension === "mass") return u.toBase / 1000;
  return it?.weightPerUnitKg && it.weightPerUnitKg > 0 ? it.weightPerUnitKg : null;
}

/** Cost per base unit: average of what is on hand, else the item's own cost, else unknown. */
export function unitCostOf(it: ItemLite | undefined): number | null {
  if (!it) return null;
  if ((it.onHandQty ?? 0) > 0 && (it.invValue ?? 0) > 0) return (it.invValue as number) / (it.onHandQty as number);
  return it.unitCost && it.unitCost > 0 ? it.unitCost : null;
}

/** UI unit codes a person types ("l") onto the codes the converter knows ("lt"). */
export const normUnit = (u: string) => (u.toLowerCase() === "l" ? "lt" : u.toLowerCase());
