/**
 * The unit a BOM's batch is counted in. PURE (client + server).
 *
 * A BOM's batch is stored in its output item's BASE unit (boms.batch_size) so manufacturing orders and
 * costing never change; batch_uom only remembers what the author typed it in. Any unit measuring the
 * same thing as the base unit is accepted (kg, g, lb, t for a kg item). A unit from another dimension
 * is refused: there is no honest factor between kilograms and pieces without a density or unit weight.
 */

import { UOMS, convert, dimensionOf, uom, type Dimension, type Uom } from "@/lib/inventory/uom";

export const DIMENSION_LABEL: Record<Dimension, string> = { mass: "Weight", volume: "Volume", count: "Count", length: "Length" };

/** Units grouped by what they measure, in the order a picker should show them. */
export function unitGroups(): { dimension: Dimension; label: string; units: Uom[] }[] {
  return (["mass", "volume", "count", "length"] as Dimension[]).map(d => ({ dimension: d, label: DIMENSION_LABEL[d], units: UOMS.filter(u => u.dimension === d) }));
}

/** Can a batch be counted in `batchUom` for an item kept in `baseUom`? */
export function batchUnitError(baseUom: string | null | undefined, batchUom: string | null | undefined): string | null {
  if (!batchUom) return null;
  if (!uom(batchUom)) return `“${batchUom}” is not a unit this app knows.`;
  if (!baseUom || !uom(baseUom)) return null;      // an item with no usable base unit: nothing to compare against
  if (dimensionOf(baseUom) !== dimensionOf(batchUom)) {
    return `This product is kept in ${baseUom}, so its batch has to be counted in a ${DIMENSION_LABEL[dimensionOf(baseUom)!].toLowerCase()} unit. ${batchUom} measures something else.`;
  }
  return null;
}

/** A batch typed in `batchUom`, as the item's base unit. Unchanged when no unit or no conversion applies. */
export function batchToBase(size: number, baseUom: string | null | undefined, batchUom: string | null | undefined): number {
  if (!batchUom || !baseUom || batchUom.toLowerCase() === baseUom.toLowerCase()) return size;
  const r = convert(size, batchUom, baseUom);
  return r.ok ? Math.round(r.qty * 1e6) / 1e6 : size;
}

/** The stored (base) batch, shown in the unit the author chose. */
export function batchFromBase(base: number, baseUom: string | null | undefined, batchUom: string | null | undefined): number {
  if (!batchUom || !baseUom || batchUom.toLowerCase() === baseUom.toLowerCase()) return base;
  const r = convert(base, baseUom, batchUom);
  return r.ok ? Math.round(r.qty * 1e6) / 1e6 : base;
}
