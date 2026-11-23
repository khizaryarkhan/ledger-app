import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The P&L and the "profit to close" sum both leave year-end Closing entries out. Reopening a period reverses the
 * Closing entry, and that reversal must be left out too: counting it re-credits revenue the sum never saw closed
 * (found in Test Organization: sales 2,860.00 on the P&L against 1,655.00 on the trial balance).
 */
describe("a reversed year-end close does not leak into the P&L", () => {
  const filter = readFileSync("lib/accounting/closing-filter.ts", "utf8");
  it("excludes entries that reverse a Closing entry", () => {
    expect(filter).toMatch(/reversesEntryId/);
    expect(filter).toMatch(/source_type = 'Closing'/);
  });
  for (const f of ["lib/accounting/financials.ts", "lib/accounting/period-close.ts"]) {
    it(`${f} applies it next to the Closing exclusion`, () => {
      const src = readFileSync(f, "utf8");
      expect(src).toMatch(/ne\(journalEntries\.sourceType, "Closing"\),\s*notReversalOfClosing/);
    });
  }
});
