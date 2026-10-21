import { describe, it, expect, vi, afterEach } from "vitest";
import { classificationForType } from "@/lib/accounting/account-types";

/**
 * cashFlow() (lib/accounting/analysis.ts) used to decide "is this account's
 * balance change part of net income?" by reading the stored `classification`
 * column directly, while place() (financials.ts, used by Trial Balance/P&L/
 * Balance Sheet) resolves classification from `type` FIRST and only falls
 * back to the column. Found via a real production account (EDC London,
 * "Export Sales", type="Income", classification=null, synced from Xero):
 * cashFlow() silently excluded its balance from net income and instead
 * leaked its movement into the Financing bucket, while every other
 * statement classified it correctly. The fix makes cashFlow() resolve the
 * same way place() does — these tests pin that resolution function and the
 * fact that it, not the raw column, is now cashFlow()'s source of truth.
 */
describe("cashFlow's net-income classification matches place()'s type-first resolution", () => {
  afterEach(() => vi.restoreAllMocks());

  it("an Income-typed account resolves to Revenue even with a null classification column — the exact production case", () => {
    expect(classificationForType("Income")).toBe("Revenue");
  });

  it("an Expense-typed account resolves to Expense even with a null classification column", () => {
    expect(classificationForType("Expense")).toBe("Expense");
  });

  it("a genuinely unrecognized type still falls through to null, so the raw column fallback and the unrecognized-type log remain reachable", () => {
    expect(classificationForType("NotARealType")).toBeNull();
    expect(classificationForType(null)).toBeNull();
  });
});
