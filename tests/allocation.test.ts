import { describe, it, expect } from "vitest";
import { availableInLot, fefoOrder, suggestPicks, coverage, allocationError, lotsAllowedBySku, proposeSubstitute, substituteConflict, type AllocatableLot } from "@/lib/inventory/allocation";

// MO lot allocation (product owner, 2026-09-24): nothing posts until an MO is
// completed; while it is in progress, production picks lots and those
// quantities are reserved so no other order can use them.
const lot = (id: string, remaining: number, o: Partial<AllocatableLot> = {}): AllocatableLot => ({
  id, lotNo: id.toUpperCase(), remainingQty: remaining, allocatedElsewhere: 0,
  expiryDate: null, receivedDate: "2026-09-01", unitCost: 1, ...o,
});

describe("lot allocation", () => {
  it("what another order holds is not available to this one", () => {
    expect(availableInLot({ remainingQty: 100, allocatedElsewhere: 60 })).toBe(40);
    expect(availableInLot({ remainingQty: 100, allocatedElsewhere: 120 })).toBe(0);   // never negative
  });

  it("orders lots first-expiry-first-out, then oldest receipt", () => {
    const lots = [
      lot("noexp-old", 5, { receivedDate: "2026-01-01" }),
      lot("late", 5, { expiryDate: "2027-03-01" }),
      lot("soon", 5, { expiryDate: "2026-10-01" }),
      lot("noexp-new", 5, { receivedDate: "2026-08-01" }),
    ];
    expect(fefoOrder(lots).map(l => l.id)).toEqual(["soon", "late", "noexp-old", "noexp-new"]);
  });

  it("suggests across lots by earliest expiry, skipping what others hold", () => {
    const lots = [
      lot("a", 30, { expiryDate: "2026-10-01", allocatedElsewhere: 30 }),   // fully held elsewhere
      lot("b", 50, { expiryDate: "2026-11-01" }),
      lot("c", 50, { expiryDate: "2026-12-01" }),
    ];
    expect(suggestPicks(lots, 70)).toEqual([{ lotId: "b", qty: 50 }, { lotId: "c", qty: 20 }]);
    expect(suggestPicks(lots, 0)).toEqual([]);
  });

  it("a lot can be split between orders by quantity", () => {
    const l = lot("a", 100, { allocatedElsewhere: 60 });
    expect(suggestPicks([l], 70)).toEqual([{ lotId: "a", qty: 40 }]);
  });

  it("reports how the allocation covers the plan", () => {
    expect(coverage(50, 0)).toBe("none");
    expect(coverage(50, 30)).toBe("partial");
    expect(coverage(50, 50)).toBe("full");
    expect(coverage(50, 53)).toBe("over");      // actual use above plan is allowed
  });

  it("refuses over-allocating a lot, duplicate lots and unknown lots", () => {
    const lots = new Map([["a", lot("a", 100, { allocatedElsewhere: 60 })]]);
    expect(allocationError([{ lotId: "a", qty: 40 }], lots)).toBeNull();
    expect(allocationError([{ lotId: "a", qty: 41 }], lots)).toMatch(/only 40 available/);
    expect(allocationError([{ lotId: "a", qty: 41 }], lots)).toMatch(/other orders/);
    expect(allocationError([{ lotId: "a", qty: 10 }, { lotId: "a", qty: 5 }], lots)).toMatch(/twice/);
    expect(allocationError([{ lotId: "zzz", qty: 1 }], lots)).toMatch(/not open stock/);
    expect(allocationError([{ lotId: "a", qty: 0 }], lots)).toMatch(/greater than zero/);
  });
});

