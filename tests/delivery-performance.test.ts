/**
 * Delivery performance rules (0114): lead-time resolution, promise history,
 * and on-time / in-full classification. Pure — no db.
 */
import { describe, it, expect } from "vitest";
import {
  resolveLeadTimeDays, defaultRequestedDate, lineDueDate, applyPromise,
  confirmationStatus, classifyLineDelivery, scoreParty, daysBetween,
} from "@/lib/inventory/delivery-performance";

describe("resolveLeadTimeDays", () => {
  it("prefers the item's supplier link over the supplier default", () => {
    expect(resolveLeadTimeDays(5, 30)).toBe(5);
  });
  it("falls back to the supplier default, and a 0-day link still wins", () => {
    expect(resolveLeadTimeDays(null, 30)).toBe(30);
    expect(resolveLeadTimeDays(0, 30)).toBe(0);
  });
  it("invents nothing when neither is set", () => {
    expect(resolveLeadTimeDays(null, undefined)).toBeNull();
    expect(resolveLeadTimeDays(-1, NaN)).toBeNull();
  });
});

describe("defaultRequestedDate", () => {
  it("uses the header delivery date when the buyer gave one", () => {
    expect(defaultRequestedDate("2026-10-01", "2026-10-20", 5)).toBe("2026-10-20");
  });
  it("otherwise order date + lead time, across a month end", () => {
    expect(defaultRequestedDate("2026-10-28", null, 7)).toBe("2026-11-04");
  });
  it("null with no header date and no lead time", () => {
    expect(defaultRequestedDate("2026-10-28", null, null)).toBeNull();
  });
});

describe("lineDueDate", () => {
  it("promise beats request", () => {
    expect(lineDueDate({ promisedDate: "2026-11-05", requestedDate: "2026-11-01" })).toBe("2026-11-05");
    expect(lineDueDate({ promisedDate: null, requestedDate: "2026-11-01" })).toBe("2026-11-01");
    expect(lineDueDate({})).toBeNull();
  });
});

describe("applyPromise", () => {
  it("the first promise becomes the original and is not a revision", () => {
    expect(applyPromise({}, "2026-11-05")).toEqual({ promisedDate: "2026-11-05", originalPromisedDate: "2026-11-05", promiseRevisions: 0 });
  });
  it("a moved promise keeps the original and counts a revision", () => {
    const moved = applyPromise(applyPromise({}, "2026-11-05"), "2026-11-12");
    expect(moved).toEqual({ promisedDate: "2026-11-12", originalPromisedDate: "2026-11-05", promiseRevisions: 1 });
  });
  it("re-saving the same date is not a revision", () => {
    const cur = { promisedDate: "2026-11-05", originalPromisedDate: "2026-11-05", promiseRevisions: 0 };
    expect(applyPromise(cur, "2026-11-05").promiseRevisions).toBe(0);
  });
  it("clearing keeps the history", () => {
    const cur = { promisedDate: "2026-11-12", originalPromisedDate: "2026-11-05", promiseRevisions: 1 };
    expect(applyPromise(cur, null)).toEqual({ promisedDate: null, originalPromisedDate: "2026-11-05", promiseRevisions: 1 });
  });
  it("refuses a malformed date", () => {
    expect(() => applyPromise({}, "05/11/2026")).toThrow();
  });
});

describe("confirmationStatus", () => {
  it("confirmed beats sent beats nothing", () => {
    expect(confirmationStatus({ sentAt: new Date(), confirmedAt: new Date() })).toBe("Confirmed");
    expect(confirmationStatus({ sentAt: new Date() })).toBe("Sent");
    expect(confirmationStatus({})).toBe("Unconfirmed");
  });
});

describe("daysBetween", () => {
  it("reads calendar dates literally across a DST change", () => {
    expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    expect(daysBetween("2026-11-02", "2026-11-01")).toBe(-1);
  });
});

const base = { orderedQty: 100, deliveredQty: 0, lastDeliveryDate: null as string | null, dueDate: "2026-11-01" as string | null, originalDueDate: "2026-11-01" as string | null, closed: false, asOf: "2026-10-28" };

describe("classifyLineDelivery", () => {
  it("open and not yet due scores nothing", () => {
    const r = classifyLineDelivery(base);
    expect(r.state).toBe("Open");
    expect(r.onTime).toBeNull();
    expect(r.inFull).toBeNull();
  });
  it("past due and undelivered is overdue and already a miss", () => {
    expect(classifyLineDelivery({ ...base, asOf: "2026-11-04" })).toMatchObject({ state: "Overdue", onTime: false, daysLate: 3 });
  });
  it("full delivery on the due date is on time and in full", () => {
    expect(classifyLineDelivery({ ...base, deliveredQty: 100, lastDeliveryDate: "2026-11-01" }))
      .toMatchObject({ state: "Delivered", onTime: true, inFull: true, daysLate: 0 });
  });
  it("late delivery is in full but not on time", () => {
    expect(classifyLineDelivery({ ...base, deliveredQty: 100, lastDeliveryDate: "2026-11-04" }))
      .toMatchObject({ onTime: false, inFull: true, daysLate: 3 });
  });
  it("closed short is complete but never in full", () => {
    expect(classifyLineDelivery({ ...base, deliveredQty: 80, lastDeliveryDate: "2026-10-30", closed: true }))
      .toMatchObject({ state: "Closed short", complete: true, inFull: false, onTime: true });
  });
  it("on time vs a slipped promise is not on time vs the original", () => {
    const r = classifyLineDelivery({ ...base, dueDate: "2026-11-10", originalDueDate: "2026-11-01", deliveredQty: 100, lastDeliveryDate: "2026-11-08" });
    expect(r.onTime).toBe(true);
    expect(r.onTimeVsOriginal).toBe(false);
  });
  it("a line with no due date is complete but unscored for timing", () => {
    const r = classifyLineDelivery({ ...base, dueDate: null, originalDueDate: null, deliveredQty: 100, lastDeliveryDate: "2026-11-01" });
    expect(r.onTime).toBeNull();
    expect(r.inFull).toBe(true);
  });
});

describe("scoreParty", () => {
  const mk = (o: Partial<typeof base>, lead: number | null = null, rev = 0) =>
    ({ r: classifyLineDelivery({ ...base, ...o }), leadTimeActual: lead, revisions: rev });
  it("rolls lines up into OTIF percentages", () => {
    const s = scoreParty([
      mk({ deliveredQty: 100, lastDeliveryDate: "2026-11-01" }, 10),
      mk({ deliveredQty: 100, lastDeliveryDate: "2026-11-05" }, 14, 1),
      mk({ deliveredQty: 50, lastDeliveryDate: "2026-10-30", closed: true }, 8),
      mk({}),
    ]);
    expect(s.lines).toBe(4);
    expect(s.open).toBe(1);
    expect(s.onTimePct).toBe(66.7);
    expect(s.inFullPct).toBe(66.7);
    expect(s.otifPct).toBe(33.3);
    expect(s.avgDaysLate).toBe(4);
    expect(s.avgLeadTimeDays).toBe(10.7);
    expect(s.revisedLines).toBe(1);
  });
  it("empty is all nulls, never NaN", () => {
    expect(scoreParty([]).otifPct).toBeNull();
  });
});
