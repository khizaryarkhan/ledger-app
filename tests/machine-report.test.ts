import { describe, it, expect } from "vitest";
import { availableHours, utilisation, depreciationInWindow, runningCost } from "@/lib/resources/machine-report";
import type { WorkingHoursRow } from "@/lib/resources/working-hours";

// 2026-11-02 is a Monday (verified), so 02..08 is Mon..Sun.
const row = (over: Partial<WorkingHoursRow> = {}): WorkingHoursRow => ({
  hoursPerDay: 8, workingDays: null, effectiveFrom: "2026-01-01", effectiveTo: null, ...over,
});
const NONE = new Set<string>();

describe("hours a machine was available", () => {
  it("counts only the days a dated row covers, never the slots column", () => {
    // No dated rows at all: the slots-per-day column must not be read as hours.
    const a = availableHours("2026-11-02", "2026-11-08", [], null, NONE);
    expect(a.hours).toBe(0);
    expect(a.coveredDays).toBe(0);
    expect(a.complete).toBe(false);
  });

  it("sums a working week from one dated row", () => {
    const a = availableHours("2026-11-02", "2026-11-08", [row()], null, NONE);
    expect(a.hours).toBe(40);          // Mon-Fri x 8
    expect(a.days).toBe(7);
    expect(a.complete).toBe(true);
  });

  it("takes nothing for a public holiday", () => {
    const a = availableHours("2026-11-02", "2026-11-08", [row()], null, new Set(["2026-11-04"]));
    expect(a.hours).toBe(32);
  });

  it("is incomplete when the row starts part-way through the window", () => {
    const a = availableHours("2026-11-02", "2026-11-08", [row({ effectiveFrom: "2026-11-05" })], null, NONE);
    expect(a.coveredDays).toBe(4);     // Thu..Sun
    expect(a.complete).toBe(false);
  });

  it("follows a machine's own working days when the row names none", () => {
    const a = availableHours("2026-11-02", "2026-11-08", [row()], [1, 2, 3, 4, 5, 6], NONE);
    expect(a.hours).toBe(48);          // Mon-Sat x 8
  });
});

describe("utilisation", () => {
  it("is run hours over available hours", () => {
    const a = availableHours("2026-11-02", "2026-11-08", [row()], null, NONE);
    expect(utilisation(30, a)).toEqual({ pct: 75, reason: "ok" });
  });

  it("states no figure when nothing is on record, rather than dividing by a guess", () => {
    const a = availableHours("2026-11-02", "2026-11-08", [], null, NONE);
    expect(utilisation(30, a)).toEqual({ pct: null, reason: "no-hours-on-record" });
  });

  it("states no figure when the record covers only part of the window", () => {
    // Partial coverage shrinks the denominator and would inflate the percentage.
    const a = availableHours("2026-11-02", "2026-11-08", [row({ effectiveFrom: "2026-11-05" })], null, NONE);
    expect(utilisation(30, a)).toEqual({ pct: null, reason: "partly-on-record" });
  });

  it("states no figure when every covered day is a day off", () => {
    const a = availableHours("2026-11-07", "2026-11-08", [row()], null, NONE);   // Sat + Sun
    expect(a.complete).toBe(true);
    expect(utilisation(0, a)).toEqual({ pct: null, reason: "no-available-hours" });
  });

  it("can exceed 100 and says so rather than capping it", () => {
    const a = availableHours("2026-11-02", "2026-11-02", [row()], null, NONE);   // 8 h
    expect(utilisation(10, a).pct).toBe(125);
  });
});

describe("depreciation beside running cost", () => {
  const terms = { purchaseDate: "2026-01-15", cost: 12000, salvageValue: 0, usefulLifeMonths: 12 };

  it("charges every month the window touches in full", () => {
    // 1,000 a month; a window from 20 Mar to 5 May touches Mar, Apr, May.
    expect(depreciationInWindow(terms, "2026-03-20", "2026-05-05")).toBe(3000);
  });

  it("is zero before purchase and after the asset is fully depreciated", () => {
    expect(depreciationInWindow(terms, "2025-06-01", "2025-06-30")).toBe(0);
    expect(depreciationInWindow(terms, "2028-01-01", "2028-01-31")).toBe(0);
  });

  it("stops at disposal", () => {
    expect(depreciationInWindow({ ...terms, disposedDate: "2026-04-10" }, "2026-01-01", "2026-12-31")).toBe(3000);
  });

  it("prices run hours at the work centre's rates and keeps labour and overhead apart", () => {
    expect(runningCost(10, 12.5, 4)).toEqual({ labour: 125, overhead: 40, total: 165 });
  });

  it("treats a missing rate as zero rather than NaN", () => {
    expect(runningCost(10, Number.NaN, 4)).toEqual({ labour: 0, overhead: 40, total: 40 });
  });
});
