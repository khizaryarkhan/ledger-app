import { describe, it, expect } from "vitest";
import { compositionKeyOf, classifyComposition } from "@/lib/receivable-composition";

// Clicking a Collections Board composition segment filters by the SAME
// first-match rule the strip counts with. The old click applied loose
// stage/response filters that ignored the rule's priority, so the board showed
// a different set than the segment's own count.
const inv = (o: any) => ({ escalationType: null, collectionStage: null, hasOpenDispute: false, promiseDate: null, overdueDays: 0, ...o });

describe("composition segment filter", () => {
  it("an escalated invoice with a promise is Escalated, not Committed", () => {
    expect(compositionKeyOf(inv({ collectionStage: "Escalated", escalationType: "Handed Over", promiseDate: "2026-10-01" }))).toBe("handedOver");
  });
  it("an overdue disputed invoice is Disputed, not In Collection", () => {
    expect(compositionKeyOf(inv({ hasOpenDispute: true, overdueDays: 40 }))).toBe("disputed");
  });
  it("a not-yet-due invoice with a promise is Committed, not Not Yet Due", () => {
    expect(compositionKeyOf(inv({ promiseDate: "2026-10-01", overdueDays: -5 }))).toBe("committed");
  });
  it("filtering by the key reproduces every segment's count exactly", () => {
    const items = [
      inv({ collectionStage: "Escalated", escalationType: "Legal Review", hasOpenDispute: true, amount: 1 }),
      inv({ hasOpenDispute: true, overdueDays: 10, amount: 1 }),
      inv({ promiseDate: "2026-10-01", overdueDays: 10, amount: 1 }),
      inv({ overdueDays: 10, amount: 1 }),
      inv({ amount: 1 }),
      inv({ collectionStage: "Retention", overdueDays: 10, amount: 1 }),
    ];
    const c = classifyComposition(items);
    for (const g of c.groups) expect(items.filter(i => compositionKeyOf(i) === g.key).length).toBe(g.count);
  });
});
