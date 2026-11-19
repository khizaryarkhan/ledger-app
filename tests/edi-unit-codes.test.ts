import { describe, it, expect } from "vitest";
import {
  UOMS, PACK_TYPES, UOM_EDI_CODES, PACK_TYPE_EDI_CODES,
  ediUnitCode, normalisePackType, packTypeError, uomError, isKnownOrderUnit, canonicalOrderUnit,
} from "@/lib/inventory/uom";
import { orderOptions, salesOrderOptions, orderUnitFor } from "@/lib/inventory/order-options";

describe("EDI unit code table", () => {
  it("covers every unit and every pack type, so nothing reaches an EDI line unmapped by accident", () => {
    for (const u of UOMS) expect(UOM_EDI_CODES[u.code], `unit ${u.code}`).toBeDefined();
    for (const p of PACK_TYPES) expect(PACK_TYPE_EDI_CODES[p], `pack type ${p}`).toBeDefined();
  });

  it("names no unit or pack type that does not exist", () => {
    const units = new Set(UOMS.map(u => u.code));
    for (const k of Object.keys(UOM_EDI_CODES)) expect(units.has(k), k).toBe(true);
    for (const k of Object.keys(PACK_TYPE_EDI_CODES)) expect(PACK_TYPES.includes(k), k).toBe(true);
  });

  it("explains every missing code instead of leaving a silent gap", () => {
    for (const [k, c] of [...Object.entries(UOM_EDI_CODES), ...Object.entries(PACK_TYPE_EDI_CODES)]) {
      if (c.x12 === null || c.unece === null) expect(c.note, `${k} has a missing code but no reason`).toBeTruthy();
    }
  });

  it("uses the Rec 20 X-form for package types (except 'each', which is a unit)", () => {
    for (const [k, c] of Object.entries(PACK_TYPE_EDI_CODES)) {
      if (k === "each" || c.unece === null) continue;
      expect(c.unece, k).toMatch(/^X[A-Z0-9]{2}$/);
    }
  });

  it("pins the codes read from the published lists", () => {
    expect(UOM_EDI_CODES.kg).toMatchObject({ x12: "KG", unece: "KGM" });
    expect(UOM_EDI_CODES.lb).toMatchObject({ x12: "LB", unece: "LBR" });
    expect(UOM_EDI_CODES.m).toMatchObject({ x12: "MR", unece: "MTR" });
    expect(PACK_TYPE_EDI_CODES.case).toMatchObject({ x12: "CA", unece: "XCS" });
    expect(PACK_TYPE_EDI_CODES.bag).toMatchObject({ x12: "BG", unece: "XBG" });
    expect(PACK_TYPE_EDI_CODES.carton).toMatchObject({ x12: "CT", unece: "XCT" });
  });

  it("never maps the metric tonne to a short ton, or keg to the X12 nail weight", () => {
    expect(UOM_EDI_CODES.mt.x12).toBe("MP");
    expect(["TN", "NS", "MT"]).not.toContain(UOM_EDI_CODES.mt.x12);
    expect(UOM_EDI_CODES.mt.unece).toBe("TNE");
    expect(PACK_TYPE_EDI_CODES.keg.x12).toBeNull();
  });
});

describe("ediUnitCode", () => {
  it("resolves a unit or a pack type in either standard, case- and space-insensitively", () => {
    expect(ediUnitCode("kg", "x12")).toEqual({ ok: true, code: "KG" });
    expect(ediUnitCode(" Case ", "unece")).toEqual({ ok: true, code: "XCS" });
    expect(ediUnitCode("each", "x12")).toEqual({ ok: true, code: "EA" });
  });

  it("refuses rather than guesses, and names the value", () => {
    const inner = ediUnitCode("inner", "x12");
    expect(inner.ok).toBe(false);
    if (inner.ok === false) expect(inner.reason).toContain('"inner"');
    const keg = ediUnitCode("keg", "x12");
    expect(keg.ok).toBe(false);
    if (keg.ok === false) expect(keg.reason).toMatch(/no exact X12 code/);
    expect(ediUnitCode("", "x12").ok).toBe(false);
    expect(ediUnitCode(null, "unece").ok).toBe(false);
  });
});

describe("validation helpers", () => {
  it("normalises known pack types and rejects the rest", () => {
    expect(normalisePackType(" Carton ")).toBe("carton");
    expect(normalisePackType("inner")).toBeNull();
    expect(normalisePackType("Bagz")).toBeNull();
  });

  it("allows an empty value but refuses an unknown one with the valid list", () => {
    expect(packTypeError("", "Inner pack type")).toBeNull();
    expect(packTypeError(null, "Inner pack type")).toBeNull();
    expect(packTypeError("case", "Inner pack type")).toBeNull();
    expect(packTypeError("crate", "Outer pack type")).toMatch(/^Outer pack type "crate" is not a known pack type/);
    expect(uomError("KG", "Base unit")).toBeNull();
    expect(uomError("kilos", "Base unit")).toMatch(/not a known unit/);
  });

  it("accepts a unit or a pack type as an order unit, in canonical form", () => {
    expect(isKnownOrderUnit("kg")).toBe(true);
    expect(isKnownOrderUnit("case")).toBe(true);
    expect(isKnownOrderUnit("outer")).toBe(false);
    expect(canonicalOrderUnit("KG")).toBe("kg");
    expect(canonicalOrderUnit(" Case")).toBe("case");
    expect(canonicalOrderUnit("inner")).toBeNull();
  });
});

describe("order units written to a trade-document line", () => {
  it("stores a pack level with no named container as 'pack', never 'inner' or 'outer'", () => {
    expect(orderUnitFor(null)).toBe("pack");
    expect(orderUnitFor("")).toBe("pack");
    expect(orderUnitFor("Case")).toBe("case");
  });

  it("every option offered for purchase or sale can be translated into an EDI unit code", () => {
    // Packs with NO container names: the case that used to store "inner"/"outer".
    const supplierLink = { id: "l1", supplierId: "s1", supplierUom: "kg", innerUnitPackSize: 25, unitsInOuterPack: 40, innerPackType: null, outerPackType: null };
    const sku = { id: "k1", innerUnitPackSize: 6, unitsInAddlInnerPack: 4, unitsInOuterPack: 10, innerPackType: null, addlInnerPackType: null, outerPackType: null };
    const opts = [...orderOptions("kg", [supplierLink], "s1"), ...salesOrderOptions("each", [sku])];
    expect(opts.length).toBeGreaterThan(4);
    for (const o of opts) {
      expect(isKnownOrderUnit(o.orderUom), `${o.packLevel}: ${o.orderUom}`).toBe(true);
      expect(ediUnitCode(o.orderUom, "x12").ok, `${o.packLevel}: ${o.orderUom}`).toBe(true);
    }
  });
});
