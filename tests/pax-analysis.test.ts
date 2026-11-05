import { describe, expect, it } from "vitest";
import { daysBetween, filterReceivables, round2, summarisePayments, summariseReceivables, type ArRow, type PaymentRow } from "@/lib/pax/analysis";
import { bodyFieldsOf } from "@/scripts/gen-mcp-manifest";

const ar = (o: Partial<ArRow> = {}): ArRow => ({
  customerId: "c1", customer: "Acme", project: null, txnType: "Invoice", txnNumber: "1", txnDate: "2026-09-01", dueDate: "2026-10-01",
  currency: "EUR", openBalance: 100, daysPastDue: 10, bucket: "1-30", stage: "Reminder", escalatedTo: null, escalationType: null,
  disputed: false, promiseDate: null, ...o,
});
const pay = (o: Partial<PaymentRow> = {}): PaymentRow => ({
  id: "p1", customerId: "c1", customer: "Acme", txnDate: "2026-11-04", totalAmount: 50, unappliedAmount: 0, currency: "EUR", method: "Bank", ref: null, depositAccount: null, ...o,
});

describe("receivable analysis", () => {
  it("never adds one currency to another", () => {
    const s = summariseReceivables([ar({ openBalance: 100 }), ar({ openBalance: 50, currency: "USD" }), ar({ openBalance: 25 })], { groupBy: "stage" });
    expect(s.totals).toEqual([{ currency: "EUR", count: 2, amount: 125 }, { currency: "USD", count: 1, amount: 50 }]);
    expect(s.groups).toHaveLength(2);
    expect(s.groups.find((g) => g.currency === "EUR")?.amount).toBe(125);
  });

  it("groups by escalation owner and labels the unescalated", () => {
    const s = summariseReceivables([ar({ escalatedTo: "Legal", openBalance: 10 }), ar({ openBalance: 90 })], { groupBy: "escalated_to" });
    expect(s.groups.map((g) => g.key)).toEqual(["(not escalated)", "Legal"]);
  });

  it("filters case-insensitively and by minimum days past due", () => {
    const rows = [ar({ stage: "Escalated", daysPastDue: 90 }), ar({ stage: "Reminder", daysPastDue: 5 })];
    expect(filterReceivables(rows, { stage: ["escalated"] })).toHaveLength(1);
    expect(filterReceivables(rows, { minDaysPastDue: 30 })).toHaveLength(1);
    expect(filterReceivables(rows, { disputed: true })).toHaveLength(0);
  });

  it("keeps credits as negatives and rounds to cents", () => {
    const s = summariseReceivables([ar({ openBalance: 0.1 }), ar({ openBalance: 0.2 }), ar({ openBalance: -5 })]);
    expect(s.totals[0].amount).toBe(-4.7);
  });

  it("limits groups and says how many were left out", () => {
    const rows = ["a", "b", "c"].map((c, i) => ar({ customer: c, openBalance: 10 * (i + 1) }));
    const s = summariseReceivables(rows, { groupBy: "customer", limit: 2 });
    expect(s.groups).toHaveLength(2);
    expect(s.moreGroups).toBe(1);
    expect(s.groups[0].key).toBe("c");
  });
});

describe("payment analysis", () => {
  it("totals per currency and tracks unapplied money", () => {
    const s = summarisePayments([pay({ totalAmount: 100, unappliedAmount: 40 }), pay({ totalAmount: 20, currency: "USD" })], { groupBy: "currency" });
    expect(s.totals).toEqual([{ currency: "EUR", count: 1, amount: 100, unapplied: 40 }, { currency: "USD", count: 1, amount: 20, unapplied: 0 }]);
  });

  it("groups by day newest first", () => {
    const s = summarisePayments([pay({ txnDate: "2026-11-03" }), pay({ txnDate: "2026-11-05" })], { groupBy: "day" });
    expect(s.groups.map((g) => g.key)).toEqual(["2026-11-05", "2026-11-03"]);
  });

  it("labels a payment with no method", () => {
    expect(summarisePayments([pay({ method: null })], { groupBy: "method" }).groups[0].key).toBe("(not recorded)");
  });
});

describe("date helpers", () => {
  it("counts whole days with no timezone drift", () => {
    expect(daysBetween("2026-10-31", "2026-11-05")).toBe(5);
    expect(round2(1.005)).toBe(1.01);
  });
});

describe("manifest body fields", () => {
  it("reads keys from every zod object and from body.x reads, without method-name noise", () => {
    const src = `const S = z.object({ promiseDate: z.string(), note: z.object({ inner: z.string() }).optional(), amount: z.number() });
      const b = await req.json(); if (b.reason) {} body.json(); body.length`;
    const f = bodyFieldsOf(src);
    expect(f).toEqual(expect.arrayContaining(["promiseDate", "note", "amount", "reason"]));
    expect(f).toContain("inner");
    expect(f).not.toContain("json");
  });
});
