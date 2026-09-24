import { describe, it, expect } from "vitest";
import { availableInLot, fefoOrder, suggestPicks, coverage, allocationError, type AllocatableLot } from "@/lib/inventory/allocation";

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
