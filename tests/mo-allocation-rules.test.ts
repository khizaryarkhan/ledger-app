import { describe, it, expect } from "vitest";
import { expiryNeedsReason, expiredPickError, issuableRemaining, remainingExpectedBase, COMPLETION_LOCK_MESSAGE } from "@/lib/inventory/allocation";

describe("expired lots need a reason", () => {
  it("a lot is expired only when its expiry is before today (string compare)", () => {
    expect(expiryNeedsReason("2026-11-15", "2026-11-16")).toBe(true);
    expect(expiryNeedsReason("2026-11-16", "2026-11-16")).toBe(false);
    expect(expiryNeedsReason(null, "2026-11-16")).toBe(false);
  });
  it("refuses an expired pick with no reason, naming lot and date", () => {
    const lots = new Map([["a", { lotNo: "L1", expiryDate: "2026-10-01" }]]);
    const msg = expiredPickError([{ lotId: "a", expiryReason: "  " }], lots, "2026-11-16");
    expect(msg).toContain("L1"); expect(msg).toContain("2026-10-01");
    expect(expiredPickError([{ lotId: "a", expiryReason: "Re-tested, passed" }], lots, "2026-11-16")).toBeNull();
  });
  it("does not ask about a lot still in date", () => {
    const lots = new Map([["a", { lotNo: "L1", expiryDate: "2027-01-01" }]]);
    expect(expiredPickError([{ lotId: "a" }], lots, "2026-11-16")).toBeNull();
  });
});

describe("quarantined stock cannot be allocated", () => {
  it("removes non-issuable placements from what is allocatable", () => {
    expect(issuableRemaining(100, [{ qty: 30, issuable: false }, { qty: 70, issuable: true }])).toBe(70);
  });
  it("unplaced stock stays allocatable and the result is never negative", () => {
    expect(issuableRemaining(100, [])).toBe(100);
    expect(issuableRemaining(100, [{ qty: 20, issuable: true }])).toBe(100);
    expect(issuableRemaining(10, [{ qty: 30, issuable: false }])).toBe(0);
  });
});

describe("expected stock is the REMAINING output", () => {
  it("subtracts what partial runs already produced", () => {
    expect(remainingExpectedBase(100, [{ completedQty: 30, unitContent: 1 }])).toBe(70);
    expect(remainingExpectedBase(100, [{ completedQty: 4, unitContent: 5 }, { completedQty: 10, unitContent: 1 }])).toBe(70);
  });
  it("never goes below zero (overproduction)", () => {
    expect(remainingExpectedBase(10, [{ completedQty: 50, unitContent: 1 }])).toBe(0);
  });
  it("an order with no outputs keeps its full qty", () => {
    expect(remainingExpectedBase(40, [])).toBe(40);
  });
});

it("lock message is the agreed text", () => {
  expect(COMPLETION_LOCK_MESSAGE).toBe("A completion is waiting for approval; lots and status are locked until it is approved or rejected.");
});
