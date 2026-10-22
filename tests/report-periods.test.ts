import { describe, it, expect } from "vitest";
import {
  fyStart, fyEnd, rangeForPreset, asOfForPreset, splitRangeByBucket, splitAsOfByBucket,
  compareRange, compareAsOf, endOfMonth, startOfQuarter, endOfQuarter,
} from "@/lib/accounting/report-periods";

describe("fiscal year boundaries (fym = 7, July start)", () => {
  it("places a date before the FY-start month in the PRIOR fiscal year", () => {
    expect(fyStart("2026-03-15", 7)).toBe("2025-07-01");
    expect(fyEnd("2026-03-15", 7)).toBe("2026-06-30");
  });
  it("places a date on/after the FY-start month in the CURRENT fiscal year", () => {
    expect(fyStart("2026-07-01", 7)).toBe("2026-07-01");
    expect(fyStart("2026-10-22", 7)).toBe("2026-07-01");
  });
});

describe("rangeForPreset", () => {
  it("this_fy_to_date respects the org's fiscal year start month", () => {
    const r = rangeForPreset("this_fy_to_date", "2026-10-22", 7);
    expect(r).toEqual({ key: "this_fy_to_date", label: "This fiscal year to date", from: "2026-07-01", to: "2026-10-22" });
  });
  it("last_fy is the full prior fiscal year, not a partial one", () => {
    const r = rangeForPreset("last_fy", "2026-10-22", 7);
    expect(r).toEqual({ key: "last_fy", label: "Last fiscal year", from: "2025-07-01", to: "2026-06-30" });
  });
  it("last_month handles a December->January wrap", () => {
    const r = rangeForPreset("last_month", "2026-01-15", 1);
    expect(r).toEqual({ key: "last_month", label: "Last month", from: "2025-12-01", to: "2025-12-31" });
  });
  it("last_quarter handles a Q1->Q4(prior year) wrap", () => {
    const r = rangeForPreset("last_quarter", "2026-02-10", 1);
    expect(r).toEqual({ key: "last_quarter", label: "Last quarter", from: "2025-10-01", to: "2025-12-31" });
  });
  it("custom returns null — caller keeps its own from/to state", () => {
    expect(rangeForPreset("custom", "2026-10-22", 1)).toBeNull();
  });
});

describe("asOfForPreset", () => {
  it("end_of_last_fy uses the fiscal year start month", () => {
    const a = asOfForPreset("end_of_last_fy", "2026-10-22", 7);
    expect(a).toEqual({ key: "end_of_last_fy", label: "End of last fiscal year", asOf: "2026-06-30" });
  });
});

describe("splitRangeByBucket", () => {
  it("total returns exactly one column spanning the whole range", () => {
    expect(splitRangeByBucket("2026-01-01", "2026-12-31", "total")).toEqual([{ key: "total", label: "Total", from: "2026-01-01", to: "2026-12-31" }]);
  });
  it("month tiles a fiscal-year range and clips the first/last segment to the window", () => {
    const cols = splitRangeByBucket("2026-07-01", "2026-09-15", "month");
    expect(cols.map((c) => [c.from, c.to])).toEqual([
      ["2026-07-01", "2026-07-31"],
      ["2026-08-01", "2026-08-31"],
      ["2026-09-01", "2026-09-15"], // clipped to `to`, not the full month
    ]);
    expect(cols.map((c) => c.label)).toEqual(["Jul 2026", "Aug 2026", "Sep 2026"]);
  });
  it("quarter tiles correctly and clips the opening segment to `from`", () => {
    const cols = splitRangeByBucket("2026-02-15", "2026-08-10", "quarter");
    expect(cols.map((c) => [c.from, c.to])).toEqual([
      ["2026-02-15", "2026-03-31"], // clipped to `from` mid-quarter
      ["2026-04-01", "2026-06-30"],
      ["2026-07-01", "2026-08-10"], // clipped to `to`
    ]);
    expect(cols.map((c) => c.label)).toEqual(["Q1 2026", "Q2 2026", "Q3 2026"]);
  });
  it("year tiles across a year boundary", () => {
    const cols = splitRangeByBucket("2025-11-01", "2026-02-28", "year");
    expect(cols.map((c) => [c.from, c.to])).toEqual([
      ["2025-11-01", "2025-12-31"],
      ["2026-01-01", "2026-02-28"],
    ]);
  });
});

describe("splitAsOfByBucket", () => {
  it("snapshots at the end of each bucket, final one clipped to `to`", () => {
    const cols = splitAsOfByBucket("2026-07-01", "2026-09-15", "month");
    expect(cols.map((c) => c.asOf)).toEqual(["2026-07-31", "2026-08-31", "2026-09-15"]);
  });
});

describe("compareRange", () => {
  it("previous_period is the same-length window immediately before, with no overlap", () => {
    const c = compareRange("2026-09-01", "2026-09-30", "previous_period");
    expect(c).toEqual({ key: "compare", label: "Previous period", from: "2026-08-02", to: "2026-08-31" });
  });
  it("previous_year shifts both ends back exactly one year", () => {
    const c = compareRange("2026-07-01", "2026-10-22", "previous_year");
    expect(c).toEqual({ key: "compare", label: "Previous year", from: "2025-07-01", to: "2025-10-22" });
  });
  it("none returns null", () => {
    expect(compareRange("2026-01-01", "2026-01-31", "none")).toBeNull();
  });
});

describe("compareAsOf", () => {
  it("previous_period is the prior month-end", () => {
    expect(compareAsOf("2026-09-15", "previous_period")).toEqual({ key: "compare", label: "Previous month-end", asOf: "2026-08-31" });
  });
  it("previous_year is the same calendar date one year earlier", () => {
    expect(compareAsOf("2026-09-15", "previous_year")).toEqual({ key: "compare", label: "Previous year", asOf: "2025-09-15" });
  });
});

describe("month/quarter helpers used across the module", () => {
  it("endOfMonth / startOfQuarter / endOfQuarter are leap-year and boundary safe", () => {
    expect(endOfMonth("2028-02-10")).toBe("2028-02-29"); // leap year
    expect(endOfMonth("2026-02-10")).toBe("2026-02-28"); // non-leap year
    expect(startOfQuarter("2026-11-05")).toBe("2026-10-01");
    expect(endOfQuarter("2026-11-05")).toBe("2026-12-31");
  });
});
