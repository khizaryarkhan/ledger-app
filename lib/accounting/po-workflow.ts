/**
 * Purchase-order workflow — pure rules (no db, client-safe).
 *
 * A PO's Stage column shows ONE state, the richest that is true:
 *   Rejected > Revision proposed > a manual stage the user picked > the
 *   fulfilment facts (Late / Partly received / Received) > Confirmed > Sent >
 *   Created.
 *
 * Fulfilment is derived from receipts, never typed — it is a fact, so it cannot
 * be configured or drift. Everything else is a commitment someone made, and is
 * stored. Keys are immutable; labels may be renamed (same rule as lib/stages.ts).
 */
import { QTY_EPSILON } from "@/lib/inventory/round";

export interface PoStageDef { key: string; label: string; color: string; locked: boolean }

/** Stages the workflow itself sets. Locked: logic depends on their keys. */
export const SYSTEM_PO_STAGES: PoStageDef[] = [
  { key: "Created",          label: "Created",           color: "stone",   locked: true },
  { key: "Sent",             label: "Sent",              color: "blue",    locked: true },
  { key: "RevisionProposed", label: "Revision proposed", color: "amber",   locked: true },
  { key: "Confirmed",        label: "Confirmed",         color: "emerald", locked: true },
  { key: "Rejected",         label: "Rejected",          color: "rose",    locked: true },
  { key: "OnHold",           label: "On hold",           color: "orange",  locked: false },
  { key: "Cancelled",        label: "Cancelled",         color: "stone",   locked: false },
];

/** Derived from receipts — shown, never configured. */
export const FULFILMENT_STAGES: PoStageDef[] = [
  { key: "Late",            label: "Late",             color: "rose",    locked: true },
  { key: "PartlyReceived",  label: "Partly received",  color: "teal",    locked: true },
  { key: "Received",        label: "Received",         color: "emerald", locked: true },
];

/** Colour is for exceptions only — the rule the Collections Board follows. */
const EXCEPTION_KEYS = new Set(["RevisionProposed", "Rejected", "Late", "OnHold"]);
export const isPoExceptionStage = (key: string) => EXCEPTION_KEYS.has(key);

/** Keys a user may not pick by hand: each has its own action. */
const ACTION_ONLY_KEYS = new Set(["Created", "Sent", "RevisionProposed", "Confirmed", "Rejected"]);
export const isManuallySettable = (key: string) => !ACTION_ONLY_KEYS.has(key);

export interface PoLineFacts {
  orderedBaseQty: number;
  receivedQty: number;
  closed: boolean;
  requestedDate?: string | null;
  promisedDate?: string | null;
}

export type LineState = "NotReceived" | "PartlyReceived" | "Received" | "ClosedShort" | "Late";

/** Base-unit quantity still expected. A closed line expects nothing. */
export function lineBalance(l: Pick<PoLineFacts, "orderedBaseQty" | "receivedQty" | "closed">): number {
  if (l.closed) return 0;
  const b = l.orderedBaseQty - l.receivedQty;
  return b > QTY_EPSILON ? b : 0;
}

export function lineState(l: PoLineFacts, today: string): LineState {
  // A line whose quantity was reduced to nothing expects nothing and received nothing.
  if (l.orderedBaseQty <= QTY_EPSILON) return "ClosedShort";
  const complete = l.receivedQty >= l.orderedBaseQty - QTY_EPSILON;
  if (complete) return "Received";
  if (l.closed) return "ClosedShort";
  const due = l.promisedDate || l.requestedDate || null;
  if (due && due < today) return "Late";
  return l.receivedQty > QTY_EPSILON ? "PartlyReceived" : "NotReceived";
}

export interface PoStageFacts {
  manualStage?: string | null;
  sentAt?: unknown;
  confirmedAt?: unknown;
  rejectedAt?: unknown;
  hasPendingResponse?: boolean;
  lines: PoLineFacts[];
}

