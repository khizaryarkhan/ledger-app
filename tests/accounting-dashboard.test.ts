import { describe, it, expect } from "vitest";
import {
  addDaysYmd, monthToDateWindows, dueWithin, changePct, marginPct, topExpenses, isReconciliationStale,
} from "@/lib/accounting/dashboard";

describe("monthToDateWindows", () => {
  it("compares the same span of last month", () => {
    expect(monthToDateWindows("2026-11-08")).toEqual({
      current: { from: "2026-11-01", to: "2026-11-08" },
      previous: { from: "2026-10-01", to: "2026-10-08" },
    });
  });
  it("clamps to the end of a shorter month", () => {
    expect(monthToDateWindows("2026-03-31").previous).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
  it("wraps January to December of the year before", () => {
    expect(monthToDateWindows("2027-01-15").previous).toEqual({ from: "2026-12-01", to: "2026-12-15" });
  });
});

describe("dueWithin", () => {
  const today = "2026-11-08";
  it("splits overdue from due in the next 30 days, per currency, and ignores later", () => {
    const rows = dueWithin([
      { currency: "EUR", balance: 100, dueDate: "2026-11-01" },
      { currency: "EUR", balance: 50, dueDate: "2026-11-20" },
      { currency: "EUR", balance: 999, dueDate: "2027-01-30" },
      { currency: "USD", balance: 10, dueDate: "2026-12-08" },
    ], today);
    expect(rows).toEqual([
      { currency: "EUR", overdue: 100, next30: 50 },
      { currency: "USD", overdue: 0, next30: 10 },
    ]);
  });
  it("treats a missing due date as due now, and today as not overdue", () => {
    expect(dueWithin([
      { currency: "EUR", balance: 5, dueDate: null },
      { currency: "EUR", balance: 7, dueDate: today },
    ], today)).toEqual([{ currency: "EUR", overdue: 5, next30: 7 }]);
  });
  it("ignores settled and negative balances", () => {
    expect(dueWithin([{ currency: "EUR", balance: 0, dueDate: today }, { currency: "EUR", balance: -3, dueDate: today }], today)).toEqual([]);
  });
});

describe("ratios", () => {
  it("has no change and no margin without a base", () => {
    expect(changePct(10, 0)).toBeNull();
    expect(marginPct(10, 0)).toBeNull();
  });
  it("computes change against a negative base by its size", () => {
    expect(changePct(-50, -100)).toBe(50);
    expect(changePct(150, 100)).toBe(50);
  });
});

describe("topExpenses", () => {
  it("returns the largest positive lines, biggest first", () => {
    const l = (name: string, amount: number) => ({ accountId: name, name, code: null, amount });
    expect(topExpenses([l("a", 5), l("b", -20), l("c", 30), l("d", 10)], 2).map((x) => x.name)).toEqual(["c", "d"]);
  });
});

describe("isReconciliationStale", () => {
  it("is stale when never reconciled or older than 30 days", () => {
    expect(isReconciliationStale(null, "2026-11-08")).toBe(true);
    expect(isReconciliationStale("2026-10-01", "2026-11-08")).toBe(true);
    expect(isReconciliationStale("2026-10-15", "2026-11-08")).toBe(false);
  });
  it("adds days across a year end", () => {
    expect(addDaysYmd("2026-12-25", 10)).toBe("2027-01-04");
  });
});
