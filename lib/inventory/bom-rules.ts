/**
 * BOM Builder rules. PURE: no db, no network, safe for the client and the server,
 * so the drawer and the save route cannot disagree about what a valid recipe is
 * (same split as lib/modules.ts / lib/modules-server.ts).
 *
 * A BOM makes `batchSize` of its output item's BASE unit. `outputs` are the PACKS
 * (SKUs) of that same item the recipe can make; qty on an output is the base
 * content of ONE pack, and a pack line's qty is per ONE pack of its output.
 */

export interface BomOutputInput { skuId: string | null; qty: number; outputPackQty?: number | null; packagingConfig?: string | null }
export interface BomIngredientInput { itemId: string; qty: number; uom: string | null; supplierSkuId?: string | null }
export interface BomPackInput { itemId: string; qty: number; uom: string | null; forSkuId: string | null }
export interface BomOperationInput { workCentreId: string; hoursPerBatch: number; description: string | null }

export interface BomInput {
  code: string | null;
  name: string;
  outputItemId: string | null;
  outputSkuId: string | null;
  status: string;
  batchType: string;
  batchSize: number;
  expYield: number | null;
  processingStep: string | null;
  notes: string | null;
  outputs: BomOutputInput[];
  inputs: BomIngredientInput[];
  packs: BomPackInput[];
  ops: BomOperationInput[];
}

export type DuplicateKind = "output" | "input" | "pack";
export interface Duplicate { kind: DuplicateKind; key: string }

const BASE_KEY = "base";

/** One output per SKU, one line per ingredient, one packaging line per item per pack. */
export function findDuplicates(b: Pick<BomInput, "outputs" | "inputs" | "packs">): Duplicate[] {
  const out: Duplicate[] = [];
  const seen = (list: string[], kind: DuplicateKind) => {
    const s = new Set<string>(), flagged = new Set<string>();
    for (const k of list) { if (s.has(k) && !flagged.has(k)) { flagged.add(k); out.push({ kind, key: k }); } s.add(k); }
  };
  seen(b.outputs.map(o => o.skuId ?? BASE_KEY), "output");
  seen(b.inputs.map(i => i.itemId), "input");
  seen(b.packs.map(p => `${p.itemId}|${p.forSkuId ?? ""}`), "pack");
  return out;
}

const pos = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n > 0;

const DUP_LABEL: Record<DuplicateKind, string> = { output: "output pack", input: "ingredient", pack: "packaging line" };

/** Everything that can be decided without the database. Returns human messages; empty = fine. */
export function validateBom(b: BomInput): string[] {
  const e: string[] = [];
  if (!b.name || !b.name.trim()) e.push("A BOM name is required.");
  if (!pos(b.batchSize)) e.push("Batch size must be above zero.");
  if (!b.inputs.length) e.push("Add at least one ingredient.");
  if (b.inputs.some(i => !pos(i.qty))) e.push("Every ingredient needs an amount above zero.");
  if (b.outputs.some(o => !pos(o.qty))) e.push("Every output needs its content per pack above zero.");
  if (b.packs.some(p => !pos(p.qty))) e.push("Every packaging line needs an amount above zero.");
  if (b.expYield != null && !(b.expYield > 0 && b.expYield <= 100)) e.push("Expected yield must be between 0 and 100.");
  if (b.ops.some(o => !pos(o.hoursPerBatch))) e.push("Every operation needs hours above zero.");
  // A recipe with no output packs makes the BASE unit, and packaging may attach to that.
  const outKeys = new Set(b.outputs.length ? b.outputs.map(o => o.skuId ?? BASE_KEY) : [BASE_KEY]);
  if (b.packs.some(p => !outKeys.has(p.forSkuId ?? BASE_KEY))) e.push("A packaging line points at a pack that is not an output of this BOM.");
  for (const d of findDuplicates(b)) e.push(`The same ${DUP_LABEL[d.kind]} appears more than once in this BOM (${d.key}). List each once.`);
  return e;
}

