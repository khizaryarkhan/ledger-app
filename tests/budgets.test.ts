import { describe, it, expect } from "vitest";
import {
  accountKind, isBudgetableAccount, computeVariance, buildVarianceRows, summariseProfit,
  monthsInRange, allMonths, flattenPl, seedLinesFromActuals, parseAmount, rowTotal, monthSpan,
} from "@/lib/accounting/budgets";

describe("accountKind / isBudgetableAccount", () => {
  it("income types are income, everything else expense", () => {
    expect(accountKind("Income", "Revenue")).toBe("income");
    expect(accountKind("Other Income", null)).toBe("income");
    expect(accountKind("Expense", "Expense")).toBe("expense");
    expect(accountKind("Cost of Goods Sold", null)).toBe("expense");
  });
  it("falls back to classification for an unknown type", () => {
    expect(accountKind("Weird", "Revenue")).toBe("income");
    expect(accountKind("Weird", null)).toBe("expense");
  });
  it("only P&L, non-header accounts are budgetable", () => {
    expect(isBudgetableAccount({ type: "Income" })).toBe(true);
    expect(isBudgetableAccount({ type: "Bank" })).toBe(false);
    expect(isBudgetableAccount({ type: "Expense", isHeader: true })).toBe(false);
  });
});

describe("computeVariance", () => {
  it("income over budget is favourable", () => {
    const v = computeVariance(100, 120, "income");
    expect(v.variance).toBe(20); expect(v.pct).toBe(20); expect(v.favourable).toBe(true);
  });
  it("income under budget is unfavourable", () => {
    expect(computeVariance(100, 80, "income").favourable).toBe(false);
  });
  it("expense over budget is unfavourable, under is favourable", () => {
    expect(computeVariance(100, 130, "expense").favourable).toBe(false);
    expect(computeVariance(100, 70, "expense")).toMatchObject({ variance: -30, pct: -30, favourable: true });
  });
  it("no budget gives null pct; both zero gives nothing to judge", () => {
    expect(computeVariance(0, 50, "expense")).toMatchObject({ pct: null, favourable: false });
    expect(computeVariance(0, 0, "income").favourable).toBeNull();
  });
  it("exactly on budget is not an exception", () => {
    expect(computeVariance(100, 100, "expense").favourable).toBe(true);
  });
});

describe("months", () => {
  it("builds 12 calendar months with leap-year February", () => {
    expect(allMonths(2024)).toHaveLength(12);
    expect(monthSpan(2024, 2).to).toBe("2024-02-29");
    expect(monthSpan(2025, 2).to).toBe("2025-02-28");
  });
  it("monthsInRange snaps to whole months", () => {
    const ms = monthsInRange(2026, "2026-02-15", "2026-04-02").map((m) => m.month);
    expect(ms).toEqual([2, 3, 4]);
  });
  it("a range outside the year gives no months", () => {
    expect(monthsInRange(2026, "2025-01-01", "2025-12-31")).toEqual([]);
  });
});

describe("buildVarianceRows", () => {
  const accounts = [
    { id: "rev", name: "Sales", code: "4000", type: "Income", classification: "Revenue" },
    { id: "rent", name: "Rent", code: "6000", type: "Expense", classification: "Expense" },
    { id: "idle", name: "Idle", code: "6100", type: "Expense", classification: "Expense" },
  ];
  const lines = [
    { accountId: "rev", month: 1, amount: 100 }, { accountId: "rev", month: 2, amount: 100 },
    { accountId: "rent", month: 1, amount: 50 }, { accountId: "rent", month: 2, amount: 50 },
  ];
  const actuals = [
    { accountId: "rev", month: 1, amount: 90 }, { accountId: "rev", month: 2, amount: 130 },
    { accountId: "rent", month: 1, amount: 60 }, { accountId: "rent", month: 3, amount: 999 },
  ];
  it("totals only the chosen months and drops empty accounts", () => {
    const rows = buildVarianceRows(accounts, lines, actuals, [1, 2]);
    expect(rows.map((r) => r.accountId)).toEqual(["rev", "rent"]);
    expect(rows[0].total).toMatchObject({ budget: 200, actual: 220, variance: 20, favourable: true });
    expect(rows[0].months[1].favourable).toBe(false);
    expect(rows[1].total).toMatchObject({ budget: 100, actual: 60, favourable: true });
  });
  it("summarises profit: income minus expense", () => {
    const p = summariseProfit(buildVarianceRows(accounts, lines, actuals, [1, 2]));
    expect(p).toMatchObject({ budget: 100, actual: 160, variance: 60, favourable: true });
  });
});

describe("flattenPl / seed / parse", () => {
  it("flattens every section by account id and skips synthetic lines", () => {
    const m = flattenPl({
      sections: [{ lines: [{ accountId: "a", amount: 10 }] }, { lines: [{ accountId: "b", amount: 5 }] }],
      otherIncome: { lines: [{ accountId: "c", amount: 1 }] },
      operatingExpenses: { lines: [{ accountId: "a", amount: 2.5 }, { accountId: null, amount: 9 }] },
      financeCosts: { lines: [] }, taxation: { lines: [] },
    });
    expect(m.get("a")).toBe(12.5); expect(m.get("c")).toBe(1); expect(m.size).toBe(3);
  });
  it("seeds from actuals with optional uplift, skipping zeros", () => {
    const s = seedLinesFromActuals([{ accountId: "a", month: 1, amount: 100 }, { accountId: "a", month: 2, amount: 0 }], 10);
    expect(s).toEqual([{ accountId: "a", month: 1, amount: 110 }]);
  });
  it("parseAmount never returns NaN", () => {
    expect(parseAmount("1,234.567")).toBe(1234.57);
    expect(parseAmount("abc")).toBe(0);
    expect(parseAmount(null)).toBe(0);
    expect(rowTotal({ 1: 1.1, 2: 2.2 })).toBe(3.3);
  });
});
