/**
 * X12 850 Purchase Order writer. Pure. Takes the canonical EdiOrder plus the
 * unit codes the validator resolved; never looks anything up itself.
 *
 * A first cut against the common 4010/5010 shape. Each partner's
 * implementation guide decides the exact segments; anything partner-specific
 * belongs in the partner profile, never hard-coded here.
 */

import type { EdiOrder, EdiParty } from "@/lib/edi/model";
import type { ResolvedLine } from "@/lib/edi/validate";
import { seg, clean, ccyymmdd, num, interchange, type Envelope } from "@/lib/edi/x12/envelope";

/** GTIN-14 → the qualifier and length X12 expects: UP (UPC-A, 12), EN (EAN-13), UK (GTIN-14). */
export function gtinPair(gtin14: string): [string, string] {
  if (gtin14.startsWith("00")) return ["UP", gtin14.slice(2)];
  if (gtin14.startsWith("0")) return ["EN", gtin14.slice(1)];
  return ["UK", gtin14];
}

function partyLoop(code: "BY" | "SE" | "ST", p: EdiParty): string[] {
  const out = [p.gln ? seg("N1", code, clean(p.name, 60), "UL", p.gln) : seg("N1", code, clean(p.name, 60))];
  const a = p.address;
  if (a && (a.street || a.line2)) out.push(seg("N3", clean(a.street || a.line2, 55), a.street && a.line2 ? clean(a.line2, 55) : null));
  if (a && (a.city || a.postcode || a.countryCode)) {
    // N402 is a 2-character state/province code: a longer name is left out, not truncated into a wrong code.
    const state = a.state && clean(a.state).length === 2 ? clean(a.state).toUpperCase() : null;
    out.push(seg("N4", clean(a.city, 30), state, clean(a.postcode, 15), a.countryCode ? clean(a.countryCode, 3).toUpperCase() : null));
  }
  return out;
}

export function write850(order: EdiOrder, resolved: ResolvedLine[], env: Envelope): string {
  const byLine = new Map(resolved.map(r => [r.lineNo, r]));
  const body: string[] = [];
  body.push(seg("BEG", "00", "SA", clean(order.orderNumber, 22), null, ccyymmdd(order.orderDate)));
  if (order.currency) body.push(seg("CUR", "BY", order.currency));
  if (order.ourAccountNumber) body.push(seg("REF", "11", clean(order.ourAccountNumber, 50)));
  if (order.incoterm) body.push(seg("FOB", "DF", null, null, "01", clean(order.incoterm, 3), order.incotermPlace ? "ZZ" : null, order.incotermPlace ? clean(order.incotermPlace, 80) : null));
  const t = order.terms;
  if (t && (t.netDays != null || t.discountPercent != null)) {
    const discounted = t.discountPercent != null && t.discountDays != null;
    body.push(seg("ITD", discounted ? "08" : "01", "3", discounted ? num(t.discountPercent!, 2) : null, null, discounted ? t.discountDays : null, null, t.netDays));
  }
  if (order.requestedDeliveryDate) body.push(seg("DTM", "002", ccyymmdd(order.requestedDeliveryDate)));
  body.push(...partyLoop("BY", order.buyer));
  body.push(...partyLoop("SE", order.seller));
  if (order.shipTo) body.push(...partyLoop("ST", order.shipTo));

  let hash = 0;
  for (const l of order.lines) {
    const r = byLine.get(l.lineNo);
    if (!r) throw new Error(`Line ${l.lineNo} was not validated.`);
    const ids: string[] = [];
    if (l.partNumber) ids.push("VP", clean(l.partNumber, 48));
    if (l.gtin) ids.push(...gtinPair(l.gtin));
    if (l.buyerItemCode) ids.push("BP", clean(l.buyerItemCode, 48));
    body.push(seg("PO1", l.lineNo, num(l.qty), r.unitCode, num(l.unitPrice), null, ...ids));
    if (l.description) body.push(seg("PID", "F", null, null, null, clean(l.description, 80)));
    if (l.packContent && l.packContent > 1 && r.packUnitCode) body.push(seg("PO4", 1, num(l.packContent), r.packUnitCode));
    if (l.requestedDate && l.requestedDate !== order.requestedDeliveryDate) body.push(seg("DTM", "002", ccyymmdd(l.requestedDate)));
    hash += l.qty;
  }
  body.push(seg("CTT", order.lines.length, num(hash)));
  body.push(seg("AMT", "TT", num(order.total, 2)));
  return interchange(env, "PO", "850", body);
}
