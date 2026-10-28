import { describe, it, expect } from "vitest";
import {
  applyReschedule, classifyOrderTiming, downtimeMinutes, readReason, summariseTiming, paretoByReason,
  DELAY_REASONS, DOWNTIME_REASONS, SCRAP_REASONS, reasonLabel,
} from "@/lib/inventory/production-performance";

const base = { plannedStart: "2026-10-01", plannedFinish: "2026-10-10", originalFinish: "2026-10-10", actualStart: "2026-10-02", actualFinish: null as string | null, asOf: "2026-10-05" };

describe("applyReschedule", () => {
  it("treats a due date that predates tracking as the original, so its first move counts", () => {
    expect(applyReschedule({ dueDate: "2026-10-10", originalDueDate: null, revisions: 0 }, "2026-10-15"))
      .toEqual({ dueDate: "2026-10-15", originalDueDate: "2026-10-10", revisions: 1 });
  });
  it("does not count re-saving the same date", () => {
    expect(applyReschedule({ dueDate: "2026-10-10", originalDueDate: "2026-10-10", revisions: 2 }, "2026-10-10").revisions).toBe(2);
  });
  it("setting a first due date is not a reschedule", () => {
    expect(applyReschedule({ dueDate: null, originalDueDate: null, revisions: 0 }, "2026-10-10"))
      .toEqual({ dueDate: "2026-10-10", originalDueDate: "2026-10-10", revisions: 0 });
  });
  it("refuses a malformed date", () => {
    expect(() => applyReschedule({ dueDate: null }, "10/10/2026")).toThrow();
  });
});

describe("classifyOrderTiming", () => {
  it("open and not yet due is unscored", () => {
    const t = classifyOrderTiming(base);
    expect(t.status).toBe("Open"); expect(t.scored).toBe(false); expect(t.startSlipDays).toBe(1);
  });
  it("finished on or before due is on time", () => {
    const t = classifyOrderTiming({ ...base, actualFinish: "2026-10-10" });
    expect(t).toMatchObject({ status: "OnTime", onTime: true, finishSlipDays: 0, actualDays: 8, plannedDays: 9 });
  });
  it("finished after due is late by the gap", () => {
    expect(classifyOrderTiming({ ...base, actualFinish: "2026-10-13" })).toMatchObject({ status: "Late", onTime: false, finishSlipDays: 3 });
  });
  it("open past due is overdue and scored against today", () => {
    expect(classifyOrderTiming({ ...base, asOf: "2026-10-12" })).toMatchObject({ status: "Overdue", scored: true, finishSlipDays: 2 });
  });
  it("on time against a slipped due date is still late against the original", () => {
    const t = classifyOrderTiming({ ...base, plannedFinish: "2026-10-20", originalFinish: "2026-10-10", actualFinish: "2026-10-18" });
    expect(t.onTime).toBe(true); expect(t.onTimeVsOriginal).toBe(false);
  });
  it("no due date is never scored", () => {
    expect(classifyOrderTiming({ ...base, plannedFinish: null, originalFinish: null, actualFinish: "2026-10-30" }).scored).toBe(false);
  });
});

describe("summariseTiming", () => {
  it("rates only scored orders and averages lateness over late ones", () => {
    const rows = [
      { t: classifyOrderTiming({ ...base, actualFinish: "2026-10-09" }), revisions: 0 },
      { t: classifyOrderTiming({ ...base, actualFinish: "2026-10-14" }), revisions: 1 },
      { t: classifyOrderTiming(base), revisions: 0 },
    ];
    expect(summariseTiming(rows)).toMatchObject({ orders: 3, scored: 2, onTimePct: 50, avgDaysLate: 4, rescheduled: 1, overdue: 0 });
  });
  it("returns nulls rather than 0% when nothing is scored", () => {
    expect(summariseTiming([]).onTimePct).toBeNull();
  });
});

describe("downtimeMinutes", () => {
  it("measures a closed stoppage", () => {
    expect(downtimeMinutes("2026-10-01T08:00:00Z", "2026-10-01T09:30:00Z")).toBe(90);
  });
  it("runs an open stoppage to asOf", () => {
    expect(downtimeMinutes("2026-10-01T08:00:00Z", null, new Date("2026-10-01T08:45:00Z"))).toBe(45);
  });
  it("never goes negative", () => {
    expect(downtimeMinutes("2026-10-01T09:00:00Z", "2026-10-01T08:00:00Z")).toBe(0);
  });
});

describe("reasons", () => {
  it("readReason distinguishes untouched, cleared and invalid", () => {
    expect(readReason(DELAY_REASONS, undefined, "delay reason")).toBeUndefined();
    expect(readReason(DELAY_REASONS, "", "delay reason")).toBeNull();
    expect(readReason(SCRAP_REASONS, "setup", "scrap reason")).toBe("setup");
    expect(() => readReason(SCRAP_REASONS, "bananas", "scrap reason")).toThrow();
  });
  it("codes are unique in every list", () => {
    for (const l of [DELAY_REASONS, DOWNTIME_REASONS, SCRAP_REASONS]) expect(new Set(l.map(r => r.code)).size).toBe(l.length);
  });
  it("labels an unrecorded reason as such", () => {
    expect(reasonLabel(DELAY_REASONS, null)).toBe("Not recorded");
  });
  it("pareto groups, labels and sorts by value", () => {
    const p = paretoByReason(SCRAP_REASONS, [{ c: "setup", v: 2 }, { c: "setup", v: 3 }, { c: null, v: 10 }], r => r.c, r => r.v);
    expect(p[0]).toMatchObject({ code: "unrecorded", label: "Not recorded", value: 10 });
    expect(p[1]).toMatchObject({ code: "setup", count: 2, value: 5 });
  });
});
