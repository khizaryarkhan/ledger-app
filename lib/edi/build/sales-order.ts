/**
 * A confirmed Sales Order → the 855 purchase-order acknowledgement we send the
 * customer. Pure. The acknowledgement says what WE will deliver, line by line,
 * set against what THEY ordered (their stored 850, when there is one): the
 * same quantity at the same price is accepted (IA); a different quantity is
 * IQ, a different price IP, a promised date other than the one they asked for
 * DR, a closed line IR. Their line numbers are echoed back, never ours.
 *
 * Never guesses: an SO with no customer PO number, not yet confirmed, whose
 * lines no longer match the 850 it was made from, or with a unit we have no
 * EDI code for, is not sent, and the reason is named.
 */

import { x12UnitFor } from "@/lib/edi/validate";

export type SoAckFacts = {
  so: { docNumber: string | null; partyRef: string | null; issueDate: string; currency: string | null; confirmed: boolean; promisedDate: string | null };
  lines: { lineNo: number; orderUom: string | null; baseUom: string | null; qty: number; rate: number; promisedDate: string | null; requestedDate: string | null; closed: boolean }[];
  /** What they ordered, from the 850 this order was created from (positions line up with `lines`), or null for an order keyed by hand. */
  theirs: { lineNo: string; qty: number | null; unit: string | null; price: number | null; requestedDate: string | null }[] | null;
};

export type AckLineStatus = { status: string; qty: number | null; unit: string | null; date: string | null };
export type OrderAckLine = { lineNo: string; qty: number; unit: string; price: number; acks: AckLineStatus[] };
export type OrderAckOut = { poNumber: string; poDate: string; currency: string | null; type: "AC" | "AD"; lines: OrderAckLine[] };
export type AckProblem = { lineNo: number | null; message: string };

const same = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));

export function buildOrderAck(f: SoAckFacts, overrides: Record<string, string>): { ok: true; ack: OrderAckOut } | { ok: false; problems: AckProblem[] } {
  const problems: AckProblem[] = [];
  if (!f.so.partyRef?.trim()) problems.push({ lineNo: null, message: "This order has no customer PO number. Their acknowledgement must quote it: set it on the order (Confirm → their reference)." });
  if (!f.so.confirmed) problems.push({ lineNo: null, message: "Confirm the order first, so the acknowledgement states what you promise." });
  if (!f.lines.length) problems.push({ lineNo: null, message: "The order has no lines." });
  const mismatch = !!f.theirs && f.theirs.length !== f.lines.length;
  if (mismatch) {
    problems.push({ lineNo: null, message: `The order has ${f.lines.length} line(s), their order had ${f.theirs!.length}. The lines no longer match the order they sent, so their line numbers cannot be echoed. Acknowledge it by hand.` });
  }
  const lines: OrderAckLine[] = [];
  if (!mismatch) f.lines.forEach((l, i) => {
    const their = f.theirs?.[i] ?? null;
    const u = x12UnitFor(l.orderUom || l.baseUom, overrides);
    if (u.ok === false) { problems.push({ lineNo: l.lineNo, message: `Unit: ${u.reason}` }); return; }
    if (their?.unit && their.unit.toUpperCase() !== u.code) {
      problems.push({ lineNo: l.lineNo, message: `They ordered in ${their.unit}, the line is in ${u.code} now. Acknowledge it by hand.` });
      return;
    }
    const orderedQty = their?.qty ?? l.qty;
    const orderedPrice = their?.price ?? l.rate;
    const date = l.promisedDate ?? f.so.promisedDate ?? null;
    const asked = their?.requestedDate ?? l.requestedDate ?? null;
    const acks: AckLineStatus[] = [];
    if (l.closed) acks.push({ status: "IR", qty: 0, unit: u.code, date: null });
    else {
      const qtyChanged = !same(l.qty, orderedQty);
      const priceChanged = !same(l.rate, orderedPrice);
      const dateMoved = !!date && !!asked && date !== asked;
      if (qtyChanged) acks.push({ status: "IQ", qty: l.qty, unit: u.code, date });
      if (priceChanged) acks.push({ status: "IP", qty: l.qty, unit: u.code, date: qtyChanged ? null : date });
      if (!qtyChanged && !priceChanged) acks.push({ status: dateMoved ? "DR" : "IA", qty: l.qty, unit: u.code, date });
      else if (dateMoved && !acks.some(a => a.date)) acks.push({ status: "DR", qty: l.qty, unit: u.code, date });
    }
    lines.push({ lineNo: their?.lineNo ?? String(l.lineNo), qty: orderedQty, unit: their?.unit || u.code, price: orderedPrice, acks });
  });
  if (problems.length) return { ok: false, problems };
  const plain = lines.every(l => l.acks.length === 1 && l.acks[0].status === "IA");
  return { ok: true, ack: { poNumber: f.so.partyRef!.trim(), poDate: f.so.issueDate, currency: f.so.currency, type: plain ? "AD" : "AC", lines } };
}
