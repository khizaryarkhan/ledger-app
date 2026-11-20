/**
 * Inbound EDI, the pure rules: what an acknowledgement MEANS for our records.
 *
 * An 855 becomes exactly what a supplier could say in the portal — confirm,
 * decline, or proposed quantities/dates per line — so it lands in the same
 * path (recordSupplierResponse): a revision is stored for a person to decide,
 * never applied by itself. Nothing is guessed: a line we cannot match, a
 * quantity in a different unit, or a status code we do not know is a reason
 * for a person to look, given in words.
 */

import type { EdiOrderAck, EdiShipNotice, EdiShipOrder, EdiInvoice } from "@/lib/edi/model";
import type { DeliveryInput } from "@/lib/inventory/expected-delivery";
import { roundQty } from "@/lib/inventory/round";
import type { SubmittedLine } from "@/lib/accounting/po-workflow";

/** BAK02: the whole order rejected, or accepted with nothing to change. */
const REJECT_TYPES = new Set(["RJ", "RD"]);
const ACCEPT_TYPES = new Set(["AK", "AT", "AD", "AC", "AE", "AP"]);
/** ACK04 date qualifiers that name the date the goods will now come. */
const DATE_QUALIFIERS = new Set(["067", "068", "069", "017", "002", "010", "011"]);

export type AckPoLine = { id: string; lineNo: number; qty: number; unitCode: string | null; closed: boolean };
export type AckOutcome =
  | { ok: true; kind: "confirm" | "revise" | "decline"; lines: SubmittedLine[]; notes: string[]; needsReview: boolean }
  | { ok: false; problems: string[] };

export function ackToResponse(ack: EdiOrderAck, poLines: AckPoLine[]): AckOutcome {
  const type = ack.ackType.toUpperCase();
  if (REJECT_TYPES.has(type)) return { ok: true, kind: "decline", lines: [], notes: [`The supplier rejected the order (${type}).`], needsReview: false };
  if (!ACCEPT_TYPES.has(type)) return { ok: false, problems: [`Unknown acknowledgement type "${ack.ackType}" (BAK02).`] };

  const byNo = new Map(poLines.map(l => [l.lineNo, l]));
  const problems: string[] = [];
  const notes: string[] = [];
  const lines: SubmittedLine[] = [];
  let needsReview = false;

  for (const a of ack.lines) {
    const n = Number(a.lineNo);
    const pl = Number.isInteger(n) ? byNo.get(n) : undefined;
    if (!pl) { problems.push(`Line "${a.lineNo}" is not a line of this order.`); continue; }
    if (pl.closed) { notes.push(`Line ${n} is closed on our side; its acknowledgement was not applied.`); continue; }
    let qty: number | null = null;
    let date: string | null = null;
    let qtySum = 0, qtyParts = 0;
    for (const k of a.acks) {
      const st = k.status.toUpperCase();
      const unitOk = !k.unit || !pl.unitCode || k.unit.toUpperCase() === pl.unitCode;
      if (k.rawDate && !k.date) { problems.push(`Line ${n}: "${k.rawDate}" is not a date (CCYYMMDD).`); continue; }
      const dateOk = !k.date || !k.dateQualifier || DATE_QUALIFIERS.has(k.dateQualifier);
      if (!dateOk) { notes.push(`Line ${n}: a date with qualifier ${k.dateQualifier} was not read as a delivery date.`); needsReview = true; }
      if (st === "IA") {
        if (k.date && dateOk) date = latest(date, k.date);
      } else if (st === "IR") {
        qtySum = 0; qtyParts = -1; // rejected: cannot supply this line
      } else if (st === "IQ" || st === "IC" || st === "IB" || st === "DR" || st === "IS") {
        if (k.qty != null && (st === "IQ" || st === "IC" || st === "IB")) {
          if (!unitOk) { problems.push(`Line ${n}: quantity is in ${k.unit}, the order is in ${pl.unitCode}. Ask the supplier to answer in the ordered unit.`); continue; }
          if (qtyParts >= 0) { qtySum += k.qty; qtyParts++; }
        }
        if (k.date && dateOk) date = latest(date, k.date);
      } else if (st === "IP") {
        notes.push(`Line ${n}: the supplier proposed a price change; prices change only by the buyer, so it was not applied.`);
        needsReview = true;
      } else {
        notes.push(`Line ${n}: status "${k.status}" is not one we act on.`);
        needsReview = true;
      }
    }
    if (qtyParts === -1) qty = 0;
    else if (qtyParts > 0) {
      qty = qtySum;
      if (qtyParts > 1) { notes.push(`Line ${n}: the supplier split it into ${qtyParts} parts; the total and latest date are proposed.`); needsReview = true; }
    }
    if (qty != null || date != null) lines.push({ lineId: pl.id, qty, date });
  }
  if (problems.length) return { ok: false, problems };
  return { ok: true, kind: lines.length ? "revise" : "confirm", lines, notes, needsReview };
}

