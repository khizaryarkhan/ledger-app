import { describe, it, expect } from "vitest";
import { peakDailyAllocation, parseAllocation } from "@/lib/resources/assignable";
import { leaveOffCapacity } from "@/lib/resources/working-hours";

describe("peakDailyAllocation (Resource Board over-allocation)", () => {
  it("bookings on different days never add up", () => {
    const b = [
      { startDate: "2026-11-02", endDate: "2026-11-03", allocationPercent: 100 },
      { startDate: "2026-11-04", endDate: "2026-11-06", allocationPercent: 100 },
    ];
    expect(peakDailyAllocation(b, "2026-11-02", "2026-11-08")).toBe(100);
  });
  it("bookings on the same day do", () => {
    const b = [
      { startDate: "2026-11-02", endDate: null, allocationPercent: 60 },
      { startDate: "2026-11-05", endDate: "2026-11-05", allocationPercent: "50" },
    ];
    expect(peakDailyAllocation(b, "2026-11-02", "2026-11-08")).toBe(110);
  });
  it("ignores cancelled bookings and crosses a month end", () => {
    const b = [
      { startDate: "2026-10-30", endDate: "2026-11-02", allocationPercent: 100 },
      { startDate: "2026-10-31", endDate: "2026-11-01", allocationPercent: 100, status: "cancelled" },
    ];
    expect(peakDailyAllocation(b, "2026-10-26", "2026-11-01")).toBe(100);
  });
});

describe("parseAllocation", () => {
  it("defaults to 100 and accepts 1-100", () => {
    expect(parseAllocation(undefined)).toEqual({ ok: true, value: 100 });
    expect(parseAllocation("50")).toEqual({ ok: true, value: 50 });
  });
  it("refuses zero, negative, over 100 and text", () => {
    for (const v of [0, -5, 101, "abc"]) expect(parseAllocation(v).ok).toBe(false);
  });
});

describe("leaveOffCapacity", () => {
  const fb = { dailyCapacity: 8, workingDays: [1, 2, 3, 4, 5] };
  it("caps each day at what the day was worth", () => {
    // Mon 8h leave, Sat 8h leave (not a working day), public holiday Wed.
    const leave = [
      { date: "2026-11-02", hours: 8 },
      { date: "2026-11-07", hours: 8 },
      { date: "2026-11-04", hours: 8 },
    ];
    expect(leaveOffCapacity(leave, [], fb, new Set(["2026-11-04"]))).toBe(8);
  });
  it("sums several lines on one day up to the day", () => {
    expect(leaveOffCapacity([{ date: "2026-11-02", hours: 4 }, { date: "2026-11-02", hours: 6 }], [], fb, new Set())).toBe(8);
  });
});
