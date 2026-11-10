import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { countContra, openingCountError } from "@/lib/inventory/adjustment-rules";

// Opening stock is not a count gain. A gain credits Inventory adjustments (a
// cost-of-sales account), which would overstate the first period's margin by
// the whole value of the stock a company started with.
describe("opening stock", () => {
  const found = [{ itemId: "i1", qty: 10, unitCost: 4 }];

  it("posts against opening equity, an ordinary count against inventory adjustments", () => {
    expect(countContra(true)).toBe("OPENING_EQUITY");
    expect(countContra(false)).toBe("INVENTORY_ADJUSTMENT");
    expect(countContra(undefined)).toBe("INVENTORY_ADJUSTMENT");
  });

  it("an ordinary count is never refused by the opening rule", () => {
    expect(openingCountError({ lines: [{ lotId: "l1", countedQty: 3 }] })).toBeNull();
    expect(openingCountError({ opening: false, found })).toBeNull();
  });

  it("accepts new stock with a quantity and a cost", () => {
    expect(openingCountError({ opening: true, found })).toBeNull();
  });

  it("refuses to change an existing lot as opening stock", () => {
    expect(openingCountError({ opening: true, lines: [{ lotId: "l1", countedQty: 3 }], found })).toMatch(/new stock only/);
  });

  it("refuses opening stock with nothing entered, or with no cost", () => {
    expect(openingCountError({ opening: true })).toMatch(/quantity and unit cost/);
    expect(openingCountError({ opening: true, found: [{ itemId: "i1", qty: 0, unitCost: 4 }] })).toMatch(/quantity and unit cost/);
    expect(openingCountError({ opening: true, found: [{ itemId: "i1", qty: 5, unitCost: 0 }] })).toMatch(/unit cost above zero/);
  });

  // The poster must actually use the rule: with the opening branch removed,
  // opening stock would silently post as a count gain again.
  it("the count poster routes opening stock to opening equity", () => {
    const src = readFileSync(join(process.cwd(), "lib/inventory/adjustments.ts"), "utf8");
    expect(src).toContain("openingCountError(input)");
    expect(src).toContain("openingEquityAccountId(orgId)");
    expect(src).toMatch(/accountId: openingEquity, credit: amount/);
  });
});
