import { describe, it, expect } from "vitest";
import { outputCaptureUnits } from "@/lib/inventory/order-options";

describe("outputCaptureUnits", () => {
  it("a base-unit output (no SKU) is counted only in the base unit", () => {
    expect(outputCaptureUnits("lt", { skuId: null, unitContent: 1 })).toEqual([{ label: "lt — base", perPack: 1 }]);
  });

  it("offers the pack, its higher levels as counts of packs, and the base unit", () => {
    const u = outputCaptureUnits("lt", { skuId: "s", skuName: "750ml Bottle", unitContent: 0.75 },
      { innerPackType: "bottle", unitsInAddlInnerPack: 6, addlInnerPackType: "shrink", unitsInOuterPack: 4, outerPackType: "carton" });
    expect(u.map(x => x.perPack)).toEqual([1, 6, 24, 1 / 0.75]);
    expect(u[0].label).toBe("bottle (0.75 lt)");
  });

  it("an outer pack with no additional-inner level counts packs directly", () => {
    const u = outputCaptureUnits("lt", { skuId: "s", unitContent: 1 }, { unitsInOuterPack: 12, outerPackType: "case" });
    expect(u.find(x => x.label.startsWith("case"))?.perPack).toBe(12);
  });

  it("3 litres of a 0.75 lt bottle is 4 packs", () => {
    const base = outputCaptureUnits("lt", { skuId: "s", unitContent: 0.75 }).at(-1)!;
    expect(3 * base.perPack).toBeCloseTo(4);
  });
});
