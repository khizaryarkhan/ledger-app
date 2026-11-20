/**
 * Rebuild the line-level `shipment_invoice` links of an invoice made from shipments BEFORE they were kept. Pure.
 *
 * It only ever rebuilds what is provable. The invoice must be the ONLY one that billed those shipments, every shipment
 * line must be fully invoiced, and the lines at their sale rate must add up to the invoice's net to the cent. Anything
 * else (a partial invoice, two invoices on one shipment, an invoice edited afterwards) is left alone with the reason
 * named: splitting a quantity between invoices would be a guess, and a guess here goes out to a customer.
 */

import { roundQty } from "@/lib/inventory/round";

export type BackfillLine = { id: string; shipmentId: string; qtyBase: number; invoicedQty: number; saleRate: number };
export type BackfillLink = { lineId: string; shipmentId: string; qty: number; amount: number };
export type BackfillPlan = { ok: true; links: BackfillLink[] } | { ok: false; reason: string };

const c2 = (n: number) => Math.round(n * 100) / 100;

export function planLineLinks(input: { invoiceNet: number; otherInvoices: number; lines: BackfillLine[] }): BackfillPlan {
  if (input.otherInvoices > 0) return { ok: false, reason: "Another invoice also billed these shipments, so the split is not provable." };
  const lines = input.lines.filter(l => l.qtyBase > 0);
  if (!lines.length) return { ok: false, reason: "No shipped quantity found on its shipments." };
  const partial = lines.find(l => roundQty(l.qtyBase - l.invoicedQty) !== 0);
  if (partial) return { ok: false, reason: "A shipment line is not fully invoiced, so this invoice may not have billed all of it." };
  const links = lines.map(l => ({ lineId: l.id, shipmentId: l.shipmentId, qty: roundQty(l.qtyBase), amount: c2(l.qtyBase * l.saleRate) }));
  const sum = c2(links.reduce((s, l) => s + l.amount, 0));
  if (Math.abs(sum - c2(input.invoiceNet)) > 0.01) return { ok: false, reason: `The shipment lines add up to ${sum.toFixed(2)} but the invoice net is ${c2(input.invoiceNet).toFixed(2)}: it was edited afterwards.` };
  return { ok: true, links };
}
