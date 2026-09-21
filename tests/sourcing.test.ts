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
  sourcingViolations, SOURCING_ENFORCED_TYPES,
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

describe("sourcingViolations", () => {
  const items = new Map<string, any>([
    ["yarn",  { id: "yarn",  name: "Cotton Yarn 24s", sourcingPolicy: "restricted" }],
    ["dye",   { id: "dye",   name: "Reactive Dye",    sourcingPolicy: "restricted" }],
    ["consult", { id: "consult", name: "Consulting",  sourcingPolicy: "open" }],
  ]);
  const linkedToA = new Set(["yarn"]);

  it("passes an item this supplier is linked to", () => {
    expect(sourcingViolations([{ itemId: "yarn" }], items, linkedToA)).toEqual([]);
  });

  it("flags a restricted item this supplier is not linked to", () => {
    const v = sourcingViolations([{ itemId: "dye" }], items, linkedToA, "Karachi Dyes");
    expect(v).toHaveLength(1);
    expect(v[0].itemId).toBe("dye");
    // The message has to say how to fix it — a bare refusal leaves the buyer
    // with a blocked order and no next step.
    expect(v[0].message).toContain("Reactive Dye");
    expect(v[0].message).toContain("Karachi Dyes");
    expect(v[0].message).toContain("Suppliers panel");
  });

  it("always passes an open item, from any supplier", () => {
    expect(sourcingViolations([{ itemId: "consult" }], items, new Set())).toEqual([]);
  });

  it("flags every restricted item, not just the first", () => {
    // Fixing a multi-line order one refusal at a time is several round trips
    // through a form that clears itself.
    const more = new Map(items);
    more.set("thread", { id: "thread", name: "Thread", sourcingPolicy: "restricted" });
    const v = sourcingViolations([{ itemId: "dye" }, { itemId: "thread" }, { itemId: "yarn" }], more, linkedToA);
    expect(v.map(x => x.itemId)).toEqual(["dye", "thread"]);
  });

  it("reports one item once however many lines name it", () => {
    const v = sourcingViolations([{ itemId: "dye" }, { itemId: "dye" }, { itemId: "dye" }], items, linkedToA);
    expect(v).toHaveLength(1);
  });

  it("ignores lines with no item — an expense line has nothing to source", () => {
    expect(sourcingViolations([{ itemId: null }, { itemId: "" }, {}], items, new Set())).toEqual([]);
  });

  it("skips an item it cannot see rather than guessing", () => {
    // Another tenant's id, or a stale one. The document's own validation owns
    // that failure; inventing a sourcing complaint would mislabel it.
    expect(sourcingViolations([{ itemId: "ghost" }], items, new Set())).toEqual([]);
  });

  it("flags everything restricted when no supplier is named", () => {
    // Nobody to be linked to, so nothing restricted can be sourced.
    const v = sourcingViolations([{ itemId: "yarn" }, { itemId: "consult" }], items, new Set(), null);
    expect(v.map(x => x.itemId)).toEqual(["yarn"]);
    expect(v[0].message).toContain("this supplier");
  });

  it("treats an unrecognised policy as restricted", () => {
    const odd = new Map([["x", { id: "x", name: "Odd", sourcingPolicy: "whatever" }]]);
    expect(sourcingViolations([{ itemId: "x" }], odd, new Set())).toHaveLength(1);
  });
});

describe("SOURCING_ENFORCED_TYPES", () => {
  it("binds every document that acquires goods, not just the purchase order", () => {
    // A Bill with tracked items posts Dr Inventory and creates lots with no PO
    // anywhere, so a PO-only rule would be bypassable by choosing another form.
    for (const t of ["PurchaseOrder", "Bill", "Expense"]) expect(SOURCING_ENFORCED_TYPES.has(t)).toBe(true);
  });

  it("leaves returns and sales documents alone", () => {
    // A VendorCredit reduces what is owed for goods already received; blocking
    // it would strand a legitimate return once a link is tidied away.
    for (const t of ["VendorCredit", "Invoice", "SalesOrder", "Estimate", "CreditNote", "Payment", "BillPayment"]) {
      expect(SOURCING_ENFORCED_TYPES.has(t)).toBe(false);
    }
  });
});

describe("sourcingViolations — kinds that cannot be purchased", () => {
  // Work in Progress is tracked but neither bought nor sold. Before this, the
  // check treated it as an ordinary unlinked item and told the buyer to "link
  // it on the item's Suppliers panel" — a panel WIP does not have and never
  // will, because the register only shows one for buyable kinds.
  const wip = new Map<string, any>([["wip", { id: "wip", name: "Grey Fabric", sourcingPolicy: "restricted", productType: "WorkInProgress" }]]);

  it("says the item cannot be purchased, not that it needs linking", () => {
    const v = sourcingViolations([{ itemId: "wip" }], wip, new Set(), "Karachi Dyes");
    expect(v).toHaveLength(1);
    expect(v[0].message).toContain("cannot be purchased");
    expect(v[0].message).toContain("production build");
    expect(v[0].message).not.toContain("Suppliers panel");
  });

  it("still refuses it even when a link somehow exists", () => {
    // A link predating a type change must not make an unbuyable kind buyable.
    expect(sourcingViolations([{ itemId: "wip" }], wip, new Set(["wip"]))).toHaveLength(1);
  });

  it("still refuses it even when the item is marked open", () => {
    const open = new Map([["wip", { id: "wip", name: "Grey Fabric", sourcingPolicy: "open", productType: "WorkInProgress" }]]);
    expect(sourcingViolations([{ itemId: "wip" }], open, new Set())).toHaveLength(1);
  });

  it("leaves buyable kinds to the ordinary link rule", () => {
    const rm = new Map([["y", { id: "y", name: "Yarn", sourcingPolicy: "restricted", productType: "RawMaterial" }]]);
    expect(sourcingViolations([{ itemId: "y" }], rm, new Set(["y"]))).toEqual([]);
    expect(sourcingViolations([{ itemId: "y" }], rm, new Set())[0].message).toContain("Suppliers panel");
  });

  it("treats a missing productType as the legacy Finished Product default", () => {
    // Rows predating product_type must not all become unpurchasable.
    const legacy = new Map([["l", { id: "l", name: "Legacy", sourcingPolicy: "open" }]]);
    expect(sourcingViolations([{ itemId: "l" }], legacy, new Set())).toEqual([]);
  });
});
