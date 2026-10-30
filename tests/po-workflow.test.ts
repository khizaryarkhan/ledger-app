import { describe, it, expect } from "vitest";
import {
  derivePoStage, lineState, lineBalance, diffSubmission, isManuallySettable, isPoExceptionStage, repriceLine,
} from "@/lib/accounting/po-workflow";

describe("repriceLine", () => {
  const l = { rate: 24, amount: 720, taxAmount: 72, unitsPerOrderUnit: 10 };
  it("re-prices at the same rate and scales tax in proportion", () => {
    expect(repriceLine(l, 20)).toEqual({ amount: 480, taxAmount: 48, orderedBase: 200 });
  });
  it("converts to the base unit the receiving works in", () => {
    expect(repriceLine({ ...l, unitsPerOrderUnit: 0.5 }, 30).orderedBase).toBe(15);
  });
  it("goes to zero when the supplier cannot supply the line", () => {
    expect(repriceLine(l, 0)).toEqual({ amount: 0, taxAmount: 0, orderedBase: 0 });
  });
  it("keeps cents exact", () => {
    expect(repriceLine({ rate: 0.1, amount: 0.3, taxAmount: 0, unitsPerOrderUnit: 1 }, 3).amount).toBe(0.3);
  });
});

const TODAY = "2026-10-30";
const line = (o: Partial<{ orderedBaseQty: number; receivedQty: number; closed: boolean; promisedDate: string | null; requestedDate: string | null }> = {}) =>
  ({ orderedBaseQty: 100, receivedQty: 0, closed: false, promisedDate: null, requestedDate: null, ...o });

describe("lineState", () => {
  it("is Received once everything ordered has arrived", () => {
    expect(lineState(line({ receivedQty: 100 }), TODAY)).toBe("Received");
  });
  it("is Closed short when closed with a shortfall", () => {
    expect(lineState(line({ receivedQty: 60, closed: true }), TODAY)).toBe("ClosedShort");
  });
  it("is Late when the promised date has passed with a balance", () => {
    expect(lineState(line({ promisedDate: "2026-10-24" }), TODAY)).toBe("Late");
  });
  it("prefers the promise over the request when judging lateness", () => {
    expect(lineState(line({ requestedDate: "2026-10-20", promisedDate: "2026-11-05" }), TODAY)).toBe("NotReceived");
  });
  it("is Partly received when some has arrived and nothing is overdue", () => {
    expect(lineState(line({ receivedQty: 20, promisedDate: "2026-11-05" }), TODAY)).toBe("PartlyReceived");
  });
  it("never reports a closed line as late", () => {
    expect(lineState(line({ receivedQty: 60, closed: true, promisedDate: "2026-10-01" }), TODAY)).toBe("ClosedShort");
  });
});

describe("lineBalance", () => {
  it("is zero for a closed line", () => {
    expect(lineBalance({ orderedBaseQty: 100, receivedQty: 60, closed: true })).toBe(0);
  });
  it("treats a remainder below the quantity epsilon as zero", () => {
    expect(lineBalance({ orderedBaseQty: 100, receivedQty: 99.9999999, closed: false })).toBe(0);
  });
  it("is the outstanding quantity otherwise", () => {
    expect(lineBalance({ orderedBaseQty: 100, receivedQty: 60, closed: false })).toBe(40);
  });
});

