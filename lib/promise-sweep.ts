/**
 * Pure rules for the daily promise sweeps (kept + broken).
 *
 * This file deliberately imports nothing from @/db and nothing from
 * lib/portal.ts. Two reasons, both load-bearing:
 *
 *   - lib/portal.ts's recomputeInvoiceState() picks the latest ACTIVE promise
 *     and derives stage from it — calling it after a sweep flips a promise to
 *     Broken would immediately look for a new "Active" promise, find none, and
 *     revert the invoice to a plain stage, erasing the "Broken commitment" pill
 *     (components/stage-label.tsx, components/board-list.tsx,
 *     app/(app)/smart-views/page.tsx, lib/export-report.ts all key off
 *     stage="Promised" + a past promiseDate). The sweep only ever writes
 *     invoice_promises.status and a communications row — it must never touch
 *     invoices.collectionStage.
 *   - lib/portal.ts imports next/headers and @/db, so it can't be unit-tested
 *     without a database. Keeping the actual classification rule here, with no
 *     I/O at all, is what makes it provable in a bug like this one — the old
 *     Inngest sweep silently diverged from the (correct, but unscheduled)
 *     app/api/cron/route.ts copy and nothing caught it.
 *
 * Until 2026-09-28 there were TWO independent copies of this rule (this bug's
 * root cause) — see lib/promise-sweep-server.ts and CLAUDE.md's "Promise
 * lifecycle" section for the history.
 */

export type PromiseVerdict = "Met" | "Broken" | null;

export interface PromiseSweepCandidate {
  id: string;
  orgId: string;
  invoiceId: string;
  customerId: string;
  projectId: string | null;
  /** invoice_promises.promise_date — YYYY-MM-DD varchar. Compared as a string, never built into a Date. */
  promiseDate: string;
  /** invoice_promises.status */
  status: string;
  /** invoices.payment_status */
  paymentStatus: string | null;
  /** invoices.paid_at — YYYY-MM-DD, may carry a midnight time suffix; slice(0, 10) before comparing. */
  paidAt: string | null;
  /** invoices.deleted_at */
  invoiceDeletedAt: Date | string | null;
}

export interface PromiseSweepCommunication {
  orgId: string;
  customerId: string;
  invoiceId: string;
  projectId: string | null;
  direction: "Inbound";
  channel: "Promise";
  subject: string;
  body: string;
  sender: "System";
  matchedBy: "System";
  isDraft: false;
}

/**
 * The single rule both sweeps run through, evaluated in order:
 *   1. A soft-deleted invoice is never touched — flipping a promise on a
 *      document QuickBooks/Xero has deleted blames a customer for something
 *      that no longer exists.
 *   2. Only an Active promise can change — Superseded/Met/Broken already
 *      settled the question, so re-running the sweep is idempotent.
 *   3. A paid invoice's promise is kept, regardless of the invoice's other
 *      status flags.
 *   4. Otherwise, a promise date strictly before today is broken.
 *
 * Deliberate, current behaviour kept unchanged from both pre-fix sweeps: a
 * promise on a "Written Off" or "Partially Paid" invoice past its date is
 * still marked Broken — neither status is "Paid", so step 3 doesn't apply and
 * step 4 does. This is pinned as a named test, not silently changed.
 */
export function classifyPromise(c: PromiseSweepCandidate, today: string): PromiseVerdict {
  if (c.invoiceDeletedAt) return null;
  if (c.status !== "Active") return null;
  if (c.paymentStatus === "Paid") return "Met";
  if (c.promiseDate < today) return "Broken";
  return null;
}

/** Splits a list of candidates into disjoint met/broken sets. Pure — never mutates the input. */
export function planPromiseSweep(
  candidates: readonly PromiseSweepCandidate[],
  today: string,
): { met: PromiseSweepCandidate[]; broken: PromiseSweepCandidate[] } {
  const met: PromiseSweepCandidate[] = [];
  const broken: PromiseSweepCandidate[] = [];
  for (const c of candidates) {
    const verdict = classifyPromise(c, today);
    if (verdict === "Met") met.push(c);
    else if (verdict === "Broken") broken.push(c);
  }
  return { met, broken };
}

/**
 * Settled ON TIME = paid on or before the promised date. paidAt is the
 * settling document's own date (never "today" — see CLAUDE.md), already a
 * YYYY-MM-DD varchar, so it's sliced rather than round-tripped through
 * Date(), which would re-introduce the timezone shift that column exists to
 * avoid. Null when either side is missing — "on time" is not a fact you can
 * assert about an invoice with no payment date yet.
 */
export function wasPaidOnTime(paidAt: string | null, promiseDate: string | null): boolean | null {
  if (!paidAt || !promiseDate) return null;
  return paidAt.slice(0, 10) <= promiseDate;
}

/** Verbatim body text of the old app/api/cron/route.ts kept-promise sweep. */
export function keptPromiseCommunication(p: PromiseSweepCandidate): PromiseSweepCommunication {
  const paidOn = p.paidAt ? p.paidAt.slice(0, 10) : null;
  const onTime = wasPaidOnTime(p.paidAt, p.promiseDate);
  return {
    orgId: p.orgId,
    customerId: p.customerId,
    invoiceId: p.invoiceId,
    projectId: p.projectId,
    direction: "Inbound",
    channel: "Promise",
    subject: "Promise kept",
    body: `Promised ${p.promiseDate}${paidOn ? ` — paid ${paidOn}` : ""}. Marked kept${paidOn && p.promiseDate ? (onTime ? " (on time)." : " (late).") : "."}`,
    sender: "System",
    matchedBy: "System",
    isDraft: false,
  };
}

/** Verbatim body text of the old broken-promise sweep (both the Inngest and cron/route.ts copies). */
export function brokenPromiseCommunication(p: PromiseSweepCandidate): PromiseSweepCommunication {
  return {
    orgId: p.orgId,
    customerId: p.customerId,
    invoiceId: p.invoiceId,
    projectId: p.projectId,
    direction: "Inbound",
    channel: "Promise",
    subject: "Promise broken",
    body: `Promise was due ${p.promiseDate} — marked broken. Invoice still unpaid.`,
    sender: "System",
    matchedBy: "System",
    isDraft: false,
  };
}
