import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A PO line the buyer closed short is no longer expected. po-open and the reorder suggestions already honoured that,
 * but Open Purchase Orders, Stock Status "Expected" and the inventory dashboard kept counting the closed remainder
 * (PO-0001 showed 344.00 on order and +688 chicken expected after its line was closed short).
 */
describe("closed PO lines are not counted as expected", () => {
  it("Open Purchase Orders", () => {
    expect(readFileSync("app/api/inventory/procurement-reports/route.ts", "utf8")).toMatch(/l\.closed \? 0 : roundQty/);
  });
  it("Stock Status expected quantity", () => {
    const src = readFileSync("app/api/inventory/reports/route.ts", "utf8");
    expect(src.slice(src.indexOf("async function openOrderQtyByItem"))).toMatch(/!l\.itemId \|\| l\.closed/);
  });
  it("inventory dashboard remaining value", () => {
    const src = readFileSync("app/api/inventory/dashboard/route.ts", "utf8");
    expect(src.slice(src.indexOf("function remainingByDoc"))).toMatch(/if \(l\.closed\) continue/);
  });
});
