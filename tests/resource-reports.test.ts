import { describe, it, expect } from "vitest";
import {
  weekStart, weeksBetween, weekWindow, plannedHours, statusBucket, loggedByWeek, daysOfWeek,
  plannedByWeek, projectRollup, employeeRollup, costOf,
  type AssignmentRow, type EntryRow, type PersonCalendar, type Costing,
} from "@/lib/resources/reports";
import { buildActor, visibleResourceIds } from "@/lib/resources/access";

const cal = (over: Partial<PersonCalendar> = {}): PersonCalendar => ({
  dailyCapacity: 8, workingDays: null, holidays: new Set(), ...over,
});
const assign = (over: Partial<AssignmentRow> = {}): AssignmentRow => ({
  resourceId: "r1", assignableType: "project", assignableId: "p1",
  startDate: "2026-10-26", endDate: "2026-11-01", allocationPercent: 50, status: "active", ...over,
});
const entry = (over: Partial<EntryRow> = {}): EntryRow => ({
  resourceId: "r1", date: "2026-10-27", hours: 4, status: "approved",
  assignableType: "project", assignableId: "p1", timesheetTypeId: "t1", isLeave: false, ...over,
});
const noCost: Costing = { allowed: false, rates: new Map() };

describe("week bucketing", () => {
  it("starts weeks on Monday across a year boundary", () => {
    expect(weekStart("2026-01-01")).toBe("2025-12-29"); // Thursday
    expect(weekStart("2025-12-29")).toBe("2025-12-29");
  });
  it("treats Sunday as the last day of its week, across a month boundary", () => {
    expect(weekStart("2026-03-01")).toBe("2026-02-23");
    expect(weekStart("2026-11-01")).toBe("2026-10-26");
  });
  it("lists every Monday touching a range", () => {
    expect(weeksBetween("2025-12-31", "2026-01-12")).toEqual(["2025-12-29", "2026-01-05", "2026-01-12"]);
    expect(weeksBetween("2026-02-01", "2026-01-01")).toEqual([]);
  });
  it("builds the past/current/upcoming windows", () => {
    const w = weekWindow("2026-11-01", 2, 2);
    expect(w.current).toBe("2026-10-26");
    expect(w.past).toEqual(["2026-10-12", "2026-10-19"]);
    expect(w.upcoming).toEqual(["2026-11-02", "2026-11-09"]);
  });
});

describe("planned hours", () => {
  const week = { from: "2026-10-26", to: "2026-11-01" };
  it("is allocation x daily capacity x working days", () => {
    expect(plannedHours(assign(), cal(), week)).toBe(20); // 50% x 8 x 5
  });
  it("clips a partial window to the assignment start", () => {
    expect(plannedHours(assign({ startDate: "2026-10-28" }), cal(), week)).toBe(12); // Wed-Fri
  });
  it("clips to the assignment end", () => {
    expect(plannedHours(assign({ endDate: "2026-10-27" }), cal(), week)).toBe(8); // Mon-Tue
  });
  it("skips holidays", () => {
    expect(plannedHours(assign(), cal({ holidays: new Set(["2026-10-28"]) }), week)).toBe(16);
  });
  it("honours the person's own working days", () => {
    expect(plannedHours(assign({ allocationPercent: 100 }), cal({ workingDays: [1, 2, 3, 4, 5, 6] }), week)).toBe(48);
  });
  it("treats an open-ended assignment as running to the window end", () => {
    expect(plannedHours(assign({ endDate: null }), cal(), { from: "2026-11-02", to: "2026-11-08" })).toBe(20);
  });
  it("is zero outside the assignment or when cancelled", () => {
    expect(plannedHours(assign({ endDate: "2026-10-20" }), cal(), week)).toBe(0);
    expect(plannedHours(assign({ status: "cancelled" }), cal(), week)).toBe(0);
  });
});

describe("status split", () => {
  it("maps statuses to buckets", () => {
    expect(statusBucket("approved")).toBe("actual");
    expect(statusBucket("posted")).toBe("actual");
    expect(statusBucket("submitted")).toBe("pending");
    expect(statusBucket("draft")).toBe("draft");
    expect(statusBucket("rejected")).toBe("draft");
  });
  it("splits a week's logged hours and rolls entries with no project under their type", () => {
    const weeks = ["2026-10-26"];
    const rows = loggedByWeek([
      entry({ hours: 3, status: "posted" }), entry({ hours: 2, status: "submitted" }),
      entry({ hours: 1, status: "rejected" }),
      entry({ assignableType: null, assignableId: null, timesheetTypeId: "leave1", hours: 8 }),
      entry({ date: "2026-10-12", hours: 9 }), // outside the weeks asked for
    ], weeks);
    const proj = rows.find((r) => r.key === "project:p1")!;
    expect(proj.weeks[0]).toEqual({ actual: 3, pending: 2, draft: 1 });
    expect(rows.find((r) => r.key === "type:leave1")!.timesheetTypeId).toBe("leave1");
  });
  it("gives zero capacity on a holiday and weekend in the day view", () => {
    const days = daysOfWeek("2026-10-26", [entry({ hours: 6 })], [assign()], cal({ holidays: new Set(["2026-10-28"]) }));
    expect(days[2].capacity).toBe(0);
    expect(days[2].isHoliday).toBe(true);
    expect(days[5].capacity).toBe(0);
    expect(days[1].actual).toBe(6);
    expect(days[0].planned).toBe(4);
  });
  it("plans per week against capacity", () => {
    const r = plannedByWeek([assign({ endDate: null })], cal(), ["2026-11-02", "2026-11-09"]);
    expect(r.rows[0].weeks).toEqual([20, 20]);
    expect(r.capacity).toEqual([40, 40]);
  });
});

