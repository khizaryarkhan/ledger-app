/**
 * Stock locations — the rule that decides which physical stock an issue may
 * touch (lib/inventory/valuation.ts's reachableSlices).
 *
 * This is the whole of Phase 1's risk surface that can be proven without a
 * database: get it wrong and either stock is consumed from a place it is not
 * in, or unreleased Quarantine material ships to a customer. Everything else in
 * the phase (placement arithmetic, tenancy) is asserted against a real database
 * by lib/accounting/reconcile.ts, because a fabricated one would prove nothing
 * — the same split the rest of this suite follows.
 */

import { describe, it, expect } from "vitest";
import { reachableSlices } from "@/lib/inventory/valuation";
import { NON_ISSUABLE_TYPES, LOCATION_TYPES } from "@/lib/inventory/locations";
import type { LotPlacement } from "@/lib/inventory/locations";

const at = (locationId: string, qty: number, type = "Store"): LotPlacement => ({
  locationId, qty, type, issuable: !NON_ISSUABLE_TYPES.has(type),
});

const total = (slices: { qty: number }[]) => slices.reduce((s, x) => s + x.qty, 0);

describe("an unscoped issue draws from every issuable location", () => {
  it("takes placements in the order given, which is location-code order", () => {
    const slices = reachableSlices([at("a", 3), at("b", 5)], 8, null);
    expect(slices).toEqual([
      { locationId: "a", qty: 3 },
      { locationId: "b", qty: 5 },
    ]);
  });

  it("never offers more than the lot's own remaining balance", () => {
    // Placements say 10, the lot says 6. The lot is the authority on how much
    // exists — honouring the placements would relieve stock the layer does not
    // have and drive the lot negative.
    const slices = reachableSlices([at("a", 4), at("b", 6)], 6, null);
    expect(total(slices)).toBe(6);
    expect(slices).toEqual([
      { locationId: "a", qty: 4 },
      { locationId: "b", qty: 2 },
    ]);
  });

  it("returns nothing for a lot with no placements and no remaining balance", () => {
    expect(reachableSlices([], 0, null)).toEqual([]);
  });
});

describe("Quarantine is never picked by FIFO", () => {
  it("is skipped when the issue names no location", () => {
    const slices = reachableSlices([at("qc", 100, "Quarantine"), at("store", 4)], 104, null);
    expect(slices.map(s => s.locationId)).not.toContain("qc");
    expect(slices).toEqual([{ locationId: "store", qty: 4 }]);
  });

  it("a lot sitting ENTIRELY in Quarantine is unreachable, not merely deprioritised", () => {
    // The dangerous failure would be treating unreleased stock as a last
    // resort rather than as off limits — it would ship the moment the released
    // stock ran out, which is exactly when nobody is watching.
    const slices = reachableSlices([at("qc", 50, "Quarantine")], 50, null);
    expect(slices).toEqual([]);
  });

  it("IS reachable when the caller names it explicitly", () => {
    // Deliberate: the refusal belongs at resolveLocationId({ forIssue: true }),
    // where the caller's intent is known. A transfer OUT of Quarantine is the
    // release step and must be able to reach the stock.
    const slices = reachableSlices([at("qc", 20, "Quarantine")], 20, "qc");
    expect(slices).toEqual([{ locationId: "qc", qty: 20 }]);
  });
});

describe("a location-scoped issue sees only that location", () => {
  it("ignores stock sitting elsewhere", () => {
    const slices = reachableSlices([at("a", 3), at("b", 99)], 102, "a");
    expect(slices).toEqual([{ locationId: "a", qty: 3 }]);
  });

  it("returns nothing when the lot is not at that location at all", () => {
    // Which becomes a shortfall upstream — "not enough HERE" — and that is the
    // right thing to tell a picker standing in the wrong aisle.
    expect(reachableSlices([at("a", 10)], 10, "b")).toEqual([]);
  });

  it("clamps to the lot's remaining balance even when the placement claims more", () => {
    expect(reachableSlices([at("a", 10)], 4, "a")).toEqual([{ locationId: "a", qty: 4 }]);
  });

  it("does not fall back to the unlocated remainder", () => {
    // Unlocated stock cannot be claimed to be at a named location: nobody knows
    // where it is, which is the whole meaning of the gap.
    const slices = reachableSlices([at("a", 2)], 10, "a");
    expect(slices).toEqual([{ locationId: "a", qty: 2 }]);
    expect(slices.some(s => s.locationId === null)).toBe(false);
  });
});

describe("stock the placements cannot account for is drawn, not hidden", () => {
  it("surfaces the gap as an unlocated slice, last", () => {
    // Drift is an integrity break and reconcile.ts reports it — but refusing to
    // let physical stock leave the building because a row is missing would be a
    // worse failure than the drift itself.
    const slices = reachableSlices([at("a", 4)], 10, null);
    expect(slices).toEqual([
      { locationId: "a", qty: 4 },
      { locationId: null, qty: 6 },
    ]);
  });

  it("adds no gap when placements exactly cover the balance", () => {
    const slices = reachableSlices([at("a", 4), at("b", 6)], 10, null);
    expect(slices.some(s => s.locationId === null)).toBe(false);
    expect(total(slices)).toBe(10);
  });

  it("adds no gap when placements exceed the balance", () => {
    const slices = reachableSlices([at("a", 20)], 5, null);
    expect(slices.some(s => s.locationId === null)).toBe(false);
  });

  it("counts Quarantine as placed, so unreleased stock never leaks out as a gap", () => {
    // The subtle bug this guards: if the gap were computed from ISSUABLE
    // placements only, a lot sitting in Quarantine would report its whole
    // balance as unlocated and FIFO would then draw it anyway — defeating the
    // exclusion entirely.
    const slices = reachableSlices([at("qc", 10, "Quarantine")], 10, null);
    expect(slices).toEqual([]);
  });

  it("rounds the gap to four places rather than leaking float noise", () => {
    const slices = reachableSlices([at("a", 0.1), at("b", 0.2)], 0.3, null);
    expect(slices.some(s => s.locationId === null)).toBe(false);
  });
});

describe("the location type contract", () => {
  it("every non-issuable type is a real location type", () => {
    for (const t of NON_ISSUABLE_TYPES) {
      expect(LOCATION_TYPES).toContain(t as any);
    }
  });

  it("Quarantine is not issuable and Store is", () => {
    expect(NON_ISSUABLE_TYPES.has("Quarantine")).toBe(true);
    expect(NON_ISSUABLE_TYPES.has("Store")).toBe(false);
  });
});