/** The single stage key a PO row shows. */
export function derivePoStage(f: PoStageFacts, today: string): string {
  if (f.rejectedAt) return "Rejected";
  if (f.hasPendingResponse) return "RevisionProposed";
  if (f.manualStage) return f.manualStage;
  const states = f.lines.map(l => lineState(l, today));
  if (states.length && states.every(s => s === "Received" || s === "ClosedShort")) {
    // "Received" only if something actually arrived; every line closed with nothing in is a cancellation.
    return f.lines.some(l => l.receivedQty > QTY_EPSILON) ? "Received" : "Cancelled";
  }
  if (states.includes("Late")) return "Late";
  if (states.some(s => s === "PartlyReceived" || s === "Received")) return "PartlyReceived";
  if (f.confirmedAt) return "Confirmed";
  if (f.sentAt) return "Sent";
  return "Created";
}

/** Fixed reason codes for "Stop expecting this item" — never free text alone. */
export const CLOSE_REASONS: { code: string; label: string }[] = [
  { code: "supplier_cannot_deliver", label: "Supplier cannot deliver the rest" },
  { code: "ordered_in_error",        label: "Ordered in error" },
  { code: "replaced",                label: "Replaced by another item" },
  { code: "customer_cancelled",      label: "Customer cancelled" },
  { code: "price_dispute",           label: "Price dispute" },
  { code: "other",                   label: "Other" },
];
export const closeReasonLabel = (code: string | null | undefined) =>
  CLOSE_REASONS.find(r => r.code === code)?.label ?? code ?? "";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * A line after its quantity (in the ORDER unit) changes: net amount at the same
 * rate, tax scaled in proportion, and the base-unit quantity receiving works in.
 */
export function repriceLine(
  line: { rate: number; amount: number; taxAmount: number; unitsPerOrderUnit: number },
  qty: number,
): { amount: number; taxAmount: number; orderedBase: number } {
  const amount = round2(qty * line.rate);
  const taxAmount = line.amount > 0 ? round2(line.taxAmount * (amount / line.amount)) : 0;
  const orderedBase = Math.round(qty * (line.unitsPerOrderUnit || 1) * 1e6) / 1e6;
  return { amount, taxAmount, orderedBase };
}

export interface SubmittedLine { lineId: string; qty?: number | null; date?: string | null }
export interface OrderedLine { id: string; qty: number; promisedDate: string | null; requestedDate: string | null; closed: boolean }
export interface CleanRevision { lineId: string; proposedQty: number; proposedDate: string | null }

/** A real calendar day, not just the right shape ("2026-99-99" is refused). */
const isIsoDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};
/** The numeric(16,6) column cannot hold more; refuse before anything is written. */
const MAX_QTY = 1e9;

/**
 * What the supplier actually changed. A submission names every line (the portal
 * posts them all); only lines whose quantity or date differ from the order are
 * revisions. Throws a plain message on anything the order cannot honour: an
 * unknown line, a negative quantity, a malformed date. A quantity of zero is
 * allowed — "we cannot supply this line".
 */
export function diffSubmission(lines: OrderedLine[], submitted: SubmittedLine[]): CleanRevision[] {
  const byId = new Map(lines.map(l => [l.id, l]));
  const out: CleanRevision[] = [];
  const seen = new Set<string>();
  for (const s of submitted) {
    const l = byId.get(s.lineId);
    if (!l) throw new Error("A line does not belong to this order.");
    if (seen.has(s.lineId)) throw new Error("A line was submitted twice.");
    seen.add(s.lineId);
    if (l.closed) continue;
    if (s.qty != null && (!Number.isFinite(s.qty) || s.qty < 0)) throw new Error("Quantities cannot be negative.");
    if (s.qty != null && s.qty > MAX_QTY) throw new Error("That quantity is too large.");
    if (s.date != null && s.date !== "" && !isIsoDate(s.date)) throw new Error("Dates must be valid.");
    const qty = s.qty == null ? l.qty : s.qty;
    const current = l.promisedDate || l.requestedDate || null;
    const date = s.date ? s.date : current;
    const qtyChanged = Math.abs(qty - l.qty) > QTY_EPSILON;
    const dateChanged = (date ?? null) !== (current ?? null);
    if (qtyChanged || dateChanged) out.push({ lineId: l.id, proposedQty: qty, proposedDate: date });
  }
  return out;
}
