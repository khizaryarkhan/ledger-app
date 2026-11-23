import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

// Converting an estimate to an invoice sent each line to the ledger as an amount
// only. The posting engine issues stock and books cost of sales only for a line
// that carries a quantity, so a stocked item was sold without leaving stock:
// revenue with no cost of sales and inventory overstated. Found in a buyer
// evaluation (INV-0004 from EST-0001). No database here, so this pins the wiring.
const src = readFileSync(join(__dirname, "..", "lib", "accounting", "trade-documents.ts"), "utf8");
const conv = src.slice(src.indexOf("export async function convertTradeDoc"));

describe("estimate / PO conversion carries quantity", () => {
  it("passes qty, rate and the order-unit factor to the posting engine", () => {
    const post = conv.slice(conv.indexOf("await postDocument"), conv.indexOf("// Advance each line's invoiced amount"));
    expect(post).toContain("qty");
    expect(post).toContain("rate:");
    expect(post).toContain("unitsPerOrderUnit");
  });

  it("scales the quantity by the share of the line being invoiced", () => {
    expect(conv).toMatch(/lineQty \* \(t\.net \/ lineAmt\)/);
  });
});
