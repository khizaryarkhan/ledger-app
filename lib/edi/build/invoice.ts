/**
 * A customer invoice made from shipments → the 810 invoice we send them. Pure.
 * Each invoice line is traced to the shipment line it came from (the line-level
 * `shipment_invoice` links) and so to the Sales Order line: THEIR line number,
 * THEIR part number, the quantity in the unit the order was placed in, and the
 * price per that unit. The invoice's net, tax and total come from the invoice
 * itself, so what we send equals what we booked.
 *
 * Never guesses: an invoice with no line-level links (made before they were
 * kept, or not from shipments), lines whose amounts no longer add up to the
 * invoice (it was edited afterwards), an order with no customer PO number,
 * lines that no longer match the 850, or a unit with no EDI code is not sent,
 * and the reason is named. Several orders on one invoice carry their PO number
 * on each line (IT1 qualifier PO); one order carries it in BIG04.
 */

import { x12UnitFor } from "@/lib/edi/validate";

export type InvFacts = {
  invoice: { docNumber: string | null; date: string; dueDate: string | null; currency: string | null; net: number; tax: number; total: number; posted: boolean };
  customer: { name: string; gln: string | null };
  us: { name: string; gln: string | null };
  /** The shipment lines this invoice billed (from the line-level links): base qty and net amount of each. */
  lines: { shipLineId: string; soId: string | null; soLineId: string | null; qtyBase: number; amount: number; ratePerBase: number }[];
  orders: {
    soId: string; poNumber: string | null; poDate: string;
    soLines: { id: string; lineNo: number; orderUom: string | null; baseUom: string | null; unitsPerOrderUnit: number; itemCode: string | null }[];
    theirs: { lineNo: string; unit: string | null }[] | null;
  }[];
  parts: Record<string, { bp: string | null; gtin: string | null }>;
  /**
   * Lines on the invoice that are not goods: freight, fees, discounts (items of the "Other Charge" kind). Positive is a
   * charge, negative an allowance. They count toward the net beside the shipment lines.
   */
  extras?: { description: string; amount: number }[];
};

export type InvoiceItem = { lineNo: string; partNumber: string | null; gtin: string | null; itemCode: string | null; qty: number; unit: string; price: number; poNumber: string };
export type InvoiceOut = {
  invoiceNo: string; date: string; dueDate: string | null; currency: string | null;
  /** The single order's PO number and date when the invoice covers one order, else null (each line then carries its own). */
  poNumber: string | null; poDate: string | null;
  customer: { name: string; gln: string | null }; us: { name: string; gln: string | null };
  items: InvoiceItem[]; net: number; tax: number; total: number;
  /** "invoice" (BIG07 DI) or "credit" (BIG07 CR, a credit memo). */
  kind: "invoice" | "credit";
  /** TXI01 tax type, the partner's rule (ZZ = amount only). */
  taxType: string;
  /** Charges (C) and allowances (A) as positive amounts, sent as SAC segments. */
  charges: { kind: "C" | "A"; description: string; amount: number }[];
};
export type InvProblem = { lineNo: number | null; message: string };

const q6 = (n: number) => Math.round(n * 1e6) / 1e6;
const c2 = (n: number) => Math.round(n * 100) / 100;

export function buildInvoice(f: InvFacts, overrides: Record<string, string>, taxType = "ZZ"): { ok: true; invoice: InvoiceOut } | { ok: false; problems: InvProblem[] } {
  const problems: InvProblem[] = [];
  const bad = (message: string) => problems.push({ lineNo: null, message });
  if (!f.invoice.posted) bad("This invoice is not posted.");
  if (!f.invoice.docNumber?.trim()) bad("The invoice has no number.");
  if (!f.lines.length) {
    bad("This invoice has no line-level link to its shipments (it was made before they were kept, or not from shipments). Send it by hand.");
    return { ok: false, problems };
  }
  const goods = c2(f.lines.reduce((s, l) => s + l.amount, 0));
  const extras = f.extras ?? [];
  const extrasTotal = c2(extras.reduce((s, x) => s + x.amount, 0));
  if (Math.abs(goods + extrasTotal - f.invoice.net) > 0.01) bad(`The shipment lines${extras.length ? " and charges" : ""} add up to ${c2(goods + extrasTotal)}, the invoice net is ${f.invoice.net}: the invoice was edited after it was made. Send it by hand.`);
  if (extras.some(x => Math.abs(x.amount) < 0.005)) bad("A charge or discount line on the invoice has no amount.");
  if (f.invoice.tax < -0.005) bad("The invoice tax is negative.");
  if (Math.abs(f.invoice.net + f.invoice.tax - f.invoice.total) > 0.01) bad(`Net ${f.invoice.net} plus tax ${f.invoice.tax} is not the total ${f.invoice.total}.`);

  const info = new Map<string, { order: number; theirNo: string; unit: string; upo: number; itemCode: string | null }>();
  f.orders.forEach((o, oi) => {
    const tag = o.poNumber ?? "(no PO number)";
    if (!o.poNumber?.trim()) bad("A Sales Order on this invoice has no customer PO number. The invoice must quote it: set it on the order.");
    const sorted = [...o.soLines].sort((a, b) => a.lineNo - b.lineNo);
    if (o.theirs && o.theirs.length !== sorted.length) { bad(`Order ${tag} has ${sorted.length} line(s), their order had ${o.theirs.length}. The lines no longer match the order they sent, so their line numbers cannot be echoed. Send it by hand.`); return; }
    sorted.forEach((l, i) => {
      const u = x12UnitFor(l.orderUom || l.baseUom, overrides);
      if (u.ok === false) { bad(`Order ${tag} line ${l.lineNo}: unit: ${u.reason}`); return; }
      const their = o.theirs?.[i];
      if (their?.unit && their.unit.toUpperCase() !== u.code) { bad(`Order ${tag} line ${l.lineNo}: they ordered in ${their.unit}, the line is in ${u.code} now. Send it by hand.`); return; }
      info.set(l.id, { order: oi, theirNo: their?.lineNo ?? String(l.lineNo), unit: u.code, upo: l.unitsPerOrderUnit > 0 ? l.unitsPerOrderUnit : 1, itemCode: l.itemCode });
    });
  });
  for (const l of f.lines) {
    if (!l.soId || !l.soLineId) { bad("An invoiced shipment line has no Sales Order. Only goods sold against a customer's order can be sent by EDI."); break; }
    if (!info.has(l.soLineId) && !problems.length) { bad("An invoiced shipment line is for an order line that is not on the order."); break; }
  }
  if (problems.length) return { ok: false, problems };

  const items: InvoiceItem[] = f.lines.map(l => {
    const i = info.get(l.soLineId!)!; const p = f.parts[l.shipLineId] ?? { bp: null, gtin: null };
    const o = f.orders[i.order];
    return { lineNo: i.theirNo, partNumber: p.bp, gtin: p.gtin, itemCode: i.itemCode, qty: q6(l.qtyBase / i.upo), unit: i.unit, price: q6(l.ratePerBase * i.upo), poNumber: o.poNumber!.trim() };
  });
  const usedOrders = [...new Set(f.lines.map(l => info.get(l.soLineId!)!.order))];
  const single = usedOrders.length === 1 ? f.orders[usedOrders[0]] : null;
  return { ok: true, invoice: {
    invoiceNo: f.invoice.docNumber!.trim(), date: f.invoice.date, dueDate: f.invoice.dueDate, currency: f.invoice.currency,
    poNumber: single ? single.poNumber!.trim() : null, poDate: single ? single.poDate : null,
    customer: f.customer, us: f.us, items, net: f.invoice.net, tax: f.invoice.tax, total: f.invoice.total,
    kind: "invoice", taxType, charges: chargesOf(extras),
  } };
}

