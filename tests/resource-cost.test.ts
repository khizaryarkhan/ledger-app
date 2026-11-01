import { describe, it, expect } from "vitest";
import { computeCostSummary, entryCost, statusBucket, committedCost, type CostEntry } from "@/lib/resources/cost";

const R = [
  { id: "a", name: "Ann", costRate: 50 },
  { id: "b", name: "Bob", costRate: null },
];
const e = (o: Partial<CostEntry>): CostEntry => ({
  resourceId: "a", date: "2026-10-05", hours: 2, status: "approved", assignableType: "project", assignableId: "p1", ...o,
});

describe("resource cost", () => {
  it("costs hours x rate; null rate is not costed but flagged", () => {
    expect(entryCost(2, 50)).toBe(100);
    expect(entryCost(2, null)).toBe(0);
    const s = computeCostSummary([e({}), e({ resourceId: "b", hours: 3 })], R, "assignable", "2026-10-01", "2026-10-31");
    expect(s.totals.cost).toBe(100);
    expect(s.totals.hours).toBe(5);
    expect(s.unratedHours).toBe(3);
    expect(s.unratedResourceIds).toEqual(["b"]);
    expect(s.buckets[0].hasUnrated).toBe(true);
  });

  it("splits approved, posted and pending; ignores rejected", () => {
    expect(statusBucket("submitted")).toBe("pending");
    expect(statusBucket("rejected")).toBeNull();
    const s = computeCostSummary([
      e({ status: "approved" }), e({ status: "posted", hours: 1 }), e({ status: "draft", hours: 4 }), e({ status: "rejected", hours: 9 }),
    ], R, "assignable", "2026-10-01", "2026-10-31");
    expect(s.totals).toMatchObject({ approvedHours: 2, postedHours: 1, pendingHours: 4, hours: 7, approvedCost: 100, postedCost: 50, pendingCost: 200 });
    expect(committedCost(s.totals)).toBe(150);
  });

  it("groups by assignable, resource and month", () => {
    const rows = [
      e({}), e({ assignableId: "p2", date: "2026-11-02" }), e({ assignableType: null, assignableId: null }),
    ];
    const byA = computeCostSummary(rows, R, "assignable", "2026-10-01", "2026-11-30");
    expect(byA.buckets.map(b => b.key).sort()).toEqual(["project:p1", "project:p2", "unassigned"]);
    expect(byA.buckets.find(b => b.key === "project:p1")!.assignableId).toBe("p1");
    expect(computeCostSummary(rows, R, "resource", "2026-10-01", "2026-11-30").buckets).toHaveLength(1);
    expect(computeCostSummary(rows, R, "month", "2026-10-01", "2026-11-30").buckets.map(b => b.key)).toEqual(["2026-10", "2026-11"]);
  });

  it("filters by inclusive date range as strings", () => {
    const s = computeCostSummary([e({ date: "2026-10-01" }), e({ date: "2026-10-31" }), e({ date: "2026-11-01" })], R, "month", "2026-10-01", "2026-10-31");
    expect(s.totals.hours).toBe(4);
  });

  it("does not drift on fractional hours", () => {
    const s = computeCostSummary([e({ hours: 0.1 }), e({ hours: 0.2 })], [{ id: "a", name: "A", costRate: 10 }], "month", "2026-10-01", "2026-10-31");
    expect(s.totals.cost).toBe(3);
  });
});
