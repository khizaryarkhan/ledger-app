import { describe, it, expect } from "vitest";
import { PERIODS, periodWindow, inWindow, periodLabel } from "@/lib/list-period";

const custom = { from: "2026-02-01", to: "2026-02-15" };
const OCT_29 = new Date(2026, 9, 29);
const JAN_15 = new Date(2026, 0, 15);

describe("periodWindow", () => {
  it("this month runs first to last day of the current month", () => {
    expect(periodWindow("this-month", custom, OCT_29)).toEqual({ from: "2026-10-01", to: "2026-10-31" });
  });

  it("last month is the whole previous month", () => {
    expect(periodWindow("last-month", custom, OCT_29)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("last 3M / 6M start on the first of that month and run to today", () => {
    expect(periodWindow("last-3m", custom, OCT_29)).toEqual({ from: "2026-07-01", to: "2026-10-29" });
    expect(periodWindow("last-6m", custom, OCT_29)).toEqual({ from: "2026-04-01", to: "2026-10-29" });
  });

  it("wraps across the year boundary", () => {
    expect(periodWindow("last-month", custom, JAN_15)).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodWindow("last-3m", custom, JAN_15)).toEqual({ from: "2025-10-01", to: "2026-01-15" });
  });

  it("custom is exactly what was chosen", () => {
    expect(periodWindow("custom", custom, OCT_29)).toEqual(custom);
  });

  it("all time excludes nothing, including documents dated in the future", () => {
    const w = periodWindow("all", custom, OCT_29);
    expect(inWindow("1999-01-01", w)).toBe(true);
    expect(inWindow("2099-12-31", w)).toBe(true);
  });
});

describe("inWindow", () => {
  const w = { from: "2026-09-01", to: "2026-09-30" };

  it("includes both ends", () => {
    expect(inWindow("2026-09-01", w)).toBe(true);
    expect(inWindow("2026-09-30", w)).toBe(true);
  });

  it("excludes the day either side", () => {
    expect(inWindow("2026-08-31", w)).toBe(false);
    expect(inWindow("2026-10-01", w)).toBe(false);
  });

  it("reads the calendar date of a timestamp literally, never through a Date", () => {
    expect(inWindow("2026-09-30T00:00:00.000Z", w)).toBe(true);
    expect(inWindow("2026-10-01T00:00:00.000Z", w)).toBe(false);
  });

  it("keeps a document with no date — absence of a date is not evidence it is out of range", () => {
    expect(inWindow(null, w)).toBe(true);
    expect(inWindow(undefined, w)).toBe(true);
    expect(inWindow("", w)).toBe(true);
  });
});

describe("periods", () => {
  it("offers the six the Invoices page always had, in order", () => {
    expect(PERIODS.map((p) => p.id)).toEqual(["this-month", "last-month", "last-3m", "last-6m", "all", "custom"]);
  });

  it("labels a period by id", () => {
    expect(periodLabel("last-month")).toBe("Last Month");
    expect(periodLabel("custom")).toBe("Custom");
  });
});