const latest = (a: string | null, b: string) => (!a || b > a ? b : a);

/** A PO line as an 856 is matched against it. Unit codes are X12 codes (null when ours has none). */
export type AsnPoLine = {
  id: string; lineNo: number; itemCode: string | null; closed: boolean;
  orderUnitCode: string | null; baseUnitCode: string | null; unitsPerOrderUnit: number;
};
export type AsnOutcome = { ok: true; input: DeliveryInput; notes: string[] } | { ok: false; problems: string[] };

/** BSN01: what the notice asks us to do with the delivery it names. */
export function asnPurpose(code: string): "create" | "replace" | "cancel" | null {
  return code === "00" || code === "06" ? "create" : code === "05" ? "replace" : code === "01" || code === "03" ? "cancel" : null;
}

/** The reference a delivery is recorded under: the shipment ID, plus the PO when one notice covers several orders. */
export function asnReference(notice: EdiShipNotice, poNumber: string) {
  return (notice.orders.length > 1 ? `${notice.shipmentId}/${poNumber}` : notice.shipmentId).slice(0, 64);
}

/**
 * One order of an 856 → an expected delivery for that PO (source "asn"). It
 * is a claim, never stock: Receiving fills in from it and a person counts.
 * Never guesses: the line must be a line of this PO (LIN01), our item code
 * must agree when they send it (BP), and the quantity must be in the line's
 * order unit (converted to base) or in the base unit. Anything else is a
 * reason for a person to look, and nothing is recorded for that order.
 */
export function asnOrderToDelivery(notice: EdiShipNotice, order: EdiShipOrder, poLines: AsnPoLine[]): AsnOutcome {
  const problems: string[] = [];
  const notes: string[] = [];
  if (!notice.shipmentId.trim()) problems.push("The ship notice has no shipment ID (BSN02).");
  if (!order.items.length) problems.push(`Nothing is listed for ${order.poNumber}.`);
  const byNo = new Map(poLines.map(l => [l.lineNo, l]));
  const lines = order.items.map(it => {
    const at = `Line "${it.lineNo}"`;
    const pl = /^\d+$/.test(it.lineNo) ? byNo.get(Number(it.lineNo)) : undefined;
    if (!pl) { problems.push(`${at} is not a line of ${order.poNumber}.`); return null; }
    const bp = it.ids.BP;
    if (bp && pl.itemCode && bp.trim().toUpperCase() !== pl.itemCode.trim().toUpperCase()) problems.push(`${at}: they name our item ${bp}, the order line is ${pl.itemCode}.`);
    for (const b of it.badDates) problems.push(`${at}: ${b}.`);
    if (it.qty == null || !Number.isFinite(it.qty) || it.qty <= 0) { problems.push(`${at}: no quantity shipped (SN1).`); return null; }
    let qtyBase: number | null = null;
    const unit = (it.unit ?? "").toUpperCase();
    if (unit && unit === pl.orderUnitCode) qtyBase = roundQty(it.qty * pl.unitsPerOrderUnit);
    else if (unit && unit === pl.baseUnitCode) qtyBase = roundQty(it.qty);
    if (qtyBase == null) {
      problems.push(`${at}: the quantity is in ${unit || "no unit"}, the order line is in ${pl.orderUnitCode ?? "a unit with no X12 code"}${pl.baseUnitCode && pl.baseUnitCode !== pl.orderUnitCode ? ` (base ${pl.baseUnitCode})` : ""}.`);
      return null;
    }
    if (pl.closed) notes.push(`${at} is closed on the order; it is recorded as announced, Receiving will not offer it.`);
    return { poLineId: pl.id, qtyBase, sscc: it.sscc, supplierBatchNo: it.batch, productionDate: it.productionDate,
      bestBeforeDate: it.bestBeforeDate, expiryDate: it.expiryDate };
  });
  if (problems.length) return { ok: false, problems };
  return { ok: true, notes, input: {
    source: "asn", reference: asnReference(notice, order.poNumber), shipDate: notice.shipDate, expectedDate: notice.expectedDate,
    carrier: notice.carrier, trackingNo: notice.trackingNo,
    packages: order.packages.map(p => ({ sscc: p.sscc, packType: p.level === "tare" ? "pallet" : null, parentSscc: p.parentSscc })),
    lines: lines as NonNullable<(typeof lines)[number]>[],
  } };
}

