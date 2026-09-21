/**
 * Sourcing policy — whether an item must come from a linked supplier
 * (lib/inventory/sourcing.ts).
 *
 * The policy decides two separate things, and conflating them is the bug this
 * pins: whether an unlinked supplier may be used at all, and whether a link may
 * carry pack configuration. They move together for a reason — a pack describes
 * one named vendor's packaging, so an item with no named vendor cannot have
 * one — and nothing else in the codebase may re-derive that pairing by hand.
 */

import { describe, it, expect } from "vitest";
import {
  SOURCING_POLICIES, sourcingOf, allowsAnySupplier, allowsPackConfiguration, pricePerBaseUnit,
} from "@/lib/inventory/sourcing";

describe("sourcingOf", () => {
  it("defaults to restricted, including for anything unrecognised", () => {
    // Fail closed: a typo or a future value must not silently open sourcing up.
    for (const v of [undefined, null, "", "  ", "Open", "OPEN", "unrestricted", "any"]) {
      expect(sourcingOf(v as any).policy).toBe("restricted");
    }
    expect(sourcingOf("open").policy).toBe("open");
    expect(sourcingOf(" open ").policy).toBe("open");
  });

  it("ties pack configuration to having a named supplier", () => {
    // An open item is bought from anyone, so there is no vendor whose packaging
    // a pack could describe. These two flags must never disagree.
    for (const meta of Object.values(SOURCING_POLICIES)) {
      expect(meta.allowsPackConfiguration).toBe(!meta.allowsAnySupplier);
    }
    expect(allowsAnySupplier("open")).toBe(true);
    expect(allowsPackConfiguration("open")).toBe(false);
    expect(allowsAnySupplier("restricted")).toBe(false);
    expect(allowsPackConfiguration("restricted")).toBe(true);
  });
});

describe("pricePerBaseUnit", () => {
  it("divides the quoted price by the units it was quoted in", () => {
    expect(pricePerBaseUnit("480", 1)).toBe(480);         // quoted per kg, stocked in kg
    expect(pricePerBaseUnit("480000", 1000)).toBe(480);   // quoted per tonne, stocked in kg
  });

  it("returns null rather than a figure nobody quoted", () => {
    // A missing price must leave the line alone. Returning 0 would present
    // itself as a real quote of nothing and post a zero-cost receipt.
    for (const p of [null, undefined, "", "abc", 0, "0", -5]) {
      expect(pricePerBaseUnit(p as any, 1)).toBeNull();
    }
    // An unusable conversion is the same situation seen from the other side.
    for (const per of [0, -1, NaN, Infinity]) {
      expect(pricePerBaseUnit("480", per)).toBeNull();
    }
  });

  it("keeps enough precision to survive being divided down and multiplied back", () => {
    // A 12,000 pallet over 500 kg is exact; a 100 sack over 3 kg is not, and
    // rounding it to cents here would lose money on every line. numeric(18,6)
    // is why the column can hold the result.
    expect(pricePerBaseUnit("12000", 500)).toBe(24);
    const third = pricePerBaseUnit("100", 3)!;
    expect(third * 3).toBeCloseTo(100, 10);
  });
});
