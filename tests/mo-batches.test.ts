import { describe, it, expect } from "vitest";
import { totalBase, batchesFromOutputs, scaleOutputsToBatches, batchWarnings, shares } from "@/lib/inventory/mo-batches";

// A 400 kg batch making an 0.8 kg loaf and a 0.4 kg loaf.
const outs = (a: number, b: number) => [{ qty: a, unitContent: 0.8 }, { qty: b, unitContent: 0.4 }];

describe("MO batches and SKU quantities", () => {
  it("adds the SKU quantities up in the base unit", () => {
    expect(totalBase(outs(250, 500))).toBe(400);   // 200 + 200
  });

  it("derives batches from the SKU quantities, fractions allowed", () => {
    expect(batchesFromOutputs(outs(250, 500), 400)).toBe(1);
    expect(batchesFromOutputs(outs(375, 750), 400)).toBe(1.5);
    expect(batchesFromOutputs(outs(100, 0), 0)).toBe(0);
  });

  it("scales the SKU quantities in proportion when batches are typed, keeping their ratio", () => {
    expect(scaleOutputsToBatches(outs(250, 500), 2, 400)).toEqual([500, 1000]);
    const s = scaleOutputsToBatches(outs(100, 300), 1, 400)!;
    expect(s[1] / s[0]).toBeCloseTo(3, 6);
    expect(totalBase([{ qty: s[0], unitContent: 0.8 }, { qty: s[1], unitContent: 0.4 }])).toBeCloseTo(400, 4);
  });

  it("does not invent a split when nothing is allocated yet", () => {
    expect(scaleOutputsToBatches(outs(0, 0), 2, 400)).toBeNull();
    expect(scaleOutputsToBatches(outs(10, 10), 0, 400)).toBeNull();
  });

  it("warns, never blocks", () => {
    expect(batchWarnings(outs(0, 0), 400)).toEqual(["none-allocated"]);
    expect(batchWarnings(outs(375, 750), 400)).toEqual(["part-batch"]);
    expect(batchWarnings(outs(250, 500), 400)).toEqual([]);
  });

  it("shares the batch by quantity, which is the basis ingredient cost is split on", () => {
    const s = shares(outs(250, 500));
    expect(s[0]).toBeCloseTo(0.5, 6);
    expect(s[1]).toBeCloseTo(0.5, 6);
    expect(shares(outs(0, 0))).toEqual([0, 0]);
  });
});

import { outputUnitOptions } from "@/lib/inventory/mo-batches";

describe("counting an output in a unit the planner chooses", () => {
  // The 4 oz empanada from the order screen: base unit oz, 4 oz per pack.
  const out = { skuId: "s1", skuName: "Chicken Empanada", unitContent: 4 };
  const sku = { innerPackType: "bag", unitsInOuterPack: 12, outerPackType: "case" } as any;

  it("offers the pack, its larger pack, the base unit and other units of the same kind", () => {
    const labels = outputUnitOptions("oz", out, sku).map(u => u.label);
    expect(labels[0]).toMatch(/^bag/);
    expect(labels.some(l => /^case/.test(l))).toBe(true);
    expect(labels).toContain("oz — base");
    expect(labels).toContain("lb");
    expect(labels).toContain("kg");
    expect(labels).not.toContain("oz");            // the base unit is already offered once
    expect(labels).not.toContain("each");          // a count unit is not a weight
  });

  it("says how many packs one of each unit is, so the stored quantity stays in packs", () => {
    const by = Object.fromEntries(outputUnitOptions("oz", out, sku).map(u => [u.label.split(" ")[0], u.perPack]));
    expect(by["oz"]).toBeCloseTo(1 / 4, 9);        // one oz is a quarter of a 4 oz pack
    expect(by["lb"]).toBeCloseTo(16 / 4, 6);       // one lb is 4 packs
    expect(by["case"]).toBe(12);
  });

  it("does the planner's arithmetic: 100 lb of 4 oz packs is 400 packs", () => {
    const lb = outputUnitOptions("oz", out, sku).find(u => u.label === "lb")!;
    expect(100 * lb.perPack).toBeCloseTo(400, 6);
  });

  it("a base-unit output (no SKU) can still be counted in lb or kg", () => {
    const u = outputUnitOptions("kg", { skuId: null, skuName: null, unitContent: null }, null);
    expect(u.find(x => x.label === "lb")!.perPack).toBeCloseTo(0.45359237, 6);
  });

  it("offers nothing extra for an item with no base unit", () => {
    expect(outputUnitOptions(null, out, sku).every(u => u.label !== "lb")).toBe(true);
  });
});
