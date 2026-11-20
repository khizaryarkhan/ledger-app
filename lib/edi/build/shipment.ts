/**
 * A posted shipment (with its SSCC packing) → the 856 advance ship notice we
 * send the customer. Pure. The notice lists, per customer order, the pallets
 * and cartons (each with its SSCC) and what is in them, in THEIR line numbers
 * and the unit the order was placed in. Anything not packed is listed under
 * the order directly (an ASN without a packing structure is valid).
 *
 * Never guesses: a shipment line with no Sales Order, an order with no
 * customer PO number, lines that no longer match the 850 the order came from
 * (their line numbers cannot be echoed), a unit with no EDI code, or a package
 * holding goods of two orders (one HL tree carries one order) is not sent, and
 * the reason is named.
 */

import { x12UnitFor } from "@/lib/edi/validate";

export type ShipFacts = {
  shipment: { shipmentNo: string | null; shipDate: string; carrier: string | null; trackingNo: string | null; posted: boolean };
  shipFrom: { name: string; gln: string | null };
  lines: { id: string; soId: string | null; soLineId: string | null; qtyBase: number }[];
  orders: {
    soId: string; poNumber: string | null; poDate: string;
    shipTo: { name: string | null; gln: string | null; code: string | null } | null;
    soLines: { id: string; lineNo: number; orderUom: string | null; baseUom: string | null; unitsPerOrderUnit: number; itemCode: string | null }[];
    /** Their line numbers and units from the stored 850, positional with `soLines` ordered by line number; null when keyed by hand. */
    theirs: { lineNo: string; unit: string | null }[] | null;
  }[];
  /** Per shipment line: THEIR part number and a GTIN for the pack level it was ordered at. */
  parts: Record<string, { bp: string | null; gtin: string | null }>;
  /** Batch and dates per shipment line, for lines issued from a single lot (see lotsForLines). */
  lots?: Record<string, LotInfo>;
  packages: { id: string; sscc: string; parentId: string | null; packType: string; lines: { shipmentLineId: string; qtyBase: number }[] }[];
  /** An 856 for this shipment was already sent: this one replaces it (BSN01 05). */
  replaces: boolean;
};

/** The batch and dates of the one lot a shipment line was issued from (what a GS1 label carries: AI 10, 11, 15, 17). */
export type LotInfo = { batch: string | null; productionDate: string | null; bestBeforeDate: string | null; expiryDate: string | null };
/** One lot's issue for a shipment, from the stock movements the shipment posted. */
export type LotIssue = { itemId: string; lotId: string; qtyBase: number; batch: string | null; productionDate: string | null; bestBeforeDate: string | null; expiryDate: string | null };

/**
 * Lot data per shipment line, ONLY where it is unambiguous: the line is the only one of its item on the shipment (the
 * movements record the item, not the line) and everything shipped of that item came from a single lot. A line issued from
 * several lots gets none: the packing records what is in each package per line, never per lot, so naming a batch for it
 * would be a guess.
 */
export function lotsForLines(lines: { id: string; itemId: string }[], issues: LotIssue[]): Record<string, LotInfo> {
  const out: Record<string, LotInfo> = {};
  for (const l of lines) {
    if (lines.filter(x => x.itemId === l.itemId).length !== 1) continue;
    const mine = issues.filter(i => i.itemId === l.itemId && i.qtyBase > 0);
    const lots = [...new Set(mine.map(i => i.lotId))];
    if (lots.length !== 1) continue;
    const { batch, productionDate, bestBeforeDate, expiryDate } = mine[0];
    out[l.id] = { batch, productionDate, bestBeforeDate, expiryDate };
  }
  return out;
}

export type AsnItem = { lineNo: string; partNumber: string | null; gtin: string | null; itemCode: string | null; qty: number; unit: string } & Partial<LotInfo>;
export type AsnPackage = { sscc: string; level: "tare" | "pack"; parentSscc: string | null; items: AsnItem[] };
export type AsnOrder = { poNumber: string; poDate: string; shipTo: { name: string | null; gln: string | null; code: string | null } | null; packages: AsnPackage[]; loose: AsnItem[] };
export type ShipNoticeOut = {
  shipmentId: string; purpose: "00" | "05"; shipDate: string; carrier: string | null; trackingNo: string | null;
  shipFrom: { name: string; gln: string | null }; orders: AsnOrder[];
};
export type AsnProblem = { lineNo: number | null; message: string };

const EPS = 1e-6;
const q6 = (n: number) => Math.round(n * 1e6) / 1e6;

