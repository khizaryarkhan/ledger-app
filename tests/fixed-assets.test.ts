import { describe, it, expect } from "vitest";
import {
  fullSchedule, scheduleFor, netBookValueAsAt, accumulatedAsAt, unpostedPeriods,
  addMonths, periodEndDate, termsError, isPeriod,
} from "@/lib/accounting/fixed-assets";

const base = { purchaseDate: "2026-01-15", cost: 1200, salvageValue: 0, usefulLifeMonths: 12 };
const sum = (rows: { amount: number }[]) => Math.round(rows.reduce((s, r) => s + r.amount, 0) * 100) / 100;

describe("fixed assets - schedule", () => {
  it("charges evenly and starts in the purchase month", () => {
    const s = fullSchedule(base);
    expect(s).toHaveLength(12);
    expect(s[0]).toMatchObject({ period: "2026-01", amount: 100, netBookValue: 1100 });
    expect(s[11]).toMatchObject({ period: "2026-12", accumulated: 1200, netBookValue: 0 });
  });

  it("last month absorbs rounding so the total is exactly cost - salvage", () => {
    const t = { purchaseDate: "2026-03-31", cost: 1000, salvageValue: 100, usefulLifeMonths: 7 }; // 900/7 = 128.571..
    const s = fullSchedule(t);
    expect(s[0].amount).toBe(128.57);
    expect(s[6].amount).toBe(128.58);
    expect(sum(s)).toBe(900);
    expect(s[6].netBookValue).toBe(100);
  });

  it("rolls across year ends", () => {
    const s = fullSchedule({ ...base, purchaseDate: "2026-11-30", usefulLifeMonths: 3 });
    expect(s.map(r => r.period)).toEqual(["2026-11", "2026-12", "2027-01"]);
  });

  it("stops before the disposal month", () => {
    const s = scheduleFor({ ...base, disposedDate: "2026-04-10" });
    expect(s.map(r => r.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
  });

  it("an asset disposed in its purchase month is never depreciated", () => {
    expect(scheduleFor({ ...base, disposedDate: "2026-01-20" })).toEqual([]);
  });
});

describe("fixed assets - net book value", () => {
  it("is zero before purchase, cost-less-accumulated after", () => {
    expect(netBookValueAsAt(base, "2025-12-31")).toBe(0);
    expect(netBookValueAsAt(base, "2026-01-01")).toBe(1100);
    expect(netBookValueAsAt(base, "2026-06-30")).toBe(600);
    expect(netBookValueAsAt(base, "2040-01-01")).toBe(0);
  });

  it("freezes at the disposal point", () => {
    const t = { ...base, disposedDate: "2026-04-10" };
    expect(accumulatedAsAt(t, "2026-12-31")).toBe(300);
    expect(netBookValueAsAt(t, "2026-12-31")).toBe(900);
  });

  it("salvage value is the floor", () => {
    expect(netBookValueAsAt({ ...base, salvageValue: 200 }, "2030-01-01")).toBe(200);
  });
});

describe("fixed assets - unposted periods", () => {
  it("lists what is due and not yet posted, including backlog", () => {
    const rows = unpostedPeriods(base, new Set(["2026-01", "2026-03"]), "2026-05");
    expect(rows.map(r => r.period)).toEqual(["2026-02", "2026-04", "2026-05"]);
  });
  it("is empty once everything is posted (idempotent)", () => {
    const all = fullSchedule(base).map(r => r.period);
    expect(unpostedPeriods(base, all, "2030-01")).toEqual([]);
  });
  it("never lists a month at or after disposal", () => {
    const rows = unpostedPeriods({ ...base, disposedDate: "2026-03-01" }, [], "2026-12");
    expect(rows.map(r => r.period)).toEqual(["2026-01", "2026-02"]);
  });
});

describe("fixed assets - helpers and validation", () => {
  it("adds months and finds month ends", () => {
    expect(addMonths("2026-12", 1)).toBe("2027-01");
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(periodEndDate("2028-02")).toBe("2028-02-29");
    expect(periodEndDate("2026-02")).toBe("2026-02-28");
    expect(periodEndDate("2026-04")).toBe("2026-04-30");
    expect(isPeriod("2026-13")).toBe(false);
  });
  it("rejects bad terms", () => {
    expect(termsError(base)).toBeNull();
    expect(termsError({ ...base, cost: 0 })).toMatch(/Cost/);
    expect(termsError({ ...base, salvageValue: 1200 })).toMatch(/Salvage/);
    expect(termsError({ ...base, usefulLifeMonths: 0 })).toMatch(/life/);
    expect(termsError({ ...base, purchaseDate: "2026-1-1" })).toMatch(/YYYY/);
  });
});
