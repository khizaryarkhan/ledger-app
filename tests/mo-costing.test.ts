import { describe, it, expect } from "vitest";
import { costCompletion, splitPackaging, proportionalHours } from "@/lib/inventory/mo-costing";

// MO completion costing: materials + labour + overhead in; good output and
// abnormal scrap out. Normal loss (within the BOM's expected yield) stays in
// the good output's cost; only loss beyond it is written off.
const base = { packagingCostBySku: {}, labourCost: 0, overheadCost: 0, rejectedBase: 0, expYieldPct: null };

describe("MO completion costing", () => {
  it("puts materials, labour and overhead into the output lot", () => {
    const c = costCompletion({ ...base, ingredientCost: 600, labourCost: 300, overheadCost: 100,
      outputs: [{ skuId: "a", goodPacks: 100, unitContent: 1 }] });
    expect(c.total).toBe(1000);
    expect(c.scrapCost).toBe(0);
    expect(c.outputs[0].amount).toBe(1000);
    expect(c.outputs[0].unitCost).toBe(10);
  });

  it("absorbs loss within the expected yield into the good units", () => {
    // 95% yield: 1,000 in, 950 good, 50 rejected — all of it normal.
    const c = costCompletion({ ...base, ingredientCost: 950, expYieldPct: 95, rejectedBase: 50,
      outputs: [{ skuId: "a", goodPacks: 950, unitContent: 1 }] });
    expect(c.abnormalBase).toBe(0);
    expect(c.scrapCost).toBe(0);
    expect(c.outputs[0].amount).toBe(950);
    expect(c.outputs[0].unitCost).toBe(1);
  });

  it("writes off only the loss beyond the expected yield, at the good units' cost", () => {
    // 95% yield: 1,000 in, 900 good, 100 rejected → allowance 50, abnormal 50.
    const c = costCompletion({ ...base, ingredientCost: 950, expYieldPct: 95, rejectedBase: 100,
      outputs: [{ skuId: "a", goodPacks: 900, unitContent: 1 }] });
    expect(c.normalLossBase).toBe(50);
    expect(c.abnormalBase).toBe(50);
    expect(c.scrapCost).toBe(50);            // 50 units × (950 / 950)
    expect(c.outputs[0].amount).toBe(900);
    expect(c.outputs[0].amount + c.scrapCost).toBe(c.total);
  });

  it("without an expected yield, every rejected unit is abnormal", () => {
    const c = costCompletion({ ...base, ingredientCost: 100, rejectedBase: 10,
      outputs: [{ skuId: "a", goodPacks: 90, unitContent: 1 }] });
    expect(c.abnormalBase).toBe(10);
    expect(c.scrapCost).toBe(10);
  });

  it("nothing good produced: everything consumed is scrap", () => {
    const c = costCompletion({ ...base, ingredientCost: 100, labourCost: 20, packagingCostBySku: { a: 5 }, rejectedBase: 50,
      outputs: [{ skuId: "a", goodPacks: 0, unitContent: 1 }] });
    expect(c.outputs).toHaveLength(0);
    expect(c.scrapCost).toBe(125);
    expect(c.total).toBe(125);
  });

  it("splits common cost by base share and keeps each pack's own packaging", () => {
    const c = costCompletion({ ...base, ingredientCost: 300, packagingCostBySku: { box: 20, bag: 5 },
      outputs: [{ skuId: "box", goodPacks: 10, unitContent: 20 }, { skuId: "bag", goodPacks: 100, unitContent: 1 }] });
    const box = c.outputs.find(o => o.skuId === "box")!, bag = c.outputs.find(o => o.skuId === "bag")!;
    expect(box.amount).toBe(220);   // 200/300 of 300 + 20
    expect(bag.amount).toBe(105);   // 100/300 of 300 + 5
    expect(box.amount + bag.amount).toBe(c.total);
  });

  it("reconciles rounding so outputs + scrap equal what went in, to the cent", () => {
    const c = costCompletion({ ...base, ingredientCost: 100, expYieldPct: 97, rejectedBase: 7,
      outputs: [{ skuId: "a", goodPacks: 3, unitContent: 31 }, { skuId: "b", goodPacks: 7, unitContent: 1 }] });
    const sum = Math.round((c.outputs.reduce((s, o) => s + o.amount, 0) + c.scrapCost) * 100) / 100;
    expect(sum).toBe(c.total);
  });

  it("splits a shared packaging item by each pack's planned use", () => {
    expect(splitPackaging(10, { a: 3, b: 1 })).toEqual({ a: 7.5, b: 2.5 });
    expect(splitPackaging(10, { a: 1, b: 1, c: 1 })).toEqual({ a: 3.33, b: 3.33, c: 3.34 });
  });

  it("defaults a partial run's hours to its share of the plan", () => {
    expect(proportionalHours(10, 600, 1000)).toBe(6);
    expect(proportionalHours(10, 1200, 1000)).toBe(10);   // never above the plan by default
  });
});
