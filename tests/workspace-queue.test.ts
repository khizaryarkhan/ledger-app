import { describe, it, expect } from "vitest";
import { buildWorkspace, weekAhead, addDaysYmd, type WorkspaceInvoice } from "@/lib/workspace-queue";

const TODAY = "2026-11-27";

function inv(over: Partial<WorkspaceInvoice> = {}): WorkspaceInvoice {
  return {
    id: "i1", custId: "c1", custName: "Acme", projName: null, invoiceNumber: "INV-1",
    bal: 100, currency: "USD", days: 10, dueDate: "2026-11-17", email: "a@acme.test",
    stageLabel: "New", promiseDate: null, hasOpenDispute: false, escalatedToName: null,
    lastChaseDay: null, daysSinceChase: null, chaseCount: 0, unreadReply: false,
    ...over,
  };
}

describe("buildWorkspace sections", () => {
  it("puts an overdue, never-chased customer in Now", () => {
    const [c] = buildWorkspace([inv()], TODAY);
    expect(c.section).toBe("now");
    expect(c.top.type).toBe("email");
    expect(c.wake).toBeNull();
  });

  it("a customer chased today is Done and wakes 7 days later", () => {
    const [c] = buildWorkspace([inv({ lastChaseDay: TODAY, daysSinceChase: 0, chaseCount: 1 })], TODAY);
    expect(c.section).toBe("done");
    expect(c.wake?.date).toBe("2026-12-04");
  });

  it("waiting on a promise wakes the day after the promise date", () => {
    const [c] = buildWorkspace([inv({ promiseDate: "2026-12-01" })], TODAY);
    expect(c.section).toBe("wait");
    expect(c.wake).toEqual({ date: "2026-12-02", why: "Check the money arrived" });
  });

  it("a broken promise needs a call today, not a wait", () => {
    const [c] = buildWorkspace([inv({ promiseDate: "2026-11-20" })], TODAY);
    expect(c.section).toBe("now");
    expect(c.top.type).toBe("call");
  });

  it("escalated and owned has no wake date, names the owner", () => {
    const [c] = buildWorkspace([inv({ stageLabel: "Escalated", escalatedToName: "Sam" })], TODAY);
    expect(c.section).toBe("wait");
    expect(c.wake?.date).toBeNull();
    expect(c.wake?.why).toContain("Sam");
  });

  it("not yet due is idle and wakes on the first due date", () => {
    const [c] = buildWorkspace([inv({ days: -3, dueDate: "2026-11-30" })], TODAY);
    expect(c.section).toBe("idle");
    expect(c.wake?.date).toBe("2026-11-30");
  });

  it("an unread reply outranks everything", () => {
    const [c] = buildWorkspace([inv({ unreadReply: true, promiseDate: "2026-12-01" })], TODAY);
    expect(c.section).toBe("now");
    expect(c.top.type).toBe("reply");
  });
});

describe("buildWorkspace grouping and order", () => {
  it("never adds different currencies together", () => {
    const [c] = buildWorkspace([inv({ id: "a", bal: 100 }), inv({ id: "b", bal: 50, currency: "EUR" })], TODAY);
    expect(c.total).toEqual({ USD: 100, EUR: 50 });
  });

  it("one customer is one card; its most urgent invoice leads", () => {
    const list = buildWorkspace([
      inv({ id: "a", days: 5 }),
      inv({ id: "b", promiseDate: "2026-11-20" }),
    ], TODAY);
    expect(list).toHaveLength(1);
    expect(list[0].items[0].inv.id).toBe("b");
  });

  it("orders Now before Done before Waiting before Idle", () => {
    const list = buildWorkspace([
      inv({ id: "i", custId: "i", custName: "Idle", days: -2, dueDate: "2026-11-29" }),
      inv({ id: "w", custId: "w", custName: "Wait", promiseDate: "2026-12-03" }),
      inv({ id: "d", custId: "d", custName: "Done", lastChaseDay: TODAY, daysSinceChase: 0 }),
      inv({ id: "n", custId: "n", custName: "Now" }),
    ], TODAY);
    expect(list.map(c => c.section)).toEqual(["now", "done", "wait", "idle"]);
  });
});

describe("weekAhead", () => {
  it("lists who comes back on each day and skips Now customers", () => {
    const list = buildWorkspace([
      inv({ id: "w", custId: "w", custName: "Wait", promiseDate: "2026-11-29" }),
      inv({ id: "n", custId: "n", custName: "Now" }),
    ], TODAY);
    const cols = weekAhead(list, TODAY);
    expect(cols).toHaveLength(7);
    expect(cols.find(c => c.date === "2026-11-30")?.names).toEqual(["Wait"]);
    expect(cols.flatMap(c => c.names)).not.toContain("Now");
  });

  it("addDaysYmd crosses month and year ends", () => {
    expect(addDaysYmd("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysYmd("2026-11-27", 7)).toBe("2026-12-04");
  });
});
