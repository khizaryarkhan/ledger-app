/**
 * Due-date bucketing and the board/invoice status filters.
 *
 * These drive what a collections team sees every morning, and the calendar
 * windows overlap the single buckets, which is easy to get wrong. Dates are
 * built relative to "now" so the suite can't rot into passing on a fixed date.
 */
import { describe, it, expect } from "vitest";
import { getDueStatus, matchesDueFilter, getAgingBucket, DUE_FILTERS, DUE_FILTERS_OPEN } from "@/lib/format";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const shift = (days: number) => { const d = new Date(); d.setDate(d.getDate() + days); return ymd(d); };
const endOfWeek = () => { const d = new Date(); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); return ymd(d); };
const endOfMonth = () => { const n = new Date(); return ymd(new Date(n.getFullYear(), n.getMonth() + 1, 0)); };

const inv = (dueDate: string, paymentStatus = "Unpaid") => ({ dueDate, paymentStatus });

describe("getDueStatus puts an invoice in exactly one bucket", () => {
  it("classifies by due date", () => {
    expect(getDueStatus(inv(shift(-5)))).toBe("Overdue");
    expect(getDueStatus(inv(shift(0)))).toBe("Due Today");
    expect(getDueStatus(inv(shift(3)))).toBe("Due Soon");
    expect(getDueStatus(inv(shift(60)))).toBe("Not Due");
  });

  it("lets settlement status win over the date", () => {
    expect(getDueStatus(inv(shift(-30), "Paid"))).toBe("Paid");
    expect(getDueStatus(inv(shift(-30), "Written Off"))).toBe("Written Off");
  });
});

describe("matchesDueFilter — calendar windows", () => {
  it("counts an invoice due today in both windows", () => {
    expect(matchesDueFilter(inv(shift(0)), "Due This Week")).toBe(true);
    expect(matchesDueFilter(inv(shift(0)), "Due This Month")).toBe(true);
  });

  it("includes the last day of the window and excludes the day after", () => {
    expect(matchesDueFilter(inv(endOfWeek()), "Due This Week")).toBe(true);
    expect(matchesDueFilter(inv(endOfMonth()), "Due This Month")).toBe(true);
    // A date past month end can never be "due this month".
    expect(matchesDueFilter(inv(shift(40)), "Due This Month")).toBe(false);
  });

  it("excludes overdue invoices — Overdue is their bucket, not a due window", () => {
    expect(matchesDueFilter(inv(shift(-1)), "Due This Week")).toBe(false);
    expect(matchesDueFilter(inv(shift(-1)), "Due This Month")).toBe(false);
    expect(matchesDueFilter(inv(shift(-1)), "Overdue")).toBe(true);
  });

  it("excludes settled invoices from the windows", () => {
    expect(matchesDueFilter(inv(shift(0), "Paid"), "Due This Week")).toBe(false);
    expect(matchesDueFilter(inv(shift(0), "Written Off"), "Due This Month")).toBe(false);
  });

  it("ignores invoices with no due date rather than guessing", () => {
    expect(matchesDueFilter({ dueDate: null, paymentStatus: "Unpaid" }, "Due This Week")).toBe(false);
  });

  it("treats an empty filter as 'no filter'", () => {
    expect(matchesDueFilter(inv(shift(5)), "")).toBe(true);
  });

  it("still matches the single buckets exactly", () => {
    expect(matchesDueFilter(inv(shift(0)), "Due Today")).toBe(true);
    expect(matchesDueFilter(inv(shift(0)), "Overdue")).toBe(false);
  });
});

describe("filter option lists", () => {
  it("offers Paid/Written Off on invoices but NOT on the board", () => {
    // The board only ever lists open AR, so those two would always come back
    // empty there — a filter that can only disappoint.
    expect(DUE_FILTERS).toContain("Paid");
    expect(DUE_FILTERS).toContain("Written Off");
    expect(DUE_FILTERS_OPEN).not.toContain("Paid");
    expect(DUE_FILTERS_OPEN).not.toContain("Written Off");
  });

  it("offers both new windows in each list", () => {
    for (const list of [DUE_FILTERS, DUE_FILTERS_OPEN]) {
      expect(list).toContain("Due This Week");
      expect(list).toContain("Due This Month");
    }
  });
});

describe("aging buckets", () => {
  it("splits on the standard 30/60/90 boundaries", () => {
    expect(getAgingBucket(inv(shift(5)))).toBe("Current");
    expect(getAgingBucket(inv(shift(-20)))).toBe("1-30");
    expect(getAgingBucket(inv(shift(-45)))).toBe("31-60");
    expect(getAgingBucket(inv(shift(-75)))).toBe("61-90");
    expect(getAgingBucket(inv(shift(-120)))).toBe("90+");
  });
});
