import { describe, it, expect } from "vitest";
import { computeResourceUtilization, type UtilizationAssignment, type UtilizationEntry, type TimesheetTypeInfo } from "@/lib/resources/utilization";

const types = new Map<string, TimesheetTypeInfo>([
  ["work", { category: "work", billable: true }],
  ["internal", { category: "work", billable: false }],
  ["leave", { category: "leave", billable: false }],
]);

// 2026-10-05 is a Monday; 2026-10-05..09 is a full Mon-Fri working week, no weekend inside it.
const FROM = "2026-10-05";
const TO = "2026-10-09";

describe("computeResourceUtilization", () => {
  it("capacity = working days x daily capacity, minus approved leave hours", () => {
    const resource = { id: "r1", name: "Alice", type: "person", dailyCapacity: 8, workingDays: [1, 2, 3, 4, 5], holidayCalendarId: null };
    const entries: UtilizationEntry[] = [
      { resourceId: "r1", timesheetTypeId: "work", hours: 10 },
      { resourceId: "r1", timesheetTypeId: "leave", hours: 8 },
    ];
    const row = computeResourceUtilization(resource, FROM, TO, null, new Map(), [], entries, types);
    // 5 working days x 8h = 40, minus 8h leave = 32
    expect(row.capacity).toBe(32);
    expect(row.actualHours).toBe(10);
    expect(row.billableHours).toBe(10);
    expect(row.leaveHours).toBe(8);
    expect(row.utilizationPercent).toBeCloseTo((10 / 32) * 100, 2);
  });

  it("a public holiday on a working day removes it from capacity entirely", () => {
    const resource = { id: "r1", name: "Alice", type: "person", dailyCapacity: 8, workingDays: [1, 2, 3, 4, 5], holidayCalendarId: "cal-uk" };
    const holidaysByCalendar = new Map([["cal-uk", new Set(["2026-10-07"])]]); // the Wednesday in range
    const row = computeResourceUtilization(resource, FROM, TO, null, holidaysByCalendar, [], [], types);
    // 4 working days (one holiday removed) x 8h = 32, no leave
    expect(row.capacity).toBe(32);
  });

  it("falls back to the org default calendar when the resource has none of its own", () => {
    const resource = { id: "r1", name: "Alice", type: "person", dailyCapacity: 8, workingDays: [1, 2, 3, 4, 5], holidayCalendarId: null };
    const holidaysByCalendar = new Map([["default-cal", new Set(["2026-10-07"])]]);
    const row = computeResourceUtilization(resource, FROM, TO, "default-cal", holidaysByCalendar, [], [], types);
    expect(row.capacity).toBe(32);
  });

  it("weekends are never counted even with no explicit workingDays override", () => {
    const resource = { id: "r1", name: "Equip", type: "equipment", dailyCapacity: 1, workingDays: null, holidayCalendarId: null };
    // 2026-10-05..11 is a full week including a Sat/Sun.
    const row = computeResourceUtilization(resource, "2026-10-05", "2026-10-11", null, new Map(), [], [], types);
    expect(row.capacity).toBe(5); // 5 weekdays x 1, not 7
  });

  it("planned hours derive from overlapping, non-cancelled assignments' allocation %", () => {
    const resource = { id: "r1", name: "Alice", type: "person", dailyCapacity: 8, workingDays: [1, 2, 3, 4, 5], holidayCalendarId: null };
    const assignments: UtilizationAssignment[] = [
      { resourceId: "r1", startDate: "2026-10-01", endDate: "2026-10-31", status: "active", allocationPercent: 50 },
      { resourceId: "r1", startDate: "2026-01-01", endDate: "2026-01-31", status: "active", allocationPercent: 999 }, // outside range, must not count
      { resourceId: "r1", startDate: "2026-10-01", endDate: "2026-10-31", status: "cancelled", allocationPercent: 999 }, // cancelled, must not count
    ];
    const row = computeResourceUtilization(resource, FROM, TO, null, new Map(), assignments, [], types);
    expect(row.plannedPercent).toBe(50);
    expect(row.plannedHours).toBe(20); // 40 capacity x 50%
  });

  it("non-billable work hours count toward actual utilization but not billable utilization", () => {
    const resource = { id: "r1", name: "Alice", type: "person", dailyCapacity: 8, workingDays: [1, 2, 3, 4, 5], holidayCalendarId: null };
    const entries: UtilizationEntry[] = [{ resourceId: "r1", timesheetTypeId: "internal", hours: 10 }];
    const row = computeResourceUtilization(resource, FROM, TO, null, new Map(), [], entries, types);
    expect(row.actualHours).toBe(10);
    expect(row.billableHours).toBe(0);
    expect(row.utilizationPercent).toBeCloseTo(25, 2); // 10/40
    expect(row.billableUtilizationPercent).toBe(0);
  });

  it("zero capacity (e.g. fully on leave) reports 0% utilization rather than dividing by zero", () => {
    const resource = { id: "r1", name: "Alice", type: "person", dailyCapacity: 8, workingDays: [1, 2, 3, 4, 5], holidayCalendarId: null };
    const entries: UtilizationEntry[] = [{ resourceId: "r1", timesheetTypeId: "leave", hours: 40 }];
    const row = computeResourceUtilization(resource, FROM, TO, null, new Map(), [], entries, types);
    expect(row.capacity).toBe(0);
    expect(row.utilizationPercent).toBe(0);
  });
});
