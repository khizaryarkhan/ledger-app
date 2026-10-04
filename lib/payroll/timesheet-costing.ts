/**
 * Pure grouping/costing for a "Post timesheets" run — no `db`. Approved time
 * entries are costed at their resource's `costRatePerHour` and grouped by
 * (expense account, assignable dimension), not one GL line per resource —
 * per-resource/per-project detail stays in time_entries (the subledger); the
 * GL only ever needs the aggregate. Built the same way mo-completion.ts
 * assembles its `lines` before posting.
 */

import { round2 } from "@/lib/inventory/round";

export type CostableEntry = {
  id: string;
  hours: number;
  resourceId: string;
  timesheetTypeId: string;
  assignableType: string | null;
  assignableId: string | null;
};

export type TimesheetTypeInfo = { expenseAccountId: string };
export type ResourceCostInfo = { costRatePerHour: number | null };

export type CostedGroup = {
  accountId: string;
  assignableType: string | null;
  assignableId: string | null;
  hours: number;
  amount: number;
};

export type TimesheetCosting = {
  groups: CostedGroup[];
  totalHours: number;
  totalAmount: number;
  /** Entry ids whose resource has no cost rate set — counted in hours, 0 in amount. */
  unrated: string[];
};

export function costTimesheetEntries(
  entries: readonly CostableEntry[],
  typesById: ReadonlyMap<string, TimesheetTypeInfo>,
  resourcesById: ReadonlyMap<string, ResourceCostInfo>,
): TimesheetCosting {
  const groups = new Map<string, CostedGroup>();
  const unrated: string[] = [];
  let totalHours = 0;
  let totalAmount = 0;

  for (const e of entries) {
    const type = typesById.get(e.timesheetTypeId);
    if (!type) continue; // defensive — caller resolves every entry's type before costing
    const resource = resourcesById.get(e.resourceId);
    const rate = resource?.costRatePerHour ?? null;
    if (rate == null) unrated.push(e.id);
    const hours = round2(e.hours);
    const amount = round2(hours * (rate ?? 0));

    const key = `${type.expenseAccountId}|${e.assignableType ?? ""}|${e.assignableId ?? ""}`;
    const g = groups.get(key) ?? { accountId: type.expenseAccountId, assignableType: e.assignableType, assignableId: e.assignableId, hours: 0, amount: 0 };
    g.hours = round2(g.hours + hours);
    g.amount = round2(g.amount + amount);
    groups.set(key, g);

    totalHours = round2(totalHours + hours);
    totalAmount = round2(totalAmount + amount);
  }

  return { groups: [...groups.values()], totalHours, totalAmount, unrated };
}
