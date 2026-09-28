/**
 * The daily promise sweeps (kept + broken).
 *
 * Root bug (2026-09-28): inngest/functions/chase.ts's brokenPromiseSweep is
 * the ONLY copy that is actually scheduled (Inngest cron "0 8 * * *") — but it
 * had no isNull(invoices.deletedAt) filter (could break a promise on a
 * soft-deleted invoice) and no "kept/Met" sweep at all, so kept promises were
 * never marked Met in production. app/api/cron/route.ts had the correct,
 * complete logic, but nothing schedules that route — it only runs when
 * someone hits it manually. This file pins the single classification rule
 * both sweeps must now share, in lib/promise-sweep.ts.
 */
import { describe, it, expect } from "vitest";
import {
  classifyPromise,
  planPromiseSweep,
  wasPaidOnTime,
  keptPromiseCommunication,
  brokenPromiseCommunication,
  type PromiseSweepCandidate,
} from "@/lib/promise-sweep";

const TODAY = "2026-09-28";

const base = (overrides: Partial<PromiseSweepCandidate> = {}): PromiseSweepCandidate => ({
  id: "promise-1",
  orgId: "org-1",
  invoiceId: "inv-1",
  customerId: "cust-1",
  projectId: null,
  promiseDate: "2026-09-20",
  status: "Active",
  paymentStatus: "Unpaid",
  paidAt: null,
  invoiceDeletedAt: null,
  ...overrides,
});

describe("classifyPromise — kept runs before broken", () => {
  it("marks Active + Paid + past-date as Met, not Broken", () => {
    // The core fix: paying an invoice after its promise date must never be
    // read as a broken commitment just because the date has passed.
    const c = base({ paymentStatus: "Paid", promiseDate: "2026-09-01" });
    expect(classifyPromise(c, TODAY)).toBe("Met");
  });

  it("marks Active + unpaid + past-date as Broken", () => {
    const c = base({ paymentStatus: "Unpaid", promiseDate: "2026-09-01" });
    expect(classifyPromise(c, TODAY)).toBe("Broken");
  });

  it("does not break a promise due exactly today — not yet broken", () => {
    const c = base({ paymentStatus: "Unpaid", promiseDate: TODAY });
    expect(classifyPromise(c, TODAY)).toBeNull();
  });

  it("does not touch a promise due in the future", () => {
    const c = base({ paymentStatus: "Unpaid", promiseDate: "2026-10-05" });
    expect(classifyPromise(c, TODAY)).toBeNull();
  });

  it("never classifies a promise on a soft-deleted invoice — unpaid and past", () => {
    // This is the actual production bug: the scheduled Inngest sweep had no
    // isNull(deletedAt) filter and would have broken this promise.
    const c = base({ paymentStatus: "Unpaid", promiseDate: "2026-09-01", invoiceDeletedAt: new Date("2026-09-15") });
    expect(classifyPromise(c, TODAY)).toBeNull();
  });

  it("never classifies a promise on a soft-deleted invoice — even if paid", () => {
    const c = base({ paymentStatus: "Paid", promiseDate: "2026-09-01", invoiceDeletedAt: "2026-09-15T00:00:00.000Z" });
    expect(classifyPromise(c, TODAY)).toBeNull();
  });

  it.each(["Superseded", "Met", "Broken"])(
    "leaves a non-Active promise alone (%s) so re-running the sweep is idempotent",
    (status) => {
      const c = base({ status, paymentStatus: "Unpaid", promiseDate: "2026-09-01" });
      expect(classifyPromise(c, TODAY)).toBeNull();
    },
  );

  it("deliberately still breaks a Written Off invoice's past-due promise — current, unchanged behaviour", () => {
    const c = base({ paymentStatus: "Written Off", promiseDate: "2026-09-01" });
    expect(classifyPromise(c, TODAY)).toBe("Broken");
  });

  it("deliberately still breaks a Partially Paid invoice's past-due promise — current, unchanged behaviour", () => {
    const c = base({ paymentStatus: "Partially Paid", promiseDate: "2026-09-01" });
    expect(classifyPromise(c, TODAY)).toBe("Broken");
  });
});