export function buildShipNotice(f: ShipFacts, overrides: Record<string, string>): { ok: true; asn: ShipNoticeOut } | { ok: false; problems: AsnProblem[] } {
  const problems: AsnProblem[] = [];
  const bad = (message: string) => problems.push({ lineNo: null, message });
  if (!f.shipment.posted) bad("This shipment is not posted (it was reversed).");
  if (!f.lines.length) bad("The shipment has no lines.");

  const soLineInfo = new Map<string, { order: number; theirNo: string; unit: string; upo: number; itemCode: string | null }>();
  f.orders.forEach((o, oi) => {
    const tag = o.poNumber ?? "(no PO number)";
    if (!o.poNumber?.trim()) bad("A Sales Order on this shipment has no customer PO number. The notice must quote it: set it on the order.");
    const sorted = [...o.soLines].sort((a, b) => a.lineNo - b.lineNo);
    if (o.theirs && o.theirs.length !== sorted.length) {
      bad(`Order ${tag} has ${sorted.length} line(s), their order had ${o.theirs.length}. The lines no longer match the order they sent, so their line numbers cannot be echoed. Advise it by hand.`);
      return;
    }
    sorted.forEach((l, i) => {
      const u = x12UnitFor(l.orderUom || l.baseUom, overrides);
      if (u.ok === false) { bad(`Order ${tag} line ${l.lineNo}: unit: ${u.reason}`); return; }
      const their = o.theirs?.[i];
      if (their?.unit && their.unit.toUpperCase() !== u.code) { bad(`Order ${tag} line ${l.lineNo}: they ordered in ${their.unit}, the line is in ${u.code} now. Advise it by hand.`); return; }
      soLineInfo.set(l.id, { order: oi, theirNo: their?.lineNo ?? String(l.lineNo), unit: u.code, upo: l.unitsPerOrderUnit > 0 ? l.unitsPerOrderUnit : 1, itemCode: l.itemCode });
    });
  });

  const lineById = new Map(f.lines.map(l => [l.id, l]));
  for (const l of f.lines) {
    if (!l.soId || !l.soLineId) { bad("A shipment line has no Sales Order. Only goods shipped against a customer's order can be advised by EDI."); break; }
    if (!soLineInfo.has(l.soLineId) && !problems.length) { bad("A shipment line is for an order line that is not on the order."); break; }
  }
  if (problems.length) return { ok: false, problems };

  const item = (lineId: string, qtyBase: number): AsnItem => {
    const l = lineById.get(lineId)!; const info = soLineInfo.get(l.soLineId!)!; const p = f.parts[lineId] ?? { bp: null, gtin: null };
    const lot = f.lots?.[lineId];
    return { lineNo: info.theirNo, partNumber: p.bp, gtin: p.gtin, itemCode: info.itemCode, qty: q6(qtyBase / info.upo), unit: info.unit,
      ...(lot ? { batch: lot.batch, productionDate: lot.productionDate, bestBeforeDate: lot.bestBeforeDate, expiryDate: lot.expiryDate } : {}) };
  };

  // Which order each package belongs to: its own contents', else its children's. One order per package.
  const byId = new Map(f.packages.map(p => [p.id, p]));
  const kids = (id: string) => f.packages.filter(p => p.parentId === id);
  const orderIdx = new Map<string, Set<number>>();
  const collect = (id: string): Set<number> => {
    if (orderIdx.has(id)) return orderIdx.get(id)!;
    const p = byId.get(id)!;
    const s = new Set<number>();
    for (const c of p.lines) { const l = lineById.get(c.shipmentLineId); if (l?.soLineId) s.add(soLineInfo.get(l.soLineId)!.order); }
    for (const k of kids(id)) collect(k.id).forEach(x => s.add(x));
    orderIdx.set(id, s);
    return s;
  };
  for (const p of f.packages) if (collect(p.id).size > 1) bad(`SSCC ${p.sscc} holds goods of more than one order. Pack each order's goods separately.`);
  if (problems.length) return { ok: false, problems };

  const packed = new Map<string, number>();
  for (const p of f.packages) for (const c of p.lines) packed.set(c.shipmentLineId, (packed.get(c.shipmentLineId) ?? 0) + c.qtyBase);

  const orders: AsnOrder[] = [];
  f.orders.forEach((o, oi) => {
    const pkgs: AsnPackage[] = f.packages.filter(p => [...collect(p.id)][0] === oi).map(p => ({
      sscc: p.sscc, level: p.packType === "pallet" ? "tare" as const : "pack" as const,
      parentSscc: p.parentId ? byId.get(p.parentId)?.sscc ?? null : null,
      items: p.lines.map(c => item(c.shipmentLineId, c.qtyBase)),
    }));
    const loose: AsnItem[] = [];
    for (const l of f.lines) {
      if (soLineInfo.get(l.soLineId!)!.order !== oi) continue;
      const rest = l.qtyBase - (packed.get(l.id) ?? 0);
      if (rest > EPS) loose.push(item(l.id, rest));
    }
    if (pkgs.length || loose.length) orders.push({ poNumber: o.poNumber!.trim(), poDate: o.poDate, shipTo: o.shipTo, packages: pkgs, loose });
  });
  if (!orders.length) return { ok: false, problems: [{ lineNo: null, message: "Nothing on the shipment is listed under an order." }] };
  return { ok: true, asn: {
    shipmentId: f.shipment.shipmentNo || "SHIPMENT", purpose: f.replaces ? "05" : "00", shipDate: f.shipment.shipDate,
    carrier: f.shipment.carrier, trackingNo: f.shipment.trackingNo, shipFrom: f.shipFrom, orders,
  } };
}
