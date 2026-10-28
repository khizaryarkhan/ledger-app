/**
 * Delivery performance — the pure rules behind PO/SO confirmation and OTIF
 * (on time, in full) reporting. No db import: client-safe and unit-tested
 * (tests/delivery-performance.test.ts), same split as sourcing.ts.
 *
 * Three facts per order line, kept apart on purpose:
 *   requestedDate  — when WE asked for it (PO) / the customer asked for it (SO)
 *   promisedDate   — when the counterparty committed to it (may move)
 *   originalPromisedDate — the FIRST promise; never moves
 * A line is measured against its promise when there is one, else its request.
 * Measuring against the CURRENT promise alone would let a supplier who re-dates
 * every order the day before it is due score 100% on time — so the report
 * shows both, and "on time vs original promise" is the honest figure.
 */

import { addDays } from "@/lib/accounting/report-periods";
import { QTY_EPSILON } from "@/lib/inventory/round";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const isIsoDate = (d: unknown): d is string => typeof d === "string" && ISO.test(d);

/**
 * Lead time to plan a purchase with. The item's own supplier link wins — it is
 * the more specific fact (SAP: info-record planned delivery time before the
 * vendor default). Null when neither is set: no date is invented.
 */
export function resolveLeadTimeDays(linkDays: number | null | undefined, supplierDays: number | null | undefined): number | null {
  const ok = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
  if (ok(linkDays)) return Math.round(linkDays as number);
  if (ok(supplierDays)) return Math.round(supplierDays as number);
  return null;
}

/** A typed-in supplier lead time (0114): blank = not set; otherwise 0–3650 whole days. */
export function leadTimeOf(v: unknown): number | null | "invalid" {
  if (v == null || String(v).trim() === "") return null;
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 && n <= 3650 ? n : "invalid";
}

/**
 * The requested date a new order line starts with. An explicit header date
 * ("Delivery date" on the form) is what the buyer actually asked for, so it
 * wins; otherwise a purchase line falls back to order date + lead time.
 */
export function defaultRequestedDate(issueDate: string, headerDate: string | null | undefined, leadTimeDays: number | null): string | null {
  if (isIsoDate(headerDate)) return headerDate;
  if (isIsoDate(issueDate) && leadTimeDays != null) return addDays(issueDate, leadTimeDays);
  return null;
}

/** The date a line is due against: current promise, else request. */
export function lineDueDate(l: { promisedDate?: string | null; requestedDate?: string | null }): string | null {
  if (isIsoDate(l.promisedDate)) return l.promisedDate;
  if (isIsoDate(l.requestedDate)) return l.requestedDate;
  return null;
}

export type PromiseUpdate = { promisedDate: string | null; originalPromisedDate: string | null; promiseRevisions: number };

/**
 * Apply a new promise to a line. The first promise is remembered forever;
 * every later CHANGE counts as a revision (re-saving the same date does not).
 * Clearing a promise keeps the original and the count — history is not undone.
 */
export function applyPromise(cur: { promisedDate?: string | null; originalPromisedDate?: string | null; promiseRevisions?: number | null }, next: string | null): PromiseUpdate {
  const revisions = cur.promiseRevisions ?? 0;
  const original = cur.originalPromisedDate ?? null;
  if (next != null && !isIsoDate(next)) throw new Error(`"${next}" is not a valid date (YYYY-MM-DD).`);
  if (next === (cur.promisedDate ?? null)) return { promisedDate: next, originalPromisedDate: original, promiseRevisions: revisions };
  if (next == null) return { promisedDate: null, originalPromisedDate: original, promiseRevisions: revisions };
  if (original == null) return { promisedDate: next, originalPromisedDate: next, promiseRevisions: revisions };
  return { promisedDate: next, originalPromisedDate: original, promiseRevisions: revisions + 1 };
}

export type ConfirmationStatus = "Unconfirmed" | "Sent" | "Confirmed";

/** Where an order stands with the counterparty. */
export function confirmationStatus(d: { sentAt?: Date | string | null; confirmedAt?: Date | string | null }): ConfirmationStatus {
  if (d.confirmedAt) return "Confirmed";
  if (d.sentAt) return "Sent";
  return "Unconfirmed";
}

