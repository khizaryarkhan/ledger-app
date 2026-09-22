import { describe, it, expect } from "vitest";
import { classifyBarcode, showBarcode } from "@/lib/inventory/identifiers";

// classifyBarcode is the rule every barcode field and the API share. The case
// it exists for: a GTIN with one digit wrong must be REFUSED, not filed as an
// "other" barcode, where it would silently never match the real box.
describe("classifyBarcode", () => {
  it("stores every GTIN length as GTIN-14", () => {
    expect(classifyBarcode("9501101530003")).toEqual({ ok: true, barcode: { scheme: "GTIN", code: "09501101530003" } });
    expect(classifyBarcode("0360 0029 1452")).toEqual({ ok: true, barcode: { scheme: "GTIN", code: "00036000291452" } });
  });

  it("refuses a GTIN-shaped code with a wrong check digit", () => {
    const r = classifyBarcode("9501101530004");
    expect(r.ok).toBe(false);
  });

  it("keeps a non-GS1 code as entered", () => {
    expect(classifyBarcode("YRN-24S-CONE")).toEqual({ ok: true, barcode: { scheme: "OTHER", code: "YRN-24S-CONE" } });
    expect(classifyBarcode("12345")).toEqual({ ok: true, barcode: { scheme: "OTHER", code: "12345" } });
  });

  it("treats blank as no barcode", () => {
    expect(classifyBarcode("  ")).toEqual({ ok: true, barcode: null });
  });

  it("shows a stored GTIN in its shortest standard form", () => {
    expect(showBarcode({ scheme: "GTIN", code: "09501101530003" })).toBe("9501101530003");
    expect(showBarcode({ scheme: "OTHER", code: "0001" })).toBe("0001");
  });
});