describe("derivePoStage", () => {
  const base = { lines: [line()] };
  it("starts at Created", () => expect(derivePoStage(base, TODAY)).toBe("Created"));
  it("moves to Sent then Confirmed", () => {
    expect(derivePoStage({ ...base, sentAt: new Date() }, TODAY)).toBe("Sent");
    expect(derivePoStage({ ...base, sentAt: new Date(), confirmedAt: new Date() }, TODAY)).toBe("Confirmed");
  });
  it("shows Rejected above everything", () => {
    expect(derivePoStage({ ...base, rejectedAt: new Date(), hasPendingResponse: true, manualStage: "OnHold" }, TODAY)).toBe("Rejected");
  });
  it("shows Revision proposed above a manual stage and confirmation", () => {
    expect(derivePoStage({ ...base, confirmedAt: new Date(), hasPendingResponse: true, manualStage: "OnHold" }, TODAY)).toBe("RevisionProposed");
  });
  it("lets a manual stage override the derived commitment", () => {
    expect(derivePoStage({ ...base, sentAt: new Date(), manualStage: "OnHold" }, TODAY)).toBe("OnHold");
  });
  it("reports Late when any line is overdue", () => {
    const lines = [line({ receivedQty: 100 }), line({ promisedDate: "2026-10-01" })];
    expect(derivePoStage({ lines, confirmedAt: new Date() }, TODAY)).toBe("Late");
  });
  it("reads Cancelled, not Received, when every line is closed with nothing received", () => {
    const lines = [line({ closed: true }), line({ orderedBaseQty: 0 })];
    expect(derivePoStage({ lines, sentAt: new Date() }, TODAY)).toBe("Cancelled");
  });
  it("reports Received when every line is received or closed short", () => {
    const lines = [line({ receivedQty: 100 }), line({ receivedQty: 10, closed: true })];
    expect(derivePoStage({ lines, confirmedAt: new Date() }, TODAY)).toBe("Received");
  });
});

describe("stage rules", () => {
  it("does not let a user hand-pick an action-driven stage", () => {
    for (const k of ["Created", "Sent", "RevisionProposed", "Confirmed", "Rejected"]) expect(isManuallySettable(k)).toBe(false);
    expect(isManuallySettable("OnHold")).toBe(true);
    expect(isManuallySettable("In transit")).toBe(true);
  });
  it("reserves colour for exceptions", () => {
    expect(isPoExceptionStage("RevisionProposed")).toBe(true);
    expect(isPoExceptionStage("Sent")).toBe(false);
  });
});

describe("diffSubmission", () => {
  const ordered = [
    { id: "a", qty: 30, promisedDate: null, requestedDate: "2026-10-31", closed: false },
    { id: "b", qty: 15, promisedDate: null, requestedDate: "2026-10-31", closed: false },
  ];
  it("returns only the lines that changed", () => {
    const r = diffSubmission(ordered, [{ lineId: "a", qty: 20, date: "2026-11-02" }, { lineId: "b", qty: 15, date: "2026-10-31" }]);
    expect(r).toEqual([{ lineId: "a", proposedQty: 20, proposedDate: "2026-11-02" }]);
  });
  it("treats a date-only change as a revision", () => {
    expect(diffSubmission(ordered, [{ lineId: "b", qty: 15, date: "2026-11-03" }])).toHaveLength(1);
  });
  it("allows zero (cannot supply this line)", () => {
    expect(diffSubmission(ordered, [{ lineId: "a", qty: 0 }])[0].proposedQty).toBe(0);
  });
  it("returns nothing when the supplier changed nothing", () => {
    expect(diffSubmission(ordered, [{ lineId: "a", qty: 30 }, { lineId: "b", qty: 15 }])).toEqual([]);
  });
  it("rejects a line from another order", () => {
    expect(() => diffSubmission(ordered, [{ lineId: "zzz", qty: 1 }])).toThrow(/does not belong/);
  });
  it("rejects a negative quantity and a malformed date", () => {
    expect(() => diffSubmission(ordered, [{ lineId: "a", qty: -1 }])).toThrow(/negative/);
    expect(() => diffSubmission(ordered, [{ lineId: "a", qty: 5, date: "02/11/2026" }])).toThrow(/valid/);
  });
  it("ignores edits to a closed line", () => {
    const closed = [{ ...ordered[0], closed: true }];
    expect(diffSubmission(closed, [{ lineId: "a", qty: 5 }])).toEqual([]);
  });
  it("rejects the same line twice", () => {
    expect(() => diffSubmission(ordered, [{ lineId: "a", qty: 1 }, { lineId: "a", qty: 2 }])).toThrow(/twice/);
  });
});
