import { describe, it, expect } from "vitest";
import { costTimesheetEntries, type CostableEntry, type TimesheetTypeInfo, type ResourceCostInfo } from "@/lib/payroll/timesheet-costing";

const types = new Map<string, TimesheetTypeInfo>([
  ["sick", { expenseAccountId: "acct-sick" }],
  ["work", { expenseAccountId: "acct-work" }],
]);
const resources = new Map<string, ResourceCostInfo>([
  ["alice", { costRatePerHour: 20 }],
  ["bob", { costRatePerHour: 25 }],
  ["carol", { costRatePerHour: null }],
]);

describe("costTimesheetEntries", () => {
  it("groups by expense account + assignable dimension, not one line per resource", () => {
    const entries: CostableEntry[] = [
      { id: "1", hours: 8, resourceId: "alice", timesheetTypeId: "work", assignableType: "manufacturing_order", assignableId: "mo-1" },
      { id: "2", hours: 4, resourceId: "bob", timesheetTypeId: "work", assignableType: "manufacturing_order", assignableId: "mo-1" },
      { id: "3", hours: 8, resourceId: "alice", timesheetTypeId: "sick", assignableType: null, assignableId: null },
    ];
    const result = costTimesheetEntries(entries, types, resources);

    expect(result.groups).toHaveLength(2);
    const workGroup = result.groups.find(g => g.accountId === "acct-work")!;
    expect(workGroup).toMatchObject({ assignableType: "manufacturing_order", assignableId: "mo-1", hours: 12, amount: 8 * 20 + 4 * 25 });
    const sickGroup = result.groups.find(g => g.accountId === "acct-sick")!;
    expect(sickGroup).toMatchObject({ assignableType: null, assignableId: null, hours: 8, amount: 8 * 20 });

    expect(result.totalHours).toBe(20);
    expect(result.totalAmount).toBe(8 * 20 + 4 * 25 + 8 * 20);
    expect(result.unrated).toEqual([]);
  });

  it("keeps a different assignable within the same account as its own group", () => {
    const entries: CostableEntry[] = [
      { id: "1", hours: 5, resourceId: "alice", timesheetTypeId: "work", assignableType: "manufacturing_order", assignableId: "mo-1" },
      { id: "2", hours: 3, resourceId: "alice", timesheetTypeId: "work", assignableType: "manufacturing_order", assignableId: "mo-2" },
    ];
    const result = costTimesheetEntries(entries, types, resources);
    expect(result.groups).toHaveLength(2);
  });

  it("reports entries with no resource cost rate as unrated, costed at zero, hours still counted", () => {
    const entries: CostableEntry[] = [
      { id: "1", hours: 6, resourceId: "carol", timesheetTypeId: "work", assignableType: null, assignableId: null },
    ];
    const result = costTimesheetEntries(entries, types, resources);
    expect(result.unrated).toEqual(["1"]);
    expect(result.totalHours).toBe(6);
    expect(result.totalAmount).toBe(0);
  });

  it("skips an entry whose type cannot be resolved rather than throwing", () => {
    const entries: CostableEntry[] = [
      { id: "1", hours: 6, resourceId: "alice", timesheetTypeId: "deleted-type", assignableType: null, assignableId: null },
    ];
    const result = costTimesheetEntries(entries, types, resources);
    expect(result.groups).toEqual([]);
    expect(result.totalHours).toBe(0);
  });
});