/** Charges and allowances as the 810 states them: a positive amount with C or A. */
function chargesOf(extras: { description: string; amount: number }[]): InvoiceOut["charges"] {
  return extras.map(x => ({ kind: x.amount < 0 ? "A" as const : "C" as const, description: (x.description || (x.amount < 0 ? "Discount" : "Charge")).slice(0, 80), amount: c2(Math.abs(x.amount)) }));
}

/** A posted credit note: the lines come from the credit itself (no order line to echo), so line numbers are 1..n. */
export type CreditFacts = {
  credit: { docNumber: string | null; date: string; currency: string | null; net: number; tax: number; total: number; posted: boolean };
  customer: { name: string; gln: string | null }; us: { name: string; gln: string | null };
  lines: { description: string; itemCode: string | null; baseUom: string | null; qty: number; rate: number; amount: number; bp: string | null; gtin: string | null }[];
  extras?: { description: string; amount: number }[];
};

export function buildCreditNote(f: CreditFacts, overrides: Record<string, string>, taxType = "ZZ"): { ok: true; invoice: InvoiceOut } | { ok: false; problems: InvProblem[] } {
  const problems: InvProblem[] = [];
  const bad = (message: string) => problems.push({ lineNo: null, message });
  if (!f.credit.posted) bad("This credit note is not posted.");
  if (!f.credit.docNumber?.trim()) bad("The credit note has no number.");
  if (!f.lines.length) bad("The credit note has no goods lines. Only credits for stocked or sold items can be sent by EDI.");
  if (f.credit.tax < -0.005) bad("The credit note tax is negative.");
  const extras = f.extras ?? [];
  const goods = c2(f.lines.reduce((s, l) => s + l.amount, 0));
  const extrasTotal = c2(extras.reduce((s, x) => s + x.amount, 0));
  if (Math.abs(goods + extrasTotal - f.credit.net) > 0.01) bad(`The lines add up to ${c2(goods + extrasTotal)}, the credit net is ${f.credit.net}. Send it by hand.`);
  if (Math.abs(f.credit.net + f.credit.tax - f.credit.total) > 0.01) bad(`Net ${f.credit.net} plus tax ${f.credit.tax} is not the total ${f.credit.total}.`);
  const items: InvoiceItem[] = [];
  f.lines.forEach((l, i) => {
    if (!(l.qty > 0)) { bad(`Line ${i + 1}: the quantity must be above zero.`); return; }
    const u = x12UnitFor(l.baseUom, overrides);
    if (u.ok === false) { bad(`Line ${i + 1} (${l.description}): unit: ${u.reason}`); return; }
    items.push({ lineNo: String(i + 1), partNumber: l.bp, gtin: l.gtin, itemCode: l.itemCode, qty: q6(l.qty), unit: u.code, price: q6(l.rate), poNumber: "" });
  });
  if (problems.length) return { ok: false, problems };
  return { ok: true, invoice: {
    invoiceNo: f.credit.docNumber!.trim(), date: f.credit.date, dueDate: null, currency: f.credit.currency, poNumber: null, poDate: null,
    customer: f.customer, us: f.us, items, net: f.credit.net, tax: f.credit.tax, total: f.credit.total,
    kind: "credit", taxType, charges: chargesOf(extras),
  } };
}
