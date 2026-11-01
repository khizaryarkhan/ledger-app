/**
 * Resource cost - pure, no db. cost = hours x the resource's cost rate.
 *
 * A resource with no cost rate is never silently costed at 0: its hours are
 * still counted, flagged `unrated`, and surfaced as a warning so a cost total
 * is never read as complete when it is not.
 *
 * Dates are YYYY-MM-DD strings, sliced, never built into a Date.
 */

export type CostGroupBy = "assignable" | "resource" | "month";

export type CostEntry = {
  resourceId: string;
  date: string; // YYYY-MM-DD
  hours: number;
  status: string;
  assignableType: string | null;
  assignableId: string | null;
};

export type CostResource = { id: string; name: string; costRate: number | null };

export type CostBucket = {
  key: string;
  assignableType: string | null;
  assignableId: string | null;
  hours: number;          // all counted hours (approved + posted + pending)
  approvedHours: number;
  postedHours: number;
  pendingHours: number;   // draft + submitted
  cost: number;           // rated hours x rate, all counted statuses
  approvedCost: number;
  postedCost: number;
  pendingCost: number;
  unratedHours: number;   // hours whose resource has no cost rate
  hasUnrated: boolean;
};

export type CostTotals = Omit<CostBucket, "key" | "assignableType" | "assignableId">;

export type CostSummary = {
  buckets: CostBucket[];
  totals: CostTotals;
  unratedHours: number;
  unratedResourceIds: string[];
};

type StatusBucket = "approved" | "posted" | "pending";

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

/** draft/submitted are "pending"; rejected entries cost nothing and are ignored. */
export function statusBucket(status: string): StatusBucket | null {
  if (status === "approved") return "approved";
  if (status === "posted") return "posted";
  if (status === "draft" || status === "submitted") return "pending";
  return null;
}

export function entryCost(hours: number, rate: number | null): number {
  return rate == null ? 0 : hours * rate;
}

export function monthOf(date: string): string { return date.slice(0, 7); }

export function entryKey(e: CostEntry, groupBy: CostGroupBy): string {
  if (groupBy === "resource") return e.resourceId;
  if (groupBy === "month") return monthOf(e.date);
  return e.assignableType && e.assignableId ? `${e.assignableType}:${e.assignableId}` : "unassigned";
}

function emptyBucket(key: string, e?: CostEntry, groupBy?: CostGroupBy): CostBucket {
  const byAssignable = groupBy === "assignable" && !!e?.assignableType && !!e.assignableId;
  return {
    key,
    assignableType: byAssignable ? e!.assignableType : null,
    assignableId: byAssignable ? e!.assignableId : null,
    hours: 0, approvedHours: 0, postedHours: 0, pendingHours: 0,
    cost: 0, approvedCost: 0, postedCost: 0, pendingCost: 0,
    unratedHours: 0, hasUnrated: false,
  };
}

function add(b: CostBucket, status: StatusBucket, hours: number, rate: number | null): CostBucket {
  const cost = entryCost(hours, rate);
  const unrated = rate == null ? hours : 0;
  return {
    ...b,
    hours: b.hours + hours,
    approvedHours: b.approvedHours + (status === "approved" ? hours : 0),
    postedHours: b.postedHours + (status === "posted" ? hours : 0),
    pendingHours: b.pendingHours + (status === "pending" ? hours : 0),
    cost: b.cost + cost,
    approvedCost: b.approvedCost + (status === "approved" ? cost : 0),
    postedCost: b.postedCost + (status === "posted" ? cost : 0),
    pendingCost: b.pendingCost + (status === "pending" ? cost : 0),
    unratedHours: b.unratedHours + unrated,
    hasUnrated: b.hasUnrated || unrated > 0,
  };
}

function tidy(b: CostBucket): CostBucket {
  return {
    ...b,
    hours: round2(b.hours), approvedHours: round2(b.approvedHours), postedHours: round2(b.postedHours),
    pendingHours: round2(b.pendingHours), unratedHours: round2(b.unratedHours),
    cost: round4(b.cost), approvedCost: round4(b.approvedCost), postedCost: round4(b.postedCost), pendingCost: round4(b.pendingCost),
  };
}

/** Aggregate entries in [from, to] (inclusive) by the chosen grouping. */
export function computeCostSummary(
  entries: CostEntry[], resources: CostResource[], groupBy: CostGroupBy, from: string, to: string,
): CostSummary {
  const rateById = new Map(resources.map(r => [r.id, r.costRate]));
  const map = new Map<string, CostBucket>();
  let totals = emptyBucket("total");
  const unratedIds = new Set<string>();

  for (const e of entries) {
    const d = e.date.slice(0, 10);
    if (d < from || d > to) continue;
    const status = statusBucket(e.status);
    if (!status) continue;
    const rate = rateById.get(e.resourceId) ?? null;
    if (rate == null) unratedIds.add(e.resourceId);
    const key = entryKey(e, groupBy);
    map.set(key, add(map.get(key) ?? emptyBucket(key, e, groupBy), status, e.hours, rate));
    totals = add(totals, status, e.hours, rate);
  }

  const buckets = [...map.values()].map(tidy)
    .sort((a, b) => groupBy === "month" ? a.key.localeCompare(b.key) : b.cost - a.cost || b.hours - a.hours);
  const t = tidy(totals);
  return {
    buckets,
    totals: {
      hours: t.hours, approvedHours: t.approvedHours, postedHours: t.postedHours, pendingHours: t.pendingHours,
      cost: t.cost, approvedCost: t.approvedCost, postedCost: t.postedCost, pendingCost: t.pendingCost,
      unratedHours: t.unratedHours, hasUnrated: t.hasUnrated,
    },
    unratedHours: t.unratedHours,
    unratedResourceIds: [...unratedIds],
  };
}

/** Approved + posted cost only - the committed figure shown on a project panel. */
export function committedCost(s: Pick<CostBucket, "approvedCost" | "postedCost">): number {
  return round4(s.approvedCost + s.postedCost);
}