describe("project rollup and visibility", () => {
  // lead manages r2; r3 belongs to someone else's team
  const nodes = [{ id: "lead", managerId: null }, { id: "r2", managerId: "lead" }, { id: "r3", managerId: null }];
  const calendars = new Map([["lead", cal()], ["r2", cal()], ["r3", cal()]]);
  const window = { from: "2026-10-26", to: "2026-11-01" };
  const entries = [
    entry({ resourceId: "r2", hours: 10 }), entry({ resourceId: "r3", hours: 30 }),
    entry({ resourceId: "r2", hours: 2, status: "submitted" }),
  ];
  const assignments = [assign({ resourceId: "r2", allocationPercent: 100 }), assign({ resourceId: "r3", allocationPercent: 100 })];

  it("excludes people outside a team lead's tree", () => {
    const actor = buildActor("company_user", "lead", "team");
    const visible = visibleResourceIds(actor, nodes);
    const rows = projectRollup({ entries, assignments, calendars, window, visible, costing: noCost });
    expect(rows).toHaveLength(1);
    expect(rows[0].people.map((p) => p.resourceId)).toEqual(["r2"]);
    expect(rows[0].actual).toBe(10);
    expect(rows[0].pending).toBe(2);
    expect(rows[0].planned).toBe(40);
    expect(rows[0].variance).toBe(30);
    expect(rows[0].percentUsed).toBe(25);
  });
  it("shows everyone to level all", () => {
    const visible = visibleResourceIds(buildActor("company_user", "x", "all"), nodes);
    const rows = projectRollup({ entries, assignments, calendars, window, visible, costing: noCost });
    expect(rows[0].people.map((p) => p.resourceId).sort()).toEqual(["r2", "r3"]);
    expect(rows[0].actual).toBe(40);
  });
  it("has no percent used when nothing was planned", () => {
    const rows = projectRollup({ entries, assignments: [], calendars, window, visible: "all", costing: noCost });
    expect(rows[0].planned).toBe(0);
    expect(rows[0].percentUsed).toBeNull();
  });
});

describe("cost", () => {
  it("is omitted for non-admins and when there is no rate, never zero", () => {
    expect(costOf({ allowed: false, rates: new Map([["r1", 50]]) }, "r1", 10)).toBeUndefined();
    expect(costOf({ allowed: true, rates: new Map([["r1", null]]) }, "r1", 10)).toBeUndefined();
    expect(costOf({ allowed: true, rates: new Map() }, "r1", 10)).toBeUndefined();
    expect(costOf({ allowed: true, rates: new Map([["r1", 50]]) }, "r1", 10)).toBe(500);
  });
  it("sums cost only over people with a rate and leaves the key off otherwise", () => {
    const calendars = new Map([["r1", cal()], ["r2", cal()]]);
    const window = { from: "2026-10-26", to: "2026-11-01" };
    const entries = [entry({ resourceId: "r1", hours: 10 }), entry({ resourceId: "r2", hours: 5 })];
    const withRate = projectRollup({ entries, assignments: [], calendars, window, visible: "all",
      costing: { allowed: true, rates: new Map([["r1", 20]]) } });
    expect(withRate[0].cost).toBe(200);
    expect(withRate[0].people.find((p) => p.resourceId === "r2")).not.toHaveProperty("cost");
    const none = projectRollup({ entries, assignments: [], calendars, window, visible: "all", costing: { allowed: true, rates: new Map() } });
    expect(none[0]).not.toHaveProperty("cost");
  });
});

describe("employee rollup", () => {
  it("returns capacity, planned, split, utilization and weekly series for visible people only", () => {
    const calendars = new Map([["r1", cal()], ["r2", cal()]]);
    const window = { from: "2026-10-26", to: "2026-11-08" };
    const rows = employeeRollup({
      peopleIds: ["r1", "r2"], calendars, window, visible: new Set(["r1"]), costing: noCost,
      assignments: [assign()],
      entries: [
        entry({ hours: 20 }), entry({ hours: 4, status: "draft", date: "2026-11-03" }),
        entry({ hours: 8, isLeave: true, assignableType: null, assignableId: null }),
      ],
    });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.leaveHours).toBe(8);
    expect(r.capacity).toBe(72); // 80 - 8 leave
    expect(r.actual).toBe(20);
    expect(r.draft).toBe(4);
    expect(r.planned).toBe(20); // assignment ends 2026-11-01
    expect(r.utilizationPercent).toBe(27.78);
    expect(r.weeks.map((w) => w.weekStart)).toEqual(["2026-10-26", "2026-11-02"]);
    expect(r.weeks[1].draft).toBe(4);
  });
});
