import { describe, it, expect } from "vitest";
import { normaliseGtin, gs1CheckDigit, displayGtin, parseGs1, buildGs1, gs1DateToIso, GS } from "@/lib/gs1";

// Reference values are GS1's own examples (General Specifications / GS1 check
// digit calculator), not numbers derived from the code under test.
describe("GTIN", () => {
  it("computes the GS1 mod-10 check digit", () => {
    expect(gs1CheckDigit("950110153000")).toBe(3);        // 9501101530003 (GS1 example EAN-13)
    expect(gs1CheckDigit("0001234560001")).toBe(2);       // GTIN-14 example
    expect(gs1CheckDigit("03600029145")).toBe(2);         // UPC-A 036000291452
  });

  it("normalises every GTIN length to 14 digits, so the same item is the same number", () => {
    expect(normaliseGtin("9501101530003")).toEqual({ ok: true, gtin14: "09501101530003", format: "GTIN-13" });
    expect(normaliseGtin("036000291452")).toEqual({ ok: true, gtin14: "00036000291452", format: "GTIN-12" });
    expect(normaliseGtin("9638-5074")).toEqual({ ok: true, gtin14: "00000096385074", format: "GTIN-8" });
    expect(normaliseGtin(" 09501101530003 ")).toMatchObject({ ok: true, gtin14: "09501101530003" });
  });

  it("refuses a mistyped GTIN and names the right check digit", () => {
    const r = normaliseGtin("9501101530004");
    expect(r.ok).toBe(false);
    expect((r as any).error).toContain("should be 3");
    expect(normaliseGtin("12345").ok).toBe(false);
    expect(normaliseGtin("95011O1530003").ok).toBe(false);   // letter O, not zero
  });

  it("prints a GTIN in its shortest standard form", () => {
    expect(displayGtin("09501101530003")).toBe("9501101530003");
    expect(displayGtin("00036000291452")).toBe("036000291452");
    expect(displayGtin("10095011015300")).toBe("10095011015300");
  });
});

describe("GS1 dates", () => {
  it("reads DD=00 as the last day of the month", () => {
    expect(gs1DateToIso("260200", 2026)).toBe("2026-02-28");
    expect(gs1DateToIso("280200", 2026)).toBe("2028-02-29");
  });
  it("applies the GS1 century window", () => {
    expect(gs1DateToIso("991231", 2026)).toBe("1999-12-31");   // 73 years ahead → last century
    expect(gs1DateToIso("701231", 2026)).toBe("2070-12-31");   // 44 years ahead → this century
    expect(gs1DateToIso("261340", 2026)).toBeNull();
  });
});

describe("GS1-128 element strings", () => {
  it("parses a raw scan with separators and a symbology prefix", () => {
    const scan = `]C101095011015300031726123110AB-12${GS}3712`;
    const p = parseGs1(scan, { nowYear: 2026 });
    expect(p.errors).toEqual([]);
    expect(p).toMatchObject({ gtin: "09501101530003", expiry: "2026-12-31", batch: "AB-12", count: 12 });
  });

  it("parses the human-readable form printed under the bars", () => {
    const p = parseGs1("(01)09501101530003(11)260915(15)270300(10)L2401", { nowYear: 2026 });
    expect(p).toMatchObject({ gtin: "09501101530003", productionDate: "2026-09-15", bestBefore: "2027-03-31", batch: "L2401" });
  });

  it("reads a measure with its decimal places from the 4th AI digit", () => {
    expect(parseGs1("01095011015300033102001250", { nowYear: 2026 }).netWeightKg).toBe(12.5);
  });

  it("reports an unknown AI instead of mis-splitting the rest", () => {
    const p = parseGs1("0109501101530003991234", { nowYear: 2026 });
    expect(p.gtin).toBe("09501101530003");
    expect(p.errors[0]).toContain("Unknown Application Identifier");
  });

  it("rejects a GTIN with a bad check digit inside a scan", () => {
    expect(parseGs1("0109501101530004").errors[0]).toContain("Check digit");
  });

  it("builds fixed fields first, variable last, and round-trips through the parser", () => {
    const label = { gtin: "9501101530003", expiry: "2026-12-31", productionDate: "2026-09-15", batch: "L2401", serial: "S9" };
    const b = buildGs1(label);
    expect(b.hri).toBe("(01)09501101530003(11)260915(17)261231(10)L2401(21)S9");
    // GS only BETWEEN variable fields: the fixed ones end themselves, and the
    // last field is ended by the end of the symbol.
    expect(b.data).toBe("01" + "09501101530003" + "11" + "260915" + "17" + "261231" + "10" + "L2401" + GS + "21" + "S9");
    const back = parseGs1(b.data, { nowYear: 2026 });
    expect(back).toMatchObject({ gtin: "09501101530003", expiry: "2026-12-31", productionDate: "2026-09-15", batch: "L2401", serial: "S9" });
    expect(back.errors).toEqual([]);
  });

  it("refuses to build a label that would not scan", () => {
    expect(() => buildGs1({ gtin: "9501101530004" })).toThrow(/Check digit/);
    expect(() => buildGs1({ gtin: "9501101530003", batch: "lot #1 é" })).toThrow(/cannot carry/);
    expect(() => buildGs1({ batch: "X".repeat(21) })).toThrow(/longer than 20/);
  });
});
