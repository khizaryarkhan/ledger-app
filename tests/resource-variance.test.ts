import { describe, it, expect } from "vitest";
import {
  kindFor, monthRange, monthOf, previousMonth, isAssessable, shouldEscalate, candidatesFor,
  VARIANCE_TOLERANCE, type BookingFigures,
} from "@/lib/resources/variance";

describe("what deserves an enquiry", () => {
  it("asks about hours over plan", () => {
    expect(kindFor({ planned: 100, actual: 120 })).toBe("over_plan");
  });

  it("does NOT ask about hours under plan", () => {
    // Spending less than planned explains itself; a report that asks about
    // both is a report nobody answers.
    expect(kindFor({ planned: 100, actual: 60 })).toBeNull();
    expect(kindFor({ planned: 100, actual: 100 })).toBeNull();
  });

  it("keeps unplanned work apart from over-plan work", () => {
    // Against a zero baseline every hour is "infinitely over", which would
    // make a real overrun look like a rounding error beside it.
    expect(kindFor({ planned: 0, actual: 30 })).toBe("unplanned");
  });

  it("ignores a variance inside the tolerance", () => {
    expect(kindFor({ planned: 100, actual: 100 + VARIANCE_TOLERANCE })).toBeNull();
    expect(kindFor({ planned: 0, actual: VARIANCE_TOLERANCE })).toBeNull();
  });

  it("raises nothing when nothing was logged", () => {
    expect(kindFor({ planned: 100, actual: 0 })).toBeNull();
    expect(kindFor({ planned: 0, actual: 0 })).toBeNull();
  });
});

describe("months", () => {
  it("knows its own range, including February in a leap year", () => {
    expect(monthRange("2026-10")).toEqual({ from: "2026-10-01", to: "2026-10-31" });
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  it("reads a month off a date and steps back across a year boundary", () => {
    expect(monthOf("2026-10-17")).toBe("2026-10");
    expect(previousMonth("2026-01")).toBe("2025-12");
    expect(previousMonth("2026-11")).toBe("2026-10");
  });
});

describe("when a month may be assessed", () => {
  const base = { monthEnd: "2026-10-31", fallbackDay: 10 };

  it("never while the month is still running", () => {
    expect(isAssessable({ ...base, today: "2026-10-31", settled: true })).toBe(false);
    expect(isAssessable({ ...base, today: "2026-10-15", settled: true })).toBe(false);
  });

  it("as soon as it has ended and the person's time is settled", () => {
    expect(isAssessable({ ...base, today: "2026-11-01", settled: true })).toBe(true);
  });

  it("not while time is still waiting, before the fallback day", () => {
    expect(isAssessable({ ...base, today: "2026-11-01", settled: false })).toBe(false);
    expect(isAssessable({ ...base, today: "2026-11-09", settled: false })).toBe(false);
  });

  it("on the fallback day regardless — one unapproved line cannot hold a month forever", () => {
    expect(isAssessable({ ...base, today: "2026-11-10", settled: false })).toBe(true);
    expect(isAssessable({ ...base, today: "2026-12-01", settled: false })).toBe(true);
  });

  it("handles a December month rolling into January", () => {
    const dec = { monthEnd: "2026-12-31", fallbackDay: 10 };
    expect(isAssessable({ ...dec, today: "2026-12-31", settled: true })).toBe(false);
    expect(isAssessable({ ...dec, today: "2027-01-01", settled: true })).toBe(true);
    expect(isAssessable({ ...dec, today: "2027-01-09", settled: false })).toBe(false);
    expect(isAssessable({ ...dec, today: "2027-01-10", settled: false })).toBe(true);
  });
});

describe("escalation", () => {
  it("waits the full period before chasing, and counts across a month end", () => {
    // 1 Nov + 14 days is the 15th, not the 14th — the elapsed days between two
    // dates is one fewer than it reads.
    expect(shouldEscalate("2026-11-01", "2026-11-15", 14)).toBe(true);
    expect(shouldEscalate("2026-11-01", "2026-11-14", 14)).toBe(false);
    // 25 Oct -> 8 Nov is exactly 14 (6 days left in October, 8 in November).
    expect(shouldEscalate("2026-10-25", "2026-11-08", 14)).toBe(true);
  });
});

describe("candidates", () => {
  const fig = (over: Partial<BookingFigures>): BookingFigures => ({
    resourceId: "r1", assignableType: "project", assignableId: "p1", planned: 0, actual: 0, ...over,
  });

  it("returns only what deserves an enquiry, worst variance first", () => {
    const rows = candidatesFor([
      fig({ assignableId: "small", planned: 10, actual: 12 }),
      fig({ assignableId: "under", planned: 40, actual: 10 }),
      fig({ assignableId: "big", planned: 10, actual: 40 }),
    ]);
    expect(rows.map((r) => r.assignableId)).toEqual(["big", "small"]);
    expect(rows[0].kind).toBe("over_plan");
  });

  it("rounds the figures it records to the penny", () => {
    const rows = candidatesFor([fig({ planned: 10.005, actual: 40.004 })]);
    expect(rows[0].planned).toBe(10.01);
    expect(rows[0].actual).toBe(40);
  });
});