/** A receipt as an 810 is matched against it: its lines not yet billed, prices in the receipt currency per base unit. */
export type InvoiceReceipt = {
  id: string; receiptNo: string | null; receiptDate: string; currency: string;
  lines: { id: string; poLineId: string | null; unbilledQty: number; price: number }[];
};
export type InvoiceMatchLine = {
  lineNo: string; poLineId: string | null; invoicedQty: number | null; invoicePrice: number | null;
  unbilledQty: number; receiptPrice: number | null;
};
/** What a person is asked to approve: bill these receipts, at these invoice prices. Nothing is posted from the file. */
export type BillProposal = {
  invoiceNo: string; invoiceDate: string; dueDate: string | null; currency: string;
  receiptIds: string[]; receiptNos: string[]; prices: { lineId: string; unitCost: number }[];
  goods: number; total: number | null; tax: number | null; charges: number;
};
export type InvoiceOutcome =
  | { ok: true; proposal: BillProposal; lines: InvoiceMatchLine[]; notes: string[] }
  | { ok: false; problems: string[]; lines: InvoiceMatchLine[] };

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
const money = (n: number) => Math.round(n * 100) / 100;

/**
 * An 810 against our records. A bill from receipts bills each receipt WHOLE
 * (every line not yet billed), so the invoice is matched to the oldest run of
 * the PO's receipts whose unbilled quantities equal what is invoiced, line for
 * line, with nothing else unbilled on them. Never guesses: a line we cannot
 * place, a quantity in another unit, or quantities that match no run of
 * receipts is a reason for a person to bill it by hand in Receiving.
 */
