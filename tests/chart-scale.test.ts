import { describe, it, expect } from "vitest";
import { niceScale } from "@/lib/resources/chart-scale";
import { behindMatrix } from "@/lib/resources/dashboard";

describe("niceScale", () => {
  it("ends on a round number at or above the largest bar", () => {
    const s = niceScale(32.5);
    expect(s.max).toBeGreaterThanOrEqual(32.5);
    expect(s.ticks[0]).toBe(0);
    expect(s.ticks[s.ticks.length - 1]).toBe(s.max);
    expect(s.max % s.step).toBeCloseTo(0, 6);
  });
  it("never returns an empty axis for zero, negative or non-finite input", () => {
    for (const v of [0, -5, NaN, Infinity]) expect(niceScale(v).ticks.length).toBeGreaterThan(1);
  });
  it("keeps a value that sits exactly on a tick inside the axis", () => {
    expect(niceScale(40).max).toBeGreaterThanOrEqual(40);
  });
});

describe("behindMatrix", () => {
  const weeks = ["2026-11-02", "2026-11-09"];
  const planned: any[] = [{ key: "project:a", weeks: [10, 5], total: 15 }];
  const logged: any[] = [
    { key: "project:a", weeks: [{ actual: 4, pending: 0, draft: 0 }, { actual: 0, pending: 2, draft: 1 }], total: {} },
    { key: "project:unplanned", weeks: [{ actual: 8, pending: 0, draft: 0 }, { actual: 0, pending: 0, draft: 0 }], total: {} },
    { key: "type:leave", weeks: [{ actual: 8, pending: 0, draft: 0 }, { actual: 8, pending: 0, draft: 0 }], total: {} },
  ];
  it("gives each booking its plan and logged hours per week", () => {
    const m = behindMatrix(weeks, planned, logged);
    const a = m.find((r) => r.key === "project:a")!;
    expect(a.weeks).toEqual([{ planned: 10, logged: 4 }, { planned: 5, logged: 3 }]);
  });
  it("keeps work that was never planned, as planned 0", () => {
    const u = behindMatrix(weeks, planned, logged).find((r) => r.key === "project:unplanned")!;
    expect(u.weeks[0]).toEqual({ planned: 0, logged: 8 });
  });
  it("leaves leave and internal time out", () => {
    expect(behindMatrix(weeks, planned, logged).some((r) => r.key.startsWith("type:"))).toBe(false);
  });
});
