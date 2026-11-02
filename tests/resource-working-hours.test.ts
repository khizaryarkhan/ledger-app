import { describe, it, expect } from "vitest";
import {
  capacityOver, hoursOn, patternOn, hasDatedHours, coverageOf,
  type WorkingHoursRow, type CapacityFallback,
} from "@/lib/resources/working-hours";

// 2026-11-02 is a Monday; 11-07 Sat, 11-08 Sun (verified, not assumed).
const MON = "2026-11-02";
const SUN = "2026-11-08";
const NO_HOLIDAYS = new Set<string>();

/** Someone on 8h/day, Mon-Fri, by their resource columns alone. */
const EIGHT: CapacityFallback = { dailyCapacity: 8, workingDays: [1, 2, 3, 4, 5] };

const row = (over: Partial<WorkingHoursRow> = {}): WorkingHoursRow => ({
  hoursPerDay: 8, workingDays: null, effectiveFrom: MON, effectiveTo: null, ...over,
});

describe("capacity with no dated hours", () => {
  it("is exactly the old working-days x daily-capacity", () => {
    expect(capacityOver(MON, SUN, [], EIGHT, NO_HOLIDAYS)).toBe(40);
  });
  it("counts a public holiday as no capacity", () => {
    expect(capacityOver(MON, SUN, [], EIGHT, new Set(["2026-11-04"]))).toBe(32);
  });
  it("honours a non-standard working pattern", () => {
    expect(capacityOver(MON, SUN, [], { dailyCapacity: 8, workingDays: [1, 2, 3] }, NO_HOLIDAYS)).toBe(24);
  });
  it("is zero for an inverted range rather than looping", () => {
    expect(capacityOver(SUN, MON, [], EIGHT, NO_HOLIDAYS)).toBe(0);
  });
});

describe("a dated row overrides the current-value columns", () => {
  it("uses the row's hours, not the resource's", () => {
    expect(capacityOver(MON, SUN, [row({ hoursPerDay: 6 })], EIGHT, NO_HOLIDAYS)).toBe(30);
  });
  it("ignores a row whose window ended before this one", () => {
    const past = row({ hoursPerDay: 4, effectiveFrom: "2026-10-01", effectiveTo: "2026-10-31" });
    expect(capacityOver(MON, SUN, [past], EIGHT, NO_HOLIDAYS)).toBe(40);
  });
  it("ignores a row that has not started yet", () => {
    const future = row({ hoursPerDay: 4, effectiveFrom: "2026-12-01" });
    expect(capacityOver(MON, SUN, [future], EIGHT, NO_HOLIDAYS)).toBe(40);
  });
  it("inherits the resource's own working days when the row names none", () => {
    // The row changes the hours only; it must not silently also change which
    // days are worked.
    const fallback: CapacityFallback = { dailyCapacity: 8, workingDays: [1, 2, 3] };
    expect(capacityOver(MON, SUN, [row({ hoursPerDay: 6 })], fallback, NO_HOLIDAYS)).toBe(18);
  });
  it("uses the row's own working days when it has them", () => {
    expect(capacityOver(MON, SUN, [row({ hoursPerDay: 6, workingDays: [1, 2] })], EIGHT, NO_HOLIDAYS)).toBe(12);
  });
});

describe("overlapping rows take the highest, never the sum", () => {
  it("does not stack two contracts into a longer week", () => {
    const rows = [row({ hoursPerDay: 6 }), row({ hoursPerDay: 8 })];
    // 8, not 14 — two rows describe the same week twice.
    expect(capacityOver(MON, SUN, rows, EIGHT, NO_HOLIDAYS)).toBe(40);
    expect(patternOn(MON, rows, EIGHT).hoursPerDay).toBe(8);
  });
});

describe("a pattern that changes inside the window", () => {
  const changing = [
    row({ hoursPerDay: 8, effectiveFrom: "2026-10-01", effectiveTo: "2026-11-04" }),
    row({ hoursPerDay: 4, effectiveFrom: "2026-11-05" }),
  ];

  it("counts each day under the pattern in force that day", () => {
    // Mon-Wed at 8 = 24, Thu-Fri at 4 = 8.
    expect(capacityOver(MON, SUN, changing, EIGHT, NO_HOLIDAYS)).toBe(32);
  });

  it("is why a day count times one rate cannot express it", () => {
    const exact = capacityOver(MON, SUN, changing, EIGHT, NO_HOLIDAYS);
    expect(exact).not.toBe(5 * 8); // picking the first pattern
    expect(exact).not.toBe(5 * 4); // picking the last
  });
});

describe("history does not restate itself", () => {
  it("keeps a past window's capacity when today's contract changes", () => {
    // The whole point of dated rows: the person moved to 4 days in December,
    // and November must still read as November did.
    const rows = [
      row({ hoursPerDay: 8, effectiveFrom: "2026-01-01", effectiveTo: "2026-11-30" }),
      row({ hoursPerDay: 8, workingDays: [1, 2, 3, 4], effectiveFrom: "2026-12-01" }),
    ];
    expect(capacityOver(MON, SUN, rows, EIGHT, NO_HOLIDAYS)).toBe(40);
    expect(capacityOver("2026-12-07", "2026-12-13", rows, EIGHT, NO_HOLIDAYS)).toBe(32);
  });
});

describe("one day at a time", () => {
  it("is zero on a weekend, a holiday, and a non-working weekday", () => {
    expect(hoursOn("2026-11-07", [], EIGHT, NO_HOLIDAYS)).toBe(0);
    expect(hoursOn(MON, [], EIGHT, new Set([MON]))).toBe(0);
    expect(hoursOn(MON, [], { dailyCapacity: 8, workingDays: [2, 3] }, NO_HOLIDAYS)).toBe(0);
    expect(hoursOn(MON, [], EIGHT, NO_HOLIDAYS)).toBe(8);
  });
});

describe("coverage", () => {
  it("knows whether a figure rests on a dated row or on a fallback column", () => {
    expect(hasDatedHours([], MON, SUN)).toBe(false);
    expect(hasDatedHours([row()], MON, SUN)).toBe(true);
    // Touching the window at either edge counts.
    expect(hasDatedHours([row({ effectiveFrom: "2026-10-01", effectiveTo: MON })], MON, SUN)).toBe(true);
    expect(hasDatedHours([row({ effectiveFrom: SUN })], MON, SUN)).toBe(true);
    expect(hasDatedHours([row({ effectiveFrom: "2026-10-01", effectiveTo: "2026-11-01" })], MON, SUN)).toBe(false);
  });

  it("counts how many people are on record, so a soft denominator is visible", () => {
    const byResource = new Map([["a", [row()]], ["b", []]]);
    expect(coverageOf([{ resourceId: "a" }, { resourceId: "b" }, { resourceId: "c" }], byResource, MON, SUN))
      .toEqual({ known: 1, counted: 3 });
  });
});
