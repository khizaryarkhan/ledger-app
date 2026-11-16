/**
 * The two-way link between "how many batches" and "how much of each SKU" on a manufacturing order.
 * PURE (client + server), so the order screen and its tests use the same arithmetic.
 *
 * Decided with the product owner: the SKU quantities are the truth. Batches is DERIVED from them
 * (total base quantity ÷ the BOM's batch size, fractions allowed); typing a batch count instead
 * scales the SKU quantities in proportion, keeping their ratio. Quantities that do not add up to
 * whole batches are a warning, never a refusal.
 */

import { outputCaptureUnits } from "@/lib/inventory/order-options";
import { UOMS, convert, dimensionOf } from "@/lib/inventory/uom";

export interface MoOutputLine { qty: number; unitContent: number }

export interface OutputUnit { label: string; perPack: number }

/**
 * Every unit a planner may count one output in, each with how many PACKS one of it is (the stored quantity is
 * always packs, so costing and completion are untouched): the SKU's own pack and its higher levels (carton,
 * shrink), the base unit, and any other unit that measures the same thing as the base unit (lb or kg for an oz
 * item). A base-unit output (no SKU) counts in the base unit and its same-dimension units.
 */
export function outputUnitOptions(
  baseUom: string | null,
  out: { skuId?: string | null; skuName?: string | null; unitContent?: number | null },
  sku?: Parameters<typeof outputCaptureUnits>[2],
): OutputUnit[] {
  const units = outputCaptureUnits(baseUom, out, sku);
  const dim = dimensionOf(baseUom);
  if (!baseUom || !dim) return units;
  const content = out.skuId ? Number(out.unitContent) || 0 : 1;
  if (!(content > 0)) return units;
  for (const u of UOMS) {
    if (u.dimension !== dim || u.code.toLowerCase() === baseUom.toLowerCase()) continue;
    const r = convert(1, u.code, baseUom);
    if (r.ok && r.qty > 0) units.push({ label: u.code, perPack: r.qty / content });
  }
  return units;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;
const pos = (n: number) => Number.isFinite(n) && n > 0;

/** Base quantity the SKU quantities add up to (Σ packs × content per pack). */
export function totalBase(outputs: MoOutputLine[]): number {
  return r6(outputs.reduce((s, o) => s + (pos(o.qty) && pos(o.unitContent) ? o.qty * o.unitContent : 0), 0));
}

/** Batches implied by the SKU quantities. 0 when there is nothing to divide by. */
export function batchesFromOutputs(outputs: MoOutputLine[], batchSizeBase: number): number {
  return pos(batchSizeBase) ? r6(totalBase(outputs) / batchSizeBase) : 0;
}

/**
 * Pack quantities for a typed batch count: the current quantities scaled in proportion so they add up to
 * batches × batch size. Returns null when no quantity exists yet to scale (the caller shows a warning and
 * the user allocates by hand: there is no honest default split).
 */
export function scaleOutputsToBatches(outputs: MoOutputLine[], batches: number, batchSizeBase: number): number[] | null {
  const cur = totalBase(outputs);
  if (!pos(cur) || !pos(batches) || !pos(batchSizeBase)) return null;
  const k = (batches * batchSizeBase) / cur;
  return outputs.map(o => (pos(o.qty) ? r6(o.qty * k) : 0));
}

export type BatchWarning = "none-allocated" | "part-batch";

/** What to tell the user about the current numbers. Never blocks. */
export function batchWarnings(outputs: MoOutputLine[], batchSizeBase: number): BatchWarning[] {
  if (totalBase(outputs) <= 0) return ["none-allocated"];
  const b = batchesFromOutputs(outputs, batchSizeBase);
  return b > 0 && Math.abs(b - Math.round(b)) > 1e-6 ? ["part-batch"] : [];
}

/** The share of the batch each SKU takes: the basis ingredient cost is split on (packaging is direct). */
export function shares(outputs: MoOutputLine[]): number[] {
  const t = totalBase(outputs);
  return outputs.map(o => (t > 0 && pos(o.qty) && pos(o.unitContent) ? (o.qty * o.unitContent) / t : 0));
}
