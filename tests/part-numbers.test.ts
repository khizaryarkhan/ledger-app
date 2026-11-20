import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  normalisePartNumber, partNumberKey, preparePartNumberMap, partNumberForLevel, partNumbersByLevel, customerLevels,
} from "@/lib/inventory/part-numbers";

describe("normalisePartNumber", () => {
  it("trims, collapses spaces, and keys case-insensitively", () => {
    expect(normalisePartNumber("  ab  100 ")).toEqual({ ok: true, code: "ab 100", key: "AB 100" });
    expect(partNumberKey("Ab-100")).toBe(partNumberKey("aB-100"));
  });

  it("keeps hyphens and dots, so AB-100 and AB100 stay different codes", () => {
    expect(partNumberKey("AB-100")).not.toBe(partNumberKey("AB100"));
    expect(partNumberKey("1.20")).not.toBe(partNumberKey("120"));
  });

  it("treats blank as none, refuses over-long and control characters", () => {
    expect(normalisePartNumber("   ")).toEqual({ ok: true, code: null, key: null });
    expect(normalisePartNumber("x".repeat(49))).toEqual({ ok: false, error: expect.stringMatching(/at most 48/) });
    expect(normalisePartNumber("AB\u0007100")).toEqual({ ok: false, error: expect.stringMatching(/control characters/) });
  });
});

describe("preparePartNumberMap", () => {
  it("leaves part numbers alone when none were sent", () => {
    expect(preparePartNumberMap(undefined, ["unit"])).toEqual({ ok: true, parts: null });
  });

  it("returns one part per filled level, and an empty set to clear", () => {
    expect(preparePartNumberMap({ unit: "BAG-25", inner: "", outer: "CTN-12" }, ["unit", "inner", "outer"]))
      .toEqual({ ok: true, parts: [{ level: "unit", code: "BAG-25", key: "BAG-25" }, { level: "outer", code: "CTN-12", key: "CTN-12" }] });
    expect(preparePartNumberMap({ unit: "" }, ["unit"])).toEqual({ ok: true, parts: [] });
  });

  it("refuses a level the packaging does not have", () => {
    expect(preparePartNumberMap({ outer: "CTN-12" }, ["unit"])).toEqual({ ok: false, error: expect.stringMatching(/^Outer pack part number: this packaging has no outer pack level/) });
  });

  it("refuses one code on two levels, however it is cased", () => {
    expect(preparePartNumberMap({ unit: "a1", inner: "A1" }, ["unit", "inner"]))
      .toEqual({ ok: false, error: expect.stringMatching(/entered for both the unit and the inner pack/) });
  });
});

describe("partNumberForLevel", () => {
  const byLevel = partNumbersByLevel([{ packLevel: "unit", code: "BAG-25" }, { packLevel: "outer", code: "CTN-12" }, { packLevel: "bogus", code: "X" }]);

  it("maps a document line's pack level onto the link's levels", () => {
    expect(partNumberForLevel(byLevel, "supplier")).toBe("BAG-25");
    expect(partNumberForLevel(byLevel, "base")).toBe("BAG-25");
    expect(partNumberForLevel(byLevel, null)).toBe("BAG-25");
    expect(partNumberForLevel(byLevel, "outer")).toBe("CTN-12");
  });

  it("never quotes the unit's number for a pack that has none of its own", () => {
    expect(partNumberForLevel(byLevel, "inner")).toBeNull();
    expect(partNumberForLevel(byLevel, "addl")).toBeNull();
    expect(partNumberForLevel(byLevel, "pallet")).toBeNull();
  });

  it("drops a stored level it does not recognise", () => {
    expect(Object.keys(byLevel).sort()).toEqual(["outer", "unit"]);
  });
});

describe("customerLevels", () => {
  it("names only the base unit without a sales SKU", () => {
    expect(customerLevels(null)).toEqual(["unit"]);
  });
  it("offers each level the SKU defines", () => {
    expect(customerLevels({ innerUnitPackSize: "6", innerPackType: "Box", unitsInOuterPack: "4", outerPackType: "Case" })).toEqual(["unit", "inner", "outer"]);
    expect(customerLevels({ innerUnitPackSize: "0", innerPackType: "" })).toEqual(["unit"]);
  });
});

describe("migration 0140", () => {
  const sql = readFileSync("db/migrations/0140_part_numbers.sql", "utf8");
  it("makes one partner code mean one thing, and keys it the same way the code does", () => {
    expect(sql).toMatch(/UNIQUE INDEX[^;]+item_part_numbers_partner_code_uq[^;]+\("org_id", "party_id", "side", "code_key"\)/);
    // The copy of supplier_sku builds code_key as trim + collapse spaces + upper, exactly partNumberKey.
    expect(sql).toMatch(/upper\(regexp_replace\(trim\(s\."supplier_sku"\), '\\s\+', ' ', 'g'\)\)/);
  });
});