// Phase 2 slice 2 (BOM Builder): a SKU limit on an ingredient, and substitutes.
// Decided with the product owner 2026-11-11: a lot whose supplier SKU is UNKNOWN is
// REFUSED under a limit, and a substitute is only ever PROPOSED, never applied for
// the planner.
describe("supplier-SKU limits", () => {
  const sl = (id: string, sku: string | null) => ({ ...lot(id, 100), supplierSkuId: sku });
  it("offers every lot when there is no limit", () => {
    const r = lotsAllowedBySku([sl("a", null), sl("b", "s1")], []);
    expect(r.allowed.map(l => l.id)).toEqual(["a", "b"]);
    expect(r.refused).toEqual([]);
  });
  it("keeps only lots of an allowed SKU", () => {
    const r = lotsAllowedBySku([sl("a", "s1"), sl("b", "s2")], ["s1"]);
    expect(r.allowed.map(l => l.id)).toEqual(["a"]);
    expect(r.refused.map(x => [x.lot.id, x.reason])).toEqual([["b", "other"]]);
  });
  it("REFUSES a lot with an unknown supplier SKU rather than guessing", () => {
    const r = lotsAllowedBySku([sl("a", null), sl("b", "s1")], ["s1"]);
    expect(r.allowed.map(l => l.id)).toEqual(["b"]);
    expect(r.refused.map(x => [x.lot.id, x.reason])).toEqual([["a", "unknown"]]);
  });
  it("allows any of several allowed SKUs", () => {
    expect(lotsAllowedBySku([sl("a", "s1"), sl("b", "s2"), sl("c", "s3")], ["s1", "s2"]).allowed.map(l => l.id)).toEqual(["a", "b"]);
  });
});

describe("proposeSubstitute", () => {
  const subs = [{ itemId: "x1", planned: 5, available: 8 }, { itemId: "x2", planned: 6, available: 9 }];
  it("proposes nothing while the main item covers the order", () => {
    expect(proposeSubstitute({ planned: 10, primaryAvailable: 10, subs })).toBeNull();
    expect(proposeSubstitute({ planned: 10, primaryAvailable: 12, subs })).toBeNull();
  });
  it("proposes the first substitute that covers its whole amount", () => {
    expect(proposeSubstitute({ planned: 10, primaryAvailable: 4, subs })).toEqual({ itemId: "x1", order: 1 });
  });
  it("skips a substitute that cannot cover and takes the next in order", () => {
    const r = proposeSubstitute({ planned: 10, primaryAvailable: 4, subs: [{ itemId: "x1", planned: 5, available: 3 }, { itemId: "x2", planned: 6, available: 6 }] });
    expect(r).toEqual({ itemId: "x2", order: 2 });
  });
  it("proposes nothing when no substitute covers", () => {
    expect(proposeSubstitute({ planned: 10, primaryAvailable: 0, subs: [{ itemId: "x1", planned: 5, available: 1 }] })).toBeNull();
    expect(proposeSubstitute({ planned: 10, primaryAvailable: 0, subs: [] })).toBeNull();
  });
});

describe("substituteConflict", () => {
  const fam = { primary: "p", substituteIds: ["x1", "x2"] };
  it("allows the first allocation to any source", () => {
    expect(substituteConflict({ ...fam, target: "p", allocatedItemIds: [] })).toBeNull();
    expect(substituteConflict({ ...fam, target: "x1", allocatedItemIds: [] })).toBeNull();
  });
  it("allows replacing the same source's own allocation", () => {
    expect(substituteConflict({ ...fam, target: "x1", allocatedItemIds: ["x1"] })).toBeNull();
  });
  it("refuses a substitute while the main item holds lots (never a silent mix)", () => {
    expect(substituteConflict({ ...fam, target: "x1", allocatedItemIds: ["p"] })).toMatch(/never a mix|one source/i);
  });
  it("refuses the main item while a substitute holds lots", () => {
    expect(substituteConflict({ ...fam, target: "p", allocatedItemIds: ["x1"] })).toMatch(/never a mix|one source/i);
  });
  it("refuses a second substitute", () => {
    expect(substituteConflict({ ...fam, target: "x2", allocatedItemIds: ["x1"] })).toMatch(/never a mix|one source/i);
  });
  it("refuses an item that is not in the family", () => {
    expect(substituteConflict({ ...fam, target: "zzz", allocatedItemIds: [] })).toMatch(/not a substitute|not a material/i);
  });
});
