import { describe, it, expect, vi, afterEach } from "vitest";
import { place } from "@/lib/accounting/financials";

/**
 * place() is the one function that decides which statement, section and
 * normal-balance side every account lands in — the real "wiring" between the
 * Chart of Accounts and the Trial Balance/P&L/Balance Sheet. A gap here
 * doesn't throw; it silently misclassifies an account (see the Xero
 * PAYGLIABILITY/SUPERANNUATIONLIABILITY bug this file's sibling test,
 * xero-account-types.test.ts, pins). These assertions are about the
 * fallback's VISIBILITY, not about making the fallback disappear — a
 * provider can still send a type this app's taxonomy doesn't recognize, but
 * it must no longer do so quietly.
 */
describe("financials.place — the Chart-of-Accounts-to-statement wiring", () => {
  afterEach(() => vi.restoreAllMocks());

  it("places every one of the 15 canonical account types without logging anything", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cases: [string, string][] = [
      ["Bank", "Current Assets"], ["Accounts Receivable", "Current Assets"], ["Fixed Asset", "Non-current Assets"],
      ["Accounts Payable", "Current Liabilities"], ["Long Term Liability", "Non-current Liabilities"],
      ["Equity", "Equity"], ["Income", "Revenue"], ["Cost of Goods Sold", "Cost of Sales"], ["Expense", "Operating Expenses"],
    ];
    for (const [type, section] of cases) expect(place(type, null).section).toBe(section);
    expect(spy).not.toHaveBeenCalled();
  });

  it("falls back on classification alone (still correct) without logging — a recognized classification is not the bug", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(place(null, "Liability")).toEqual({ statement: "balance_sheet", section: "Current Liabilities", normal: "credit" });
    expect(place(null, "Equity")).toEqual({ statement: "balance_sheet", section: "Equity", normal: "credit" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("logs loudly — does not silently swallow — when BOTH type and classification are unrecognized", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const result = place("PAYGLIABILITY", null); // the exact raw string a pre-fix Xero sync could have written
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toMatch(/unrecognized account type/);
    // The fallback result itself is unchanged (still a best-effort default) —
    // this test is about the log appearing, not about changing the shape.
    expect(result).toEqual({ statement: "balance_sheet", section: "Current Assets", normal: "debit" });
  });

  it("a null type with a null classification also logs (nothing to go on at all)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    place(null, null);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