describe("wasPaidOnTime", () => {
  it("is true when paid on the promise date itself", () => {
    expect(wasPaidOnTime("2026-09-20", "2026-09-20")).toBe(true);
  });

  it("is false when paid the day after", () => {
    expect(wasPaidOnTime("2026-09-21", "2026-09-20")).toBe(false);
  });

  it("slices a midnight timestamp suffix before comparing", () => {
    expect(wasPaidOnTime("2026-09-20T00:00:00.000Z", "2026-09-20")).toBe(true);
    expect(wasPaidOnTime("2026-09-21T00:00:00.000Z", "2026-09-20")).toBe(false);
  });

  it("is null when paidAt is missing", () => {
    expect(wasPaidOnTime(null, "2026-09-20")).toBeNull();
  });

  it("is null when promiseDate is missing", () => {
    expect(wasPaidOnTime("2026-09-20", null)).toBeNull();
  });
});

describe("planPromiseSweep", () => {
  it("splits a mixed list into disjoint met/broken sets without mutating input", () => {
    const met1 = base({ id: "p-met", paymentStatus: "Paid", promiseDate: "2026-09-01" });
    const broken1 = base({ id: "p-broken", paymentStatus: "Unpaid", promiseDate: "2026-09-01" });
    const untouched = base({ id: "p-future", paymentStatus: "Unpaid", promiseDate: "2026-10-05" });
    const candidates = [met1, broken1, untouched];
    const snapshot = candidates.map(c => ({ ...c }));

    const { met, broken } = planPromiseSweep(candidates, TODAY);

    expect(met.map(c => c.id)).toEqual(["p-met"]);
    expect(broken.map(c => c.id)).toEqual(["p-broken"]);
    expect(candidates).toEqual(snapshot); // no mutation
  });

  it("returns empty sets for an empty list", () => {
    expect(planPromiseSweep([], TODAY)).toEqual({ met: [], broken: [] });
  });
});

describe("communication builders match the old sweeps verbatim", () => {
  it("kept, on time", () => {
    const p = base({ promiseDate: "2026-09-20", paidAt: "2026-09-20" });
    const comm = keptPromiseCommunication(p);
    expect(comm.body).toBe("Promised 2026-09-20 — paid 2026-09-20. Marked kept (on time).");
    expect(comm.subject).toBe("Promise kept");
    expect(comm.direction).toBe("Inbound");
    expect(comm.channel).toBe("Promise");
    expect(comm.sender).toBe("System");
    expect(comm.matchedBy).toBe("System");
    expect(comm.isDraft).toBe(false);
  });

  it("kept, late", () => {
    const p = base({ promiseDate: "2026-09-20", paidAt: "2026-09-25" });
    expect(keptPromiseCommunication(p).body).toBe("Promised 2026-09-20 — paid 2026-09-25. Marked kept (late).");
  });

  it("kept, with no paidAt recorded falls back to the bare 'Marked kept.' form", () => {
    const p = base({ promiseDate: "2026-09-20", paidAt: null });
    expect(keptPromiseCommunication(p).body).toBe("Promised 2026-09-20. Marked kept.");
  });

  it("broken", () => {
    const p = base({ promiseDate: "2026-09-01" });
    const comm = brokenPromiseCommunication(p);
    expect(comm.body).toBe("Promise was due 2026-09-01 — marked broken. Invoice still unpaid.");
    expect(comm.subject).toBe("Promise broken");
    expect(comm.direction).toBe("Inbound");
    expect(comm.channel).toBe("Promise");
  });

  it("carries orgId/customerId/invoiceId/projectId through unchanged", () => {
    const p = base({ orgId: "org-9", customerId: "cust-9", invoiceId: "inv-9", projectId: "proj-9" });
    const comm = brokenPromiseCommunication(p);
    expect(comm.orgId).toBe("org-9");
    expect(comm.customerId).toBe("cust-9");
    expect(comm.invoiceId).toBe("inv-9");
    expect(comm.projectId).toBe("proj-9");
  });
});
