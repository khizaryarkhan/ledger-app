/**
 * "Order by" choices for a trade-document line — the bridge between the unit an
 * item is STOCKED in and the unit it is TRANSACTED in.
 *
 * The item's base UoM is how the business consumes it: what a BOM specifies and
 * what production issues. A supplier's pack configuration is how one particular
 * vendor sells it — kg vs 25kg bags vs a 20-bag pallet. Those are different
 * facts about different parties, which is why the conversion lives on the
 * item↔supplier link and not on the item.
 *
 * Extracted from components/new-document-form.tsx so the rule below can be
 * tested without pulling a client component (and next/navigation) into vitest —
 * same reason lib/portal-response.ts and lib/ar-email.ts's appendPayButton
 * exist. Behaviour-identical to the inline version it replaced, plus the
 * supplier scoping.
 */

import { uom } from "@/lib/inventory/uom";

export type OrderOption = {
  label: string;
  packLevel: string;
  orderUom: string;
  unitsPerOrderUnit: number;
  supplierSkuId: string | null;
};

/**
 * Base units per one supplier UoM: same dimension → automatic ratio, else the
 * link's manual conversion factor.
 */
export function perSupplierUnit(supplierUom: string | null, baseUom: string | null, factor: any): number | null {
  const a = uom(supplierUom), b = uom(baseUom);
  if (a && b && a.dimension === b.dimension) return a.toBase / b.toBase;
  const f = Number(factor);
  return f > 0 ? f : null;
}

/** The always-available, always-safe choice: transact in the item's own unit. */
const baseOption = (baseUom: string | null): OrderOption => ({
  label: `${baseUom || "unit"} — base`,
  packLevel: "base",
  orderUom: baseUom || "",
  unitsPerOrderUnit: 1,
  supplierSkuId: null,
});

/**
 * Pack choices for a PURCHASE line, scoped to the supplier the document is
 * addressed to.
 *
 * The scoping is a correctness rule, not a tidiness one. A pack configuration
 * describes how ONE vendor packages the item; offering another vendor's would
 * let a buyer pick a pack whose conversion factor belongs to a different
 * supplier, and `unitsPerOrderUnit` is what turns the ordered quantity into
 * `ordered_base_qty` — so the error lands as a wrong quantity received into
 * stock, long after anyone would connect it to a dropdown.
 *
 * With no supplier chosen, only the base UoM is offered. That is always safe:
 * factor 1, no vendor packaging asserted.
 */
export function orderOptions(baseUom: string | null, supplierSkus: any[], supplierId: string): OrderOption[] {
  const opts: OrderOption[] = [baseOption(baseUom)];
  if (!supplierId) return opts;
  for (const s of supplierSkus || []) {
    // Defence in depth: callers pass an already-scoped list, but the rule lives
    // here so a future caller cannot opt out of it by accident.
    if (s.supplierId !== supplierId) continue;
    const per = perSupplierUnit(s.supplierUom, baseUom, s.conversionFactor);
    if (!per) continue;
    if (s.supplierUom && s.supplierUom !== baseUom) {
      opts.push({ label: `${s.supplierUom} — supplier UoM`, packLevel: "supplier", orderUom: s.supplierUom, unitsPerOrderUnit: per, supplierSkuId: s.id });
    }
    const inner = Number(s.innerUnitPackSize) || 0;
    if (inner > 0) {
      opts.push({ label: `${s.innerPackType || "inner pack"} (${inner} ${s.supplierUom || ""})`, packLevel: "inner", orderUom: s.innerPackType || "inner", unitsPerOrderUnit: inner * per, supplierSkuId: s.id });
    }
    const outer = Number(s.unitsInOuterPack) || 0;
    if (inner > 0 && outer > 0) {
      opts.push({ label: `${s.outerPackType || "outer pack"} (${outer} × ${s.innerPackType || "inner"})`, packLevel: "outer", orderUom: s.outerPackType || "outer", unitsPerOrderUnit: outer * inner * per, supplierSkuId: s.id });
    }
  }
  return opts;
}

/**
 * Pack choices for a SALES line, from finished-product SKUs. No supplier
 * scoping applies — these are our OWN packaging of our own finished goods, and
 * their pack sizes are already expressed in the item's base UoM (hence no
 * conversion factor anywhere below).
 */
export function salesOrderOptions(baseUom: string | null, itemSkus: any[]): OrderOption[] {
  const opts: OrderOption[] = [baseOption(baseUom)];
  for (const s of itemSkus || []) {
    const inner = Number(s.innerUnitPackSize) || 0;
    if (inner <= 0) continue;
    opts.push({ label: `${s.innerPackType || "inner pack"} (${inner} ${baseUom || ""})`, packLevel: "inner", orderUom: s.innerPackType || "inner", unitsPerOrderUnit: inner, supplierSkuId: s.id });
    const addl = Number(s.unitsInAddlInnerPack) || 0;
    const perAddl = addl > 0 ? inner * addl : inner;
    if (addl > 0) {
      opts.push({ label: `${s.addlInnerPackType || "pack"} (${addl} × ${s.innerPackType || "inner"})`, packLevel: "addl", orderUom: s.addlInnerPackType || "pack", unitsPerOrderUnit: perAddl, supplierSkuId: s.id });
    }
    const outer = Number(s.unitsInOuterPack) || 0;
    if (outer > 0) {
      opts.push({ label: `${s.outerPackType || "outer pack"} (${outer} × ${addl > 0 ? (s.addlInnerPackType || "pack") : (s.innerPackType || "inner")})`, packLevel: "outer", orderUom: s.outerPackType || "outer", unitsPerOrderUnit: perAddl * outer, supplierSkuId: s.id });
    }
  }
  return opts;
}
