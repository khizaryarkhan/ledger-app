import { describe, it, expect } from "vitest";
import { consumptionUnits } from "@/lib/inventory/order-options";

const bagA = { id: "a", supplierId: "S1", supplierUom: "kg", innerUnitPackSize: 25, innerPackType: "bag", unitsInOuterPack: 40, outerPackType: "pallet" };
const bagB = { id: "b", supplierId: "S2", supplierUom: "kg", innerUnitPackSize: 20, innerPackType: "bag" };

describe("consumptionUnits", () => {
  it("always offers the base unit first, at factor 1", () => {
    const u = consumptionUnits("kg", {}, [], []);
    expect(u).toHaveLength(1);
    expect(u[0]).toMatchObject({ packLevel: "base", unitsPerOrderUnit: 1 });
  });

  it("offers only the lot's own supplier's packs — another vendor's bag is a different size", () => {
    const u = consumptionUnits("kg", { supplierId: "S1" }, [bagA, bagB], []);
    expect(u.map(o => o.unitsPerOrderUnit)).toEqual([1, 25, 1000]);
  });

  it("converts a pack in a different unit through the base unit", () => {
    const u = consumptionUnits("kg", { supplierId: "S1" }, [{ ...bagA, supplierUom: "g", innerUnitPackSize: 500, unitsInOuterPack: 0 }], []);
    expect(u.find(o => o.packLevel === "inner")?.unitsPerOrderUnit).toBeCloseTo(0.5);
  });

  it("a lot with no supplier on record sees every link's packs, labelled by size", () => {
    const u = consumptionUnits("kg", { supplierId: null }, [bagA, bagB], []);
    expect(u.map(o => o.unitsPerOrderUnit).sort((a, b) => a - b)).toEqual([1, 20, 25, 1000]);
  });

  it("adds our own SKU packs, narrowed to the lot's SKU", () => {
    const skus = [{ id: "k1", innerUnitPackSize: 6, innerPackType: "box" }, { id: "k2", innerUnitPackSize: 12, innerPackType: "case" }];
    expect(consumptionUnits("pcs", { skuId: "k2" }, [], skus).map(o => o.unitsPerOrderUnit)).toEqual([1, 12]);
    expect(consumptionUnits("pcs", {}, [], skus).map(o => o.unitsPerOrderUnit)).toEqual([1, 6, 12]);
  });
});