/** "honey 7 kg" → { query: "honey", qty: 7, unit: "kg" }. Digits inside a name are left alone. */
export function parseEntry(raw: string): { query: string; qty: number | null; unit: string } {
  const s = String(raw ?? "");
  const m = s.match(/^(.*?)[\s,:]+(\d+(?:[.,]\d+)?)\s*(kg|g|ml|l)?\s*$/i);
  if (m && m[1].trim()) return { query: m[1].trim(), qty: parseFloat(m[2].replace(",", ".")), unit: (m[3] || "").toLowerCase() };
  return { query: s.trim(), qty: null, unit: "" };
}

export const QUANTITY_TYPO_RATIO = 4;

/** An amount far from what another recipe for the same product uses, scaled to this batch. */
export function quantityCheck(a: { qty: number; referenceQty: number; referenceBatch: number; batch: number }): { flagged: boolean; expected: number } {
  if (!pos(a.referenceQty) || !pos(a.referenceBatch) || !pos(a.batch) || !pos(a.qty)) return { flagged: false, expected: 0 };
  const expected = Math.round(a.referenceQty * (a.batch / a.referenceBatch) * 1e6) / 1e6;
  const r = a.qty / expected;
  return { flagged: r > QUANTITY_TYPO_RATIO || r < 1 / QUANTITY_TYPO_RATIO, expected };
}

export interface WeightLine { itemId: string; name: string; qty: number; kgPerUnit: number | null }
export type WeightState = "idle" | "ok" | "gain" | "loss" | "incomplete";

/** Advisory in-vs-out check. Never blocks a save. */
export function weightBalance(a: { inputs: WeightLine[]; outKg: number; expYield: number | null }): { state: WeightState; inKg: number; outKg: number; keptPct: number | null; missing: string[] } {
  let inKg = 0; const missing: string[] = [];
  for (const l of a.inputs) {
    if (!(l.qty > 0)) continue;
    if (l.kgPerUnit == null) { if (!missing.includes(l.name)) missing.push(l.name); continue; }
    inKg += l.qty * l.kgPerUnit;
  }
  const res = (state: WeightState, keptPct: number | null) => ({ state, inKg, outKg: a.outKg, keptPct, missing });
  if (!a.inputs.length || !(a.outKg > 0)) return res("idle", null);
  if (missing.length) return res("incomplete", null);
  if (!(inKg > 0)) return res("idle", null);
  const y = (a.outKg / inKg) * 100, kept = Math.round(y);
  if (y > 102) return res("gain", kept);
  if (y < (a.expYield ?? 100) - 5) return res("loss", kept);
  return res("ok", kept);
}

export interface CostLine { qty: number; unitCost: number | null; isPack: boolean }
export interface CostOp { hours: number; labourRate: number; overheadRate: number }

/** Estimate from today's costs and rates. Real cost comes from the lots consumed when an order completes. */
export function costRollup(a: { batch: number; lines: CostLine[]; ops: CostOp[] }) {
  let materials = 0, packaging = 0, unpriced = 0, labour = 0, overhead = 0;
  for (const l of a.lines) {
    if (l.unitCost == null) { unpriced++; continue; }
    const c = l.qty * l.unitCost;
    if (l.isPack) packaging += c; else materials += c;
  }
  for (const o of a.ops) { labour += o.hours * o.labourRate; overhead += o.hours * o.overheadRate; }
  const total = materials + packaging + labour + overhead;
  return { materials, packaging, labour, overhead, total, perUnit: a.batch > 0 ? total / a.batch : 0, unpriced };
}

/** Total packaging needed for a batch: packs made (rounded up) × amount per pack. */
export function suggestPackQty(a: { batchBase: number; contentPerPack: number; perPack: number }): number | null {
  if (!pos(a.batchBase) || !pos(a.contentPerPack) || !pos(a.perPack)) return null;
  return Math.ceil(a.batchBase / a.contentPerPack) * a.perPack;
}

/** Suggested code for a copy: BOM_X → BOM_X-V2, stepping past versions already taken. */
export function nextCopyCode(source: string, taken: string[]): string {
  const root = source.replace(/-V\d+$/i, "");
  const t = new Set(taken.map(x => x.toLowerCase()));
  let n = 2;
  while (t.has(`${root}-V${n}`.toLowerCase())) n++;
  return `${root}-V${n}`;
}
