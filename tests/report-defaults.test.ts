import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Period reports open on the organisation's own fiscal year (as the statements do), never a hardcoded 1 January
 * or 1 July, and take "today" from the viewer's clock rather than UTC. The Trial Balance lists accounts in the
 * conventional order (assets, liabilities, equity, income, expenses), not by code with uncoded accounts first.
 */
describe("report parameter defaults", () => {
  const files = [
    "components/cash-flow-report.tsx", "components/finance-reports.tsx", "components/credits-adjustments-report.tsx",
    "components/delivery-performance-report.tsx", "components/production-performance-report.tsx",
    "app/(app)/accounting/reports/general-ledger/page.tsx",
  ];
  for (const f of files) {
    it(`${f} defaults From to the fiscal year start`, () => {
      const src = readFileSync(f, "utf8");
      expect(src).toMatch(/useFiscalFrom\(/);
      expect(src).not.toMatch(/-01-01`/);
      expect(src).not.toMatch(/-07-01/);
    });
  }
  it("the statements page and the General Ledger take today from the local clock", () => {
    for (const f of ["app/(app)/accounting/reports/[statement]/page.tsx", "app/(app)/accounting/reports/general-ledger/page.tsx"]) {
      expect(readFileSync(f, "utf8")).not.toMatch(/new Date\(\)\.toISOString\(\)\.slice\(0, 10\)/);
    }
  });
  it("the Trial Balance orders accounts by type before code", () => {
    const src = readFileSync("lib/accounting/financials.ts", "utf8");
    expect(src).toMatch(/tbRank\(a\.type, a\.classification\) - tbRank\(b\.type, b\.classification\)/);
  });
});
