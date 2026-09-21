/**
 * Purchase "order by" choices — the rule that a pack configuration belongs to
 * ONE supplier (lib/inventory/order-options.ts).
 *
 * Why this is worth a test rather than a careful read: `unitsPerOrderUnit` is
 * what converts an ordered quantity into `ordered_base_qty`, so picking a pack
 * that belongs to a different vendor does not fail loudly — it books the wrong
 * quantity of stock at receipt, and by then nothing points back at a dropdown.
 * The cross-supplier case below fails on the pre-fix implementation, which
 * looped over every link on the item regardless of who the order was addressed
 * to.
 *
 * No database and no network: these are pure functions, which is the whole
 * reason they were extracted out of components/new-document-form.tsx.
 */

import { describe, it, expect } from "vitest";
import { orderOptions, salesOrderOptions, perSupplierUnit } from "@/lib/inventory/order-options";

const SUPPLIER_A = "11111111-1111-1111-1111-111111111111";
const SUPPLIER_B = "22222222-2222-2222-2222-222222222222";

/** Supplier A sells yarn in 25kg bags, 20 bags to a pallet. Base UoM is kg. */
const linkA = {
  id: "link-a", supplierId: SUPPLIER_A, supplierUom: "kg", conversionFactor: null,
  innerUnitPackSize: 25, innerPackType: "bag",
  unitsInOuterPack: 20, outerPackType: "pallet",
};
/** Supplier B sells the SAME item in 50kg drums — a different physical pack. */
const linkB = {
  id: "link-b", supplierId: SUPPLIER_B, supplierUom: "kg", conversionFactor: null,
  innerUnitPackSize: 50, innerPackType: "drum",
  unitsInOuterPack: 4, outerPackType: "crate",
};

const labels = (opts: { label: string }[]) => opts.map(o => o.label);
const skuIds = (opts: { supplierSkuId: string | null }[]) => opts.map(o => o.supplierSkuId);

describe("orderOptions — supplier scoping", () => {
  it("offers only the addressed supplier's packs when the item has several suppliers", () => {
    const opts = orderOptions("kg", [linkA, linkB], SUPPLIER_A);
    expect(skuIds(opts)).toEqual([null, "link-a", "link-a"]);      // base + bag + pallet
    expect(labels(opts).join(" ")).toContain("bag");
    expect(labels(opts).join(" ")).not.toContain("drum");           // B's packaging never appears
    expect(labels(opts).join(" ")).not.toContain("crate");
  });

  it("never lets one supplier's conversion factor reach another's order", () => {
    // The failure this guards: ordering 2 from supplier A must mean 2 bags of
    // 25kg (50kg), never 2 drums of 50kg (100kg).
    const a = orderOptions("kg", [linkA, linkB], SUPPLIER_A).find(o => o.packLevel === "inner");
    const b = orderOptions("kg", [linkA, linkB], SUPPLIER_B).find(o => o.packLevel === "inner");
    expect(a?.unitsPerOrderUnit).toBe(25);
    expect(b?.unitsPerOrderUnit).toBe(50);
  });

  it("offers base UoM only when no supplier is chosen yet", () => {
    const opts = orderOptions("kg", [linkA, linkB], "");
    expect(opts).toHaveLength(1);
    expect(opts[0]).toMatchObject({ packLevel: "base", unitsPerOrderUnit: 1, supplierSkuId: null });
  });

  it("offers base UoM only for a supplier with no link to this item", () => {
    const opts = orderOptions("kg", [linkA], SUPPLIER_B);
    expect(opts).toHaveLength(1);
    expect(opts[0].packLevel).toBe("base");
  });

  it("always includes base UoM, so an item is orderable with no packs configured", () => {
    expect(orderOptions("kg", [], SUPPLIER_A)[0]).toMatchObject({ packLevel: "base", unitsPerOrderUnit: 1 });
    expect(orderOptions(null, [], SUPPLIER_A)[0]).toMatchObject({ label: "unit — base", orderUom: "" });
  });
});

describe("orderOptions — pack arithmetic", () => {
  it("multiplies outer × inner × per-supplier-unit", () => {
    const pallet = orderOptions("kg", [linkA], SUPPLIER_A).find(o => o.packLevel === "outer");
    expect(pallet?.unitsPerOrderUnit).toBe(500);   // 20 bags × 25 kg
  });

  it("converts across units of the same dimension without a manual factor", () => {
    // Item stocked in kg, supplier sells by the tonne.
    const link = { id: "l", supplierId: SUPPLIER_A, supplierUom: "mt", conversionFactor: null, innerUnitPackSize: 0, unitsInOuterPack: 0 };
    const supplierUom = orderOptions("kg", [link], SUPPLIER_A).find(o => o.packLevel === "supplier");
    expect(supplierUom?.unitsPerOrderUnit).toBe(1000);
  });

  it("falls back to the manual factor across dimensions, and drops the pack without one", () => {
    const withFactor = { id: "l", supplierId: SUPPLIER_A, supplierUom: "roll", conversionFactor: "40", innerUnitPackSize: 0, unitsInOuterPack: 0 };
    expect(orderOptions("kg", [withFactor], SUPPLIER_A).find(o => o.packLevel === "supplier")?.unitsPerOrderUnit).toBe(40);

    // No factor and no shared dimension — an unusable pack is omitted rather
    // than offered at a guessed 1:1, which would silently under-receive.
    const noFactor = { ...withFactor, conversionFactor: null };
    expect(orderOptions("kg", [noFactor], SUPPLIER_A)).toHaveLength(1);
  });

  it("perSupplierUnit prefers the dimensional ratio over a stale manual factor", () => {
    expect(perSupplierUnit("mt", "kg", 999)).toBe(1000);
    expect(perSupplierUnit("roll", "kg", 40)).toBe(40);
    expect(perSupplierUnit("roll", "kg", 0)).toBeNull();
  });
});

describe("salesOrderOptions", () => {
  it("is not supplier-scoped — these are our own finished-goods packs", () => {
    const sku = { id: "sku-1", innerUnitPackSize: 12, innerPackType: "box", unitsInOuterPack: 8, outerPackType: "carton" };
    const opts = salesOrderOptions("each", [sku]);
    expect(labels(opts).join(" ")).toContain("box");
    expect(opts.find(o => o.packLevel === "outer")?.unitsPerOrderUnit).toBe(96); // 8 × 12
  });

  it("skips a SKU with no pack size rather than offering a zero-unit pack", () => {
    expect(salesOrderOptions("each", [{ id: "s", innerUnitPackSize: 0 }])).toHaveLength(1);
  });
});
