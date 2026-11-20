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
};

export type InvoiceItem = { lineNo: string; partNumber: string | null; gtin: string | null; itemCode: string | null; qty: number; unit: string; price: number; poNumber: string };
export type InvoiceOut = {
  invoiceNo: string; date: string; dueDate: string | null; currency: string | null;
  /** The single order's PO number and date when the invoice covers one order, else null (each line then carries its own). */
  poNumber: string | null; poDate: string | null;
  customer: { name: string; gln: string | null }; us: { name: string; gln: string | null };
  items: InvoiceItem[]; net: number; tax: number; total: number;
};
export type InvProblem = { lineNo: number | null; message: string };

const q6 = (n: number) => Math.round(n * 1e6) / 1e6;
const c2 = (n: number) => Math.round(n * 100) / 100;

export function buildInvoice(f: InvFacts, overrides: Record<string, string>): { ok: true; invoice: InvoiceOut } | { ok: false; problems: InvProblem[] } {
  const problems: InvProblem[] = [];
  const bad = (message: string) => problems.push({ lineNo: null, message });
  if (!f.invoice.posted) bad("This invoice is not posted.");
  if (!f.invoice.docNumber?.trim()) bad("The invoice has no number.");
  if (!f.lines.length) {
    bad("This invoice has no line-level link to its shipments (it was made before they were kept, or not from shipments). Send it by hand.");
    return { ok: false, problems };
  }
  const goods = c2(f.lines.reduce((s, l) => s + l.amount, 0));
  if (Math.abs(goods - f.invoice.net) > 0.01) bad(`The shipment lines add up to ${goods}, the invoice net is ${f.invoice.net}: the invoice was edited after it was made. Send it by hand.`);
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
  } };
}
