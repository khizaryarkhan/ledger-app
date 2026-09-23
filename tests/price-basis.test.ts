import { describe, it, expect } from "vitest";
import { supplierUnitsIn, unitPriceFromQuote, basePriceOf } from "@/lib/inventory/sourcing";
import { orderOptions } from "@/lib/inventory/order-options";

// A supplier price is quoted AT a packaging level (0092) and every other level
// — including ordering by the litre on a PO — is derived from that one figure.
describe("price basis", () => {
  const bottle = { innerUnitPackSize: "30", unitsInOuterPack: "4" };   // 30 L bottle, 4 bottles a case

  it("counts supplier units per level", () => {
    expect(supplierUnitsIn("unit", bottle)).toBe(1);
    expect(supplierUnitsIn("inner", bottle)).toBe(30);
    expect(supplierUnitsIn("outer", bottle)).toBe(120);
    expect(supplierUnitsIn("outer", { innerUnitPackSize: "30" })).toBeNull();   // no case defined
  });

  it("turns a per-bottle quote into a per-litre price", () => {
    expect(unitPriceFromQuote(300, "inner", bottle)).toBe(10);
    expect(unitPriceFromQuote(300, "outer", bottle)).toBe(2.5);
  });

  it("gives the quote back exactly when ordering at the quoted level", () => {
    // 100 per 3-litre bottle is 33.333333… per litre. Through a 6dp unit_price
    // it would come back as 99.999999 per bottle; from the quote it is 100.
    const link = { innerUnitPackSize: "3", quotedPrice: "100", priceBasis: "inner", unitPrice: "33.333333" };
    expect(basePriceOf(link, 1)! * 3).toBeCloseTo(100, 10);
    expect(Number((33.333333 * 3).toFixed(6))).not.toBe(100);   // the loss the quote avoids
  });

  it("prices a PO line by the litre from a per-bottle quote", () => {
    const link = {
      id: "l1", supplierId: "s1", supplierUom: "lt", isPreferred: true,
      innerUnitPackSize: "30", innerPackType: "bottle", unitsInOuterPack: "4", outerPackType: "case",
      quotedPrice: "300", priceBasis: "inner", unitPrice: "10", currency: "PKR",
    };
    const opts = orderOptions("lt", [link], "s1");
    const by = (lvl: string) => opts.find(o => o.packLevel === lvl)!;
    expect(by("base").unitPrice).toBeCloseTo(10, 10);        // 1 litre
    expect(by("inner").unitPrice).toBeCloseTo(300, 10);      // 1 bottle — the quote
    expect(by("outer").unitPrice).toBeCloseTo(1200, 10);     // 1 case of 4 bottles
    expect(by("base").currency).toBe("PKR");
  });

  it("still prices a link that predates 0092 (unit price only)", () => {
    const link = { id: "l1", supplierId: "s1", supplierUom: "kg", unitPrice: "480", isPreferred: true };
    expect(orderOptions("kg", [link], "s1")[0].unitPrice).toBe(480);
  });
});
