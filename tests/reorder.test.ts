import { describe, it, expect } from "vitest";
import { computeReorder, compareUrgency, pickPreferredLink, type ReorderSupplierInfo } from "@/lib/inventory/reorder";

const sup = (o: Partial<ReorderSupplierInfo> = {}): ReorderSupplierInfo => ({
  supplierId: "s1", supplierName: "Acme", currency: "EUR",
  minOrderQty: null, unitPrice: null, conversionFactor: null, leadTimeDays: null, ...o,
});

describe("computeReorder", () => {
  it("is ok when available meets the minimum", () => {
    const r = computeReorder({ onHand: 10, expected: 0, committed: 0, minOh: 10, supplier: null });
    expect(r.needsReorder).toBe(false);
    expect(r.urgency).toBe("ok");
    expect(r.suggestedQty).toBe(0);
  });

  it("counts expected and committed in availability", () => {
    const r = computeReorder({ onHand: 5, expected: 20, committed: 10, minOh: 10, supplier: null });
    expect(r.available).toBe(15);
    expect(r.needsReorder).toBe(false);
  });

  it("flags below-min and suggests the shortfall", () => {
    const r = computeReorder({ onHand: 4, expected: 0, committed: 0, minOh: 10, supplier: null });
    expect(r.urgency).toBe("below_min");
    expect(r.shortfall).toBe(6);
    expect(r.suggestedQty).toBe(6);
    expect(r.estimatedCost).toBeNull();
  });

  it("flags stocked-out when nothing is on hand", () => {
    const r = computeReorder({ onHand: 0, expected: 0, committed: 0, minOh: 10, supplier: null });
    expect(r.urgency).toBe("stocked_out");
  });

  it("stays stocked-out even when an open PO covers some of the minimum", () => {
    const r = computeReorder({ onHand: 0, expected: 3, committed: 0, minOh: 10, supplier: null });
    expect(r.urgency).toBe("stocked_out");
    expect(r.shortfall).toBe(7);
  });

  it("raises the suggestion to the supplier MOQ", () => {
    const r = computeReorder({ onHand: 4, expected: 0, committed: 0, minOh: 10, supplier: sup({ minOrderQty: 50 }) });
    expect(r.suggestedQty).toBe(50);
  });

  it("does not shrink a shortfall that exceeds the MOQ", () => {
    const r = computeReorder({ onHand: 0, expected: 0, committed: 0, minOh: 100, supplier: sup({ minOrderQty: 25 }) });
    expect(r.suggestedQty).toBe(100);
  });

  it("converts MOQ and price from supplier UoM to base", () => {
    // 1 bag = 25 kg, MOQ 2 bags, 50 per bag
    const r = computeReorder({
      onHand: 0, expected: 0, committed: 0, minOh: 10,
      supplier: sup({ minOrderQty: 2, unitPrice: 50, conversionFactor: 25 }),
    });
    expect(r.moqBase).toBe(50);
    expect(r.unitCostBase).toBe(2);
    expect(r.suggestedQty).toBe(50);
    expect(r.estimatedCost).toBe(100);
  });

  it("treats negative availability (over-committed) as a need even with zero minimum", () => {
    const r = computeReorder({ onHand: 2, expected: 0, committed: 5, minOh: 0, supplier: null });
    expect(r.needsReorder).toBe(true);
    expect(r.shortfall).toBe(3);
  });

  it("ignores a shortfall below the quantity epsilon", () => {
    const r = computeReorder({ onHand: 9.9999999, expected: 0, committed: 0, minOh: 10, supplier: null });
    expect(r.needsReorder).toBe(false);
  });

  it("keeps fractional quantities to 6dp", () => {
    const r = computeReorder({ onHand: 0.1, expected: 0, committed: 0, minOh: 0.300005, supplier: null });
    expect(r.suggestedQty).toBe(0.200005);
  });
});

describe("compareUrgency / pickPreferredLink", () => {
  it("sorts stocked-out before below-min, then by shortfall", () => {
    const rows = [
      { urgency: "below_min" as const, shortfall: 50 },
      { urgency: "stocked_out" as const, shortfall: 1 },
      { urgency: "below_min" as const, shortfall: 80 },
    ].sort(compareUrgency);
    expect(rows.map((r) => r.shortfall)).toEqual([1, 80, 50]);
  });

  it("prefers the flagged link, then falls back deterministically", () => {
    const links = [
      { isPreferred: false, supplierName: "Zed" },
      { isPreferred: true, supplierName: "Mid" },
      { isPreferred: false, supplierName: "Alpha" },
    ];
    expect(pickPreferredLink(links)?.supplierName).toBe("Mid");
    expect(pickPreferredLink(links.map((l) => ({ ...l, isPreferred: false })))?.supplierName).toBe("Alpha");
    expect(pickPreferredLink([])).toBeNull();
  });
});
