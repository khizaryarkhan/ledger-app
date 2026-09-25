import { describe, it, expect } from "vitest";
import { defaultTradeFlags, itemCanBeSold, itemCanBePurchased, ITEM_KIND_LIST } from "@/lib/inventory/item-kinds";

// Per-item "can be sold" / "can be purchased" (spec R-07).
describe("per-item selling and buying switches", () => {
  it("new items default as the spec says", () => {
    expect(defaultTradeFlags("RawMaterial")).toEqual({ canBeSold: false, canBePurchased: true });
    expect(defaultTradeFlags("WorkInProgress")).toEqual({ canBeSold: false, canBePurchased: false });
    expect(defaultTradeFlags("FinishedProduct")).toEqual({ canBeSold: true, canBePurchased: false });
    expect(defaultTradeFlags("StockItem")).toEqual({ canBeSold: true, canBePurchased: true });
    expect(defaultTradeFlags("Service")).toEqual({ canBeSold: true, canBePurchased: true });
  });

  it("an item made before the switches (null) behaves exactly as its kind always did", () => {
    for (const k of ITEM_KIND_LIST) {
      expect(itemCanBeSold({ productType: k.kind, canBeSold: null })).toBe(k.sellable);
      expect(itemCanBePurchased({ productType: k.kind, canBePurchased: null })).toBe(k.buyable);
    }
  });

  it("an explicit switch wins over the kind — surplus raw material sold, a finished product bought in", () => {
    expect(itemCanBeSold({ productType: "RawMaterial", canBeSold: true })).toBe(true);
    expect(itemCanBePurchased({ productType: "FinishedProduct", canBePurchased: true })).toBe(true);
    expect(itemCanBeSold({ productType: "FinishedProduct", canBeSold: false })).toBe(false);
  });
});