export function invoiceToBill(inv: EdiInvoice, poLines: AsnPoLine[], receipts: InvoiceReceipt[], billCurrency: string): InvoiceOutcome {
  const problems = [...inv.problems];
  const notes: string[] = [];
  if (!inv.invoiceNo.trim()) problems.push("The invoice has no number (BIG02).");
  if (!inv.invoiceDate) problems.push("The invoice has no date (BIG01).");
  if (!inv.lines.length) problems.push("The invoice lists no lines (IT1).");
  if (inv.currency && inv.currency.toUpperCase() !== billCurrency.toUpperCase()) problems.push(`The invoice is in ${inv.currency}, the goods were received in ${billCurrency}.`);

  const byNo = new Map(poLines.map(l => [l.lineNo, l]));
  const wanted = new Map<string, { qty: number; price: number }>();
  const view: InvoiceMatchLine[] = [];
  for (const il of inv.lines) {
    const at = `Line "${il.lineNo}"`;
    const pl = /^\d+$/.test(il.lineNo) ? byNo.get(Number(il.lineNo)) : undefined;
    const row: InvoiceMatchLine = { lineNo: il.lineNo, poLineId: pl?.id ?? null, invoicedQty: null, invoicePrice: null, unbilledQty: 0, receiptPrice: null };
    view.push(row);
    if (!pl) { problems.push(`${at} is not a line of ${inv.poNumber}.`); continue; }
    const bp = il.ids.BP;
    if (bp && pl.itemCode && bp.trim().toUpperCase() !== pl.itemCode.trim().toUpperCase()) problems.push(`${at}: they name our item ${bp}, the order line is ${pl.itemCode}.`);
    if (il.qty == null || !Number.isFinite(il.qty) || il.qty <= 0) { problems.push(`${at}: no quantity invoiced.`); continue; }
    if (il.price == null || !Number.isFinite(il.price) || il.price < 0) { problems.push(`${at}: no unit price.`); continue; }
    const unit = (il.unit ?? "").toUpperCase();
    const per = unit && unit === pl.orderUnitCode ? pl.unitsPerOrderUnit : unit && unit === pl.baseUnitCode ? 1 : null;
    if (per == null) { problems.push(`${at}: invoiced in ${unit || "no unit"}, the order line is in ${pl.orderUnitCode ?? "a unit with no X12 code"}.`); continue; }
    if (wanted.has(pl.id)) { problems.push(`${at} is invoiced twice.`); continue; }
    const q = { qty: il.qty * per, price: il.price / per };
    wanted.set(pl.id, q);
    row.invoicedQty = q.qty; row.invoicePrice = Math.round(q.price * 1e6) / 1e6;
  }

  const ours = new Set(poLines.map(l => l.id));
  const candidates = [...receipts]
    .filter(r => r.lines.some(l => l.poLineId && ours.has(l.poLineId) && l.unbilledQty > 1e-6))
    .sort((a, b) => a.receiptDate.localeCompare(b.receiptDate) || String(a.receiptNo).localeCompare(String(b.receiptNo)));
  let chosen: InvoiceReceipt[] | null = null;
  for (let k = 1; k <= candidates.length && !problems.length; k++) {
    const run = candidates.slice(0, k);
    const sums = new Map<string, number>();
    let stray = false;
    for (const r of run) for (const l of r.lines) {
      if (l.unbilledQty <= 1e-6) continue;
      if (!l.poLineId || !wanted.has(l.poLineId)) { stray = true; continue; }
      sums.set(l.poLineId, (sums.get(l.poLineId) ?? 0) + l.unbilledQty);
    }
    if (!stray && [...wanted].every(([id, w]) => near(sums.get(id) ?? 0, w.qty))) { chosen = run; break; }
  }
  // What is waiting to be billed per PO line, across all receipts, for the person reading it.
  for (const row of view) {
    if (!row.poLineId) continue;
    const ls = candidates.flatMap(r => r.lines).filter(l => l.poLineId === row.poLineId && l.unbilledQty > 1e-6);
    row.unbilledQty = Math.round(ls.reduce((a, l) => a + l.unbilledQty, 0) * 1e6) / 1e6;
    row.receiptPrice = ls[0]?.price ?? null;
  }
  if (!problems.length && !chosen) {
    problems.push(candidates.length
      ? "The invoiced quantities do not match what has been received and not yet billed. Bill it by hand from Receiving."
      : `Nothing received against ${inv.poNumber} is waiting to be billed. Receive the goods first.`);
  }
  if (problems.length) return { ok: false, problems, lines: view };

  const prices: { lineId: string; unitCost: number }[] = [];
  let goods = 0;
  for (const r of chosen!) for (const l of r.lines) {
    if (l.unbilledQty <= 1e-6 || !l.poLineId) continue;
    const w = wanted.get(l.poLineId)!;
    goods += l.unbilledQty * w.price;
    if (!near(w.price, l.price)) prices.push({ lineId: l.id, unitCost: Math.round(w.price * 1e6) / 1e6 });
  }
  goods = money(goods);
  const charges = money(inv.charges.reduce((a, c) => a + c.amount, 0));
  if (prices.length) notes.push(`The invoice price differs from the receipt on ${prices.length} line(s): the difference goes to purchase price variance, and the share on stock still held into its cost.`);
  if (inv.tax) notes.push(`The invoice carries tax of ${money(inv.tax)}: choose the tax rate when you create the bill.`);
  if (charges) notes.push(`The invoice carries charges or allowances of ${charges} (${inv.charges.map(c => c.code).join(", ")}): they are not on this bill. Post them separately.`);
  if (inv.total != null && !near(money(goods + (inv.tax ?? 0) + charges), inv.total)) notes.push(`The invoice total is ${inv.total}; goods ${goods} plus tax and charges come to ${money(goods + (inv.tax ?? 0) + charges)}.`);
  const dueDate = inv.dueDate ?? (inv.netDays != null && inv.invoiceDate ? addDaysYmd(inv.invoiceDate, inv.netDays) : null);
  return { ok: true, lines: view, notes, proposal: {
    invoiceNo: inv.invoiceNo.trim(), invoiceDate: inv.invoiceDate!, dueDate, currency: billCurrency,
    receiptIds: chosen!.map(r => r.id), receiptNos: chosen!.map(r => r.receiptNo ?? r.id), prices,
    goods, total: inv.total, tax: inv.tax, charges,
  } };
}

/** YYYY-MM-DD plus n days, in UTC throughout (a date is a date). */
function addDaysYmd(ymd: string, n: number) {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