/** Whole days from a to b (b − a), on calendar dates read literally. */
export function daysBetween(a: string, b: string): number {
  const t = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86_400_000);
}

export type LineDeliveryInput = {
  orderedQty: number;
  deliveredQty: number;          // received (PO) / shipped (SO), base UoM
  lastDeliveryDate: string | null; // the delivery that completed (or last touched) the line
  dueDate: string | null;
  originalDueDate: string | null; // original promise, else request
  closed: boolean;               // manually closed (short-shipped and accepted)
  asOf: string;                  // today, for "overdue but not delivered"
};

export type LineDeliveryResult = {
  state: "Open" | "Overdue" | "Delivered" | "Closed short";
  complete: boolean;             // nothing more expected
  inFull: boolean | null;        // null until complete
  onTime: boolean | null;        // null until complete or overdue
  onTimeVsOriginal: boolean | null;
  daysLate: number | null;       // >0 late, <=0 early/on time; vs current due date
};

/**
 * Classify one line. A line only scores once it is complete (fully delivered,
 * or closed short) — or once it is overdue, which is already a miss. On time
 * = the delivery that completed it arrived by the due date; in full = the
 * delivered quantity reached the ordered quantity (closed short is NOT in
 * full, whatever the reason: that is the point of measuring it).
 */
export function classifyLineDelivery(x: LineDeliveryInput): LineDeliveryResult {
  const fully = x.deliveredQty + QTY_EPSILON >= x.orderedQty;
  const complete = fully || x.closed;
  const by = (due: string | null) => (due == null ? null : x.lastDeliveryDate == null ? false : daysBetween(due, x.lastDeliveryDate) <= 0);
  if (complete) {
    const onTime = by(x.dueDate);
    return {
      state: fully ? "Delivered" : "Closed short", complete: true, inFull: fully,
      onTime, onTimeVsOriginal: x.originalDueDate == null ? onTime : by(x.originalDueDate),
      daysLate: x.dueDate && x.lastDeliveryDate ? daysBetween(x.dueDate, x.lastDeliveryDate) : null,
    };
  }
  if (x.dueDate && daysBetween(x.dueDate, x.asOf) > 0) {
    return { state: "Overdue", complete: false, inFull: null, onTime: false, onTimeVsOriginal: false, daysLate: daysBetween(x.dueDate, x.asOf) };
  }
  return { state: "Open", complete: false, inFull: null, onTime: null, onTimeVsOriginal: null, daysLate: null };
}

export type PartyScore = {
  lines: number; open: number; overdue: number;
  onTimePct: number | null; onTimeVsOriginalPct: number | null; inFullPct: number | null; otifPct: number | null;
  avgDaysLate: number | null;     // over late lines only
  avgLeadTimeDays: number | null; // order date → completing delivery, actual
  revisedLines: number;           // lines whose promise moved at least once
};

const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);
const avg = (a: number[]) => (a.length ? Math.round((a.reduce((s, n) => s + n, 0) / a.length) * 10) / 10 : null);

/** Roll classified lines up into one score per supplier / customer. */
export function scoreParty(rows: { r: LineDeliveryResult; leadTimeActual: number | null; revisions: number }[]): PartyScore {
  const timed = rows.filter(x => x.r.onTime !== null);
  const full = rows.filter(x => x.r.inFull !== null);
  const both = full.filter(x => x.r.onTime !== null);
  return {
    lines: rows.length,
    open: rows.filter(x => x.r.state === "Open").length,
    overdue: rows.filter(x => x.r.state === "Overdue").length,
    onTimePct: pct(timed.filter(x => x.r.onTime).length, timed.length),
    onTimeVsOriginalPct: pct(timed.filter(x => x.r.onTimeVsOriginal).length, timed.length),
    inFullPct: pct(full.filter(x => x.r.inFull).length, full.length),
    otifPct: pct(both.filter(x => x.r.onTime && x.r.inFull).length, both.length),
    avgDaysLate: avg(rows.map(x => x.r.daysLate).filter((n): n is number => n != null && n > 0)),
    avgLeadTimeDays: avg(rows.map(x => x.leadTimeActual).filter((n): n is number => n != null)),
    revisedLines: rows.filter(x => x.revisions > 0).length,
  };
}
