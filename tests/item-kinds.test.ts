/**
 * The item kind taxonomy (lib/inventory/item-kinds.ts).
 *
 * These flags are load-bearing: posting routes a debit to an asset or an
 * expense from `tracked`, production refuses a non-`producible` output, the
 * register decides which panels an item even has, and purchasing now refuses a
 * non-`buyable` line. A flag changed carelessly does not fail loudly — it
 * quietly posts to the wrong side of the balance sheet, or hides a panel the
 * user needs.
 *
 * So this file pins the INVARIANTS of the taxonomy rather than restating the
 * table. Each one is an assumption some other module already makes, and would
 * be wrong to break without also changing that module.
 */

import { describe, it, expect } from "vitest";
import { ITEM_KINDS, ITEM_KIND_LIST, kindOf, isTracked, qboItemType } from "@/lib/inventory/item-kinds";

const KINDS = Object.values(ITEM_KINDS);

describe("the taxonomy is internally coherent", () => {
  it("only stock can be produced or consumed", () => {
    // lib/inventory/production.ts creates a lot for the output and relieves
    // lots for the inputs. An untracked kind has no lots, so a build would
    // have nothing to write.
    for (const m of KINDS) {
      if (m.producible) expect(m.tracked, `${m.kind} is producible but not tracked`).toBe(true);
      if (m.consumable) expect(m.tracked, `${m.kind} is consumable but not tracked`).toBe(true);
    }
  });

  it("only stock is lot-tracked by default", () => {
    // A lot is a dated FIFO cost layer. There is nothing to layer for an item
    // that never enters stock.
    for (const m of KINDS) {
      if (m.lotTrackedDefault) expect(m.tracked, `${m.kind} defaults to lots but is not tracked`).toBe(true);
    }
  });

  it("every kind can be transacted at least one way", () => {
    // A kind that can be neither bought, sold, nor produced could never come
    // into existence — it would be an item you can create but never use.
    for (const m of KINDS) {
      expect(m.buyable || m.sellable || m.producible, `${m.kind} can never be acquired`).toBe(true);
    }
  });

  it("Work in Progress is the one kind that is neither bought nor sold", () => {
    // Called out explicitly because it is the case every branch forgets: the
    // Products register opened it to a blank panel, and the purchasing check
    // told the buyer to link a supplier on a panel WIP does not have.
    const internal = KINDS.filter(m => !m.buyable && !m.sellable);
    expect(internal.map(m => m.kind)).toEqual(["WorkInProgress"]);
    expect(ITEM_KINDS.WorkInProgress.producible).toBe(true);
  });

  it("every kind has a distinct code and a label", () => {
    // The code is a badge users read; a duplicate would make two kinds
    // indistinguishable in the register.
    const codes = KINDS.map(m => m.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const m of KINDS) {
      expect(m.label.trim().length).toBeGreaterThan(0);
      expect(m.blurb.trim().length).toBeGreaterThan(0);
    }
  });

  it("lists every kind exactly once, so no kind is unreachable in the UI", () => {
    // ITEM_KIND_LIST drives the type picker and the register's per-kind counts.
    // A kind missing from it exists in the database and nowhere on screen.
    expect(ITEM_KIND_LIST.map(m => m.kind).sort()).toEqual(Object.keys(ITEM_KINDS).sort());
    expect(ITEM_KIND_LIST.length).toBe(new Set(ITEM_KIND_LIST.map(m => m.kind)).size);
  });
});

describe("the Products register has something to show for every kind", () => {
  /**
   * The register's expanded row offers sales SKUs, supplier links, or an
   * explanation. The first two are conditional; the explanation is the
   * remainder, so the panel is exhaustive by construction.
   *
   * This pins the property that made it break before: the fallback used to be
   * hand-written as `!tracked && !buyable`, which no kind satisfies — both
   * untracked kinds are buyable — so Work in Progress matched nothing at all
   * and the explanation was unreachable for everything.
   */
  it("no kind falls through every panel", () => {
    for (const m of KINDS) {
      const showsSkus = m.sellable && m.tracked;
      const showsSuppliers = m.buyable;
      const showsExplanation = !showsSkus && !showsSuppliers;
      expect(showsSkus || showsSuppliers || showsExplanation, `${m.kind} renders nothing`).toBe(true);
    }
  });

  it("the old hand-written fallback really was unreachable", () => {
    // Kept as evidence, so nobody reinstates the simpler-looking condition.
    expect(KINDS.filter(m => !m.tracked && !m.buyable)).toEqual([]);
  });
});

describe("kindOf", () => {
  it("falls back to Finished Product for anything unrecognised", () => {
    // Legacy rows predate product_type; CLAUDE.md records the default.
    for (const v of [undefined, null, "", "Widget", "finishedproduct"]) {
      expect(kindOf(v as any).kind).toBe("FinishedProduct");
    }
    expect(kindOf("RawMaterial").kind).toBe("RawMaterial");
  });

  it("isTracked agrees with the table for every kind", () => {
    for (const m of KINDS) expect(isTracked(m.kind)).toBe(m.tracked);
  });

  it("maps every kind onto a QBO item type", () => {
    // Kept in sync for reporting; an unmapped kind would export as the wrong
    // thing rather than fail.
    for (const m of KINDS) {
      expect(["Service", "Non-Inventory", "Inventory"]).toContain(qboItemType(m.kind));
    }
    expect(qboItemType("Service")).toBe("Service");
    expect(qboItemType("NonInventory")).toBe("Non-Inventory");
    expect(qboItemType("RawMaterial")).toBe("Inventory");
  });
});
