import { describe, it, expect } from "vitest";
import { parsePartList } from "@/lib/inventory/part-numbers-bulk";

describe("a pasted customer part-number list", () => {
  it("reads a spreadsheet copy (tabs), keeping commas inside an item name", () => {
    const { rows, problems } = parsePartList("Salt, fine\tAB-1\nPEANUT-CASE\tAB-2\touter");
    expect(problems).toEqual([]);
    expect(rows).toEqual([{ line: 1, ref: "Salt, fine", code: "AB-1", level: "unit" }, { line: 2, ref: "PEANUT-CASE", code: "AB-2", level: "outer" }]);
  });
  it("skips a header row and blank lines but keeps true line numbers", () => {
    const { rows } = parsePartList("Item,Their part number\n\nSalt,AB-1");
    expect(rows).toEqual([{ line: 3, ref: "Salt", code: "AB-1", level: "unit" }]);
  });
  it("reports a line it cannot read, with its number, and keeps the rest", () => {
    const { rows, problems } = parsePartList("Salt,AB-1\nSugar\nFlour,AB-3,pallet");
    expect(rows).toHaveLength(1);
    expect(problems.map(p => p.line)).toEqual([2, 3]);
  });
  it("refuses a part number longer than the limit", () => {
    expect(parsePartList("Salt," + "X".repeat(49)).problems).toHaveLength(1);
  });
  it("reads a quoted comma inside a comma list", () => {
    expect(parsePartList('"Salt, fine",AB-1').rows[0].ref).toBe("Salt, fine");
  });
});
