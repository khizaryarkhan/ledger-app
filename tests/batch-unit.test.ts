import { describe, it, expect } from "vitest";
import { batchUnitError, batchToBase, batchFromBase, unitGroups } from "@/lib/inventory/batch-unit";

describe("batch unit", () => {
  it("offers every unit the app knows, grouped by what it measures", () => {
    const g = unitGroups();
    expect(g.map(x => x.dimension)).toEqual(["mass", "volume", "count", "length"]);
    expect(g.flatMap(x => x.units).length).toBeGreaterThanOrEqual(24);
  });

  it("accepts any unit that measures the same thing as the item's base unit", () => {
    expect(batchUnitError("kg", "g")).toBeNull();
    expect(batchUnitError("kg", "lb")).toBeNull();
    expect(batchUnitError("each", "dozen")).toBeNull();
    expect(batchUnitError("lt", "ml")).toBeNull();
    expect(batchUnitError("kg", null)).toBeNull();
  });

  it("refuses a unit from another dimension rather than guess a factor", () => {
    expect(batchUnitError("kg", "each")).toMatch(/weight unit/i);
    expect(batchUnitError("each", "kg")).toMatch(/count unit/i);
    expect(batchUnitError("kg", "furlong")).toMatch(/not a unit/i);
  });

  it("stores the batch in the base unit and shows it back in the chosen one", () => {
    expect(batchToBase(400000, "kg", "g")).toBe(400);
    expect(batchFromBase(400, "kg", "g")).toBe(400000);
    expect(batchToBase(2, "each", "dozen")).toBe(24);
    expect(batchFromBase(24, "each", "dozen")).toBe(2);
  });

  it("changes nothing when there is no unit or it equals the base", () => {
    expect(batchToBase(500, "kg", null)).toBe(500);
    expect(batchToBase(500, "kg", "KG")).toBe(500);
    expect(batchFromBase(500, "kg", null)).toBe(500);
  });
});
