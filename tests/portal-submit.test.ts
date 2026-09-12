/**
 * The customer portal's submit path.
 *
 * The first test below is the bug that reached a paying client twice: the
 * portal invites "a pay-by date, query, or note", its Submit button enables on
 * a bare comment — and the server ignored `note`, found nothing to persist,
 * and returned 400 "Nothing to submit". The page turns any non-ok response
 * into a full-screen "Link unavailable", so the most natural way to respond
 * looked like a broken link. This file exists so that can't come back quietly.
 */
import { describe, it, expect } from "vitest";
import {
  buildPortalSubmission,
  promisedWithoutNewDispute,
  DISPUTE_CATEGORIES,
  type PortalInvoiceRef,
} from "@/lib/portal-response";

const CTX = { orgId: "org-1", customerId: "cust-1", tokenId: "tok-1" };
const INV: PortalInvoiceRef = { id: "inv-1", invoiceNumber: "219", collectionOwnerId: "owner-1" };
const INV2: PortalInvoiceRef = { id: "inv-2", invoiceNumber: "220", collectionOwnerId: null };
const byId = (...rows: PortalInvoiceRef[]) => new Map(rows.map(r => [r.id, r]));

const build = (responses: any[], invoices = byId(INV, INV2)) =>
  buildPortalSubmission(responses, invoices, CTX);

describe("a note on its own is a real answer", () => {
  it("accepts a note-only response instead of rejecting the submission", () => {
    const out = build([{ invoiceId: "inv-1", note: "We paid this on the 3rd, please check." }]);
    expect(out.hasContent).toBe(true);           // the 400 that broke the portal
    expect(out.promiseRows).toHaveLength(0);
    expect(out.disputeRows).toHaveLength(0);
    expect(out.commRows).toHaveLength(1);        // recorded as an inbound message
    expect(out.commRows[0].body).toBe("We paid this on the 3rd, please check.");
    expect(out.commRows[0].direction).toBe("Inbound");
    expect(out.commRows[0].channel).toBe("Portal");
    expect(out.summary[0]).toContain("#219");
  });

  it("ignores whitespace-only text — that is not an answer", () => {
    expect(build([{ invoiceId: "inv-1", note: "   \n  " }]).hasContent).toBe(false);
  });

  it("reports nothing to submit for a genuinely empty response", () => {
    expect(build([{ invoiceId: "inv-1" }]).hasContent).toBe(false);
  });

  it("caps a very long note rather than letting it through unbounded", () => {
    const out = build([{ invoiceId: "inv-1", note: "x".repeat(5000) }]);
    expect(out.commRows[0].body).toHaveLength(2000);
  });
});

describe("promises", () => {
  it("records the date, amount and owner-facing summary", () => {
    const out = build([{ invoiceId: "inv-1", promise: { date: "2026-10-01", amount: "250.50" } }]);
    expect(out.promiseRows).toHaveLength(1);
    expect(out.promiseRows[0]).toMatchObject({
      invoiceId: "inv-1", promiseDate: "2026-10-01", amount: 250.5,
      source: "Customer Portal", status: "Active", tokenId: "tok-1", orgId: "org-1",
    });
    expect(out.summary[0]).toContain("committed to pay 250.5 by 2026-10-01");
  });

  it("treats a missing or unparseable amount as 'the full balance', not zero", () => {
    // Storing 0 here would read as "promised to pay nothing" and silently
    // under-report the committed figure on the board.
    expect(build([{ invoiceId: "inv-1", promise: { date: "2026-10-01" } }]).promiseRows[0].amount).toBeNull();
    expect(build([{ invoiceId: "inv-1", promise: { date: "2026-10-01", amount: "abc" } }]).promiseRows[0].amount).toBeNull();
  });

  it("needs a date — an amount alone is not a commitment", () => {
    expect(build([{ invoiceId: "inv-1", promise: { amount: 100 } }]).hasContent).toBe(false);
  });
});

describe("disputes", () => {
  it("assigns the dispute to the invoice's collection owner", () => {
    const out = build([{ invoiceId: "inv-1", dispute: { category: "Wrong Amount", reason: "Billed twice" } }]);
    expect(out.disputeRows[0]).toMatchObject({
      category: "Wrong Amount", assignedTo: "owner-1", status: "Open", source: "Customer Portal",
    });
  });

  it("leaves it unassigned when the invoice has no owner, rather than inventing one", () => {
    const out = build([{ invoiceId: "inv-2", dispute: { category: "Duplicate" } }]);
    expect(out.disputeRows[0].assignedTo).toBeNull();
  });

  it("funnels an unrecognised category into Other instead of storing it raw", () => {
    const out = build([{ invoiceId: "inv-1", dispute: { category: "<script>alert(1)</script>" } }]);
    expect(out.disputeRows[0].category).toBe("Other");
    expect(DISPUTE_CATEGORIES).toContain("Other");
  });
});

describe("combinations and scoping", () => {
  it("records a promise, a dispute and a note on one invoice as one communication", () => {
    const out = build([{
      invoiceId: "inv-1",
      promise: { date: "2026-10-01", amount: 100 },
      dispute: { category: "Wrong Amount", reason: "Partly wrong" },
      note: "Calling you tomorrow",
    }]);
    expect(out.promiseRows).toHaveLength(1);
    expect(out.disputeRows).toHaveLength(1);
    expect(out.commRows).toHaveLength(1);
    expect(out.commRows[0].body.split("\n")).toHaveLength(3);
  });

  it("skips invoices that aren't in this token's snapshot", () => {
    // The caller filters ids too; this is the second line of defence against a
    // crafted payload reaching another customer's invoice.
    const out = build([{ invoiceId: "someone-elses-invoice", note: "hello" }]);
    expect(out.hasContent).toBe(false);
    expect(out.commRows).toHaveLength(0);
  });

  it("handles several invoices in one submission independently", () => {
    const out = build([
      { invoiceId: "inv-1", promise: { date: "2026-10-01" } },
      { invoiceId: "inv-2", note: "Query on this one" },
    ]);
    expect(out.promiseRows.map(p => p.invoiceId)).toEqual(["inv-1"]);
    expect(out.commRows.map(c => c.invoiceId)).toEqual(["inv-1", "inv-2"]);
  });
});

describe("promisedWithoutNewDispute — which disputes to close", () => {
  it("closes the open dispute when the customer commits to pay", () => {
    const out = build([{ invoiceId: "inv-1", promise: { date: "2026-10-01" } }]);
    expect(promisedWithoutNewDispute(out.promiseRows, out.disputeRows)).toEqual(["inv-1"]);
  });

  it("does NOT close it when they promise AND dispute the same invoice", () => {
    // They're paying under protest; resolving the dispute would erase the
    // complaint the client still has to answer.
    const out = build([{
      invoiceId: "inv-1",
      promise: { date: "2026-10-01" },
      dispute: { category: "Wrong Amount" },
    }]);
    expect(promisedWithoutNewDispute(out.promiseRows, out.disputeRows)).toEqual([]);
  });

  it("closes only the promised invoice when two are answered differently", () => {
    const out = build([
      { invoiceId: "inv-1", promise: { date: "2026-10-01" } },
      { invoiceId: "inv-2", dispute: { category: "Duplicate" } },
    ]);
    expect(promisedWithoutNewDispute(out.promiseRows, out.disputeRows)).toEqual(["inv-1"]);
  });
});
