/**
 * X12 inbound transaction sets → the canonical model. Pure.
 * 997 (functional acknowledgement), 855 (PO acknowledgement), 856 (ship notice) and 810 (invoice).
 * Dates CCYYMMDD → YYYY-MM-DD by slicing; anything else is reported, not guessed.
 */

import { el } from "@/lib/edi/x12/read";
import type { EdiFunctionalAck, EdiOrderAck, EdiAckLine, EdiShipNotice, EdiShipItem, EdiShipOrder, EdiInvoice, EdiInvoiceLine } from "@/lib/edi/model";

/** CCYYMMDD → YYYY-MM-DD, or null when it is not a real calendar date. */
export function ymdFrom(v: string): string | null {
  if (!/^\d{8}$/.test(v)) return null;
  const y = +v.slice(0, 4), m = +v.slice(4, 6), d = +v.slice(6, 8);
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) return null;
  return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
}

const ACK_STATUS: Record<string, EdiFunctionalAck["groupStatus"]> = {
  A: "accepted", E: "accepted_with_errors", P: "partially_accepted", R: "rejected", M: "rejected", W: "rejected", X: "rejected",
};

export function parse997(segments: string[][]): EdiFunctionalAck {
  const ak1 = segments.find(s => s[0] === "AK1");
  const ak9 = segments.find(s => s[0] === "AK9");
  const out: EdiFunctionalAck = {
    functionalId: el(ak1, 1), groupControlNo: Number(el(ak1, 2)),
    groupStatus: ACK_STATUS[el(ak9, 1)] ?? "rejected",
    codes: ak9 ? ak9.slice(5).map(x => x.trim()).filter(Boolean) : [], txns: [],
  };
  let cur: EdiFunctionalAck["txns"][number] | null = null;
  for (const s of segments) {
    if (s[0] === "AK2") { cur = { setId: el(s, 1), controlNo: el(s, 2), status: "accepted", codes: [] }; out.txns.push(cur); }
    else if (s[0] === "AK5" && cur) { cur.status = ACK_STATUS[el(s, 1)] ?? "rejected"; cur.codes = [...s.slice(2).map(x => x.trim()).filter(Boolean), ...cur.codes]; } // AK3/AK4 details come before AK5: keep them
    else if ((s[0] === "AK3" || s[0] === "AK4") && cur) cur.codes.push(`${s[0]}:${s.slice(1).map(x => x.trim()).filter(Boolean).join("/")}`);
  }
  return out;
}

export function parse855(segments: string[][]): EdiOrderAck {
  const bak = segments.find(s => s[0] === "BAK");
  const lines: EdiAckLine[] = [];
  let cur: EdiAckLine | null = null;
  for (const s of segments) {
    if (s[0] === "PO1") {
      cur = { lineNo: el(s, 1), qty: el(s, 2) === "" ? null : Number(el(s, 2)), unit: el(s, 3) || null, price: el(s, 4) === "" ? null : Number(el(s, 4)), acks: [] };
      lines.push(cur);
    } else if (s[0] === "ACK" && cur) {
      const rawDate = el(s, 5);
      cur.acks.push({
        status: el(s, 1), qty: el(s, 2) === "" ? null : Number(el(s, 2)), unit: el(s, 3) || null,
        dateQualifier: el(s, 4) || null, date: rawDate ? ymdFrom(rawDate) : null, rawDate: rawDate || null,
      });
    } else if (s[0] === "CTT") cur = null;
  }
  return { ackType: el(bak, 2), poNumber: el(bak, 3), poDate: ymdFrom(el(bak, 4)), lines };
}

type Hl = { id: string; parent: string; level: string; segs: string[][] };

/**
 * 856 → a ship notice. The HL tree is read as sent (any of S/O/T/P/I order):
 * an item belongs to the nearest order (O) above it and is packed in the
 * nearest pack (P) or pallet (T) above it; a pack's pallet is the nearest T
 * above the pack. Dates: DTM 011 shipped, 017/067 delivery; on an item 094
 * production, 511 best before, 036 expiry.
 */
export function parse856(segments: string[][]): EdiShipNotice {
  const bsn = segments.find(s => s[0] === "BSN");
  const problems: string[] = [];
  const hls: Hl[] = [];
  const head: string[][] = [];
  for (const s of segments) {
    if (s[0] === "HL") hls.push({ id: el(s, 1), parent: el(s, 2), level: el(s, 3), segs: [] });
    else if (hls.length) hls[hls.length - 1].segs.push(s);
    else head.push(s);
  }
  const byId = new Map(hls.map(h => [h.id, h]));
  const ancestors = (h: Hl) => {
    const out: Hl[] = []; const seen = new Set<string>([h.id]);
    let p = h.parent ? byId.get(h.parent) : undefined;
    while (p && !seen.has(p.id)) { out.push(p); seen.add(p.id); p = p.parent ? byId.get(p.parent) : undefined; }
    return out;
  };
  const first = (h: Hl, id: string, q?: string) => h.segs.find(s => s[0] === id && (q == null || el(s, 1) === q));
  const date = (raw: string, label: string, bad: string[]) => {
    if (!raw) return null;
    const d = ymdFrom(raw);
    if (!d) bad.push(`${label} "${raw}" is not a date`);
    return d;
  };
  const ssccOf = (h: Hl) => el(h.segs.find(s => s[0] === "MAN" && el(s, 1) === "GM"), 2) || null;

  const ship = hls.find(h => h.level === "S");
  const sSegs = [...head, ...(ship?.segs ?? [])];
  const dtm = (q: string) => el(sSegs.find(s => s[0] === "DTM" && el(s, 1) === q), 2);
  const td5 = sSegs.find(s => s[0] === "TD5");
  const ref = (q: string) => el(sSegs.find(s => s[0] === "REF" && el(s, 1) === q), 2);
  const shipBad: string[] = [];
  const shipDate = date(dtm("011"), "Ship date", shipBad);
  const expectedDate = date(dtm("017") || dtm("067"), "Delivery date", shipBad);
  problems.push(...shipBad);

  const orders = new Map<string, EdiShipOrder>();
  for (const h of hls.filter(x => x.level === "I")) {
    const up = ancestors(h);
    const o = up.find(a => a.level === "O");
    const lin = first(h, "LIN");
    const lineNo = el(lin, 1);
    if (!o) { problems.push(`Item line ${lineNo || h.id} has no order (HL O) above it.`); continue; }
    const poNumber = el(first(o, "PRF"), 1);
    if (!poNumber) { problems.push(`Order level ${o.id} names no purchase order (PRF01).`); continue; }
    const order = orders.get(poNumber) ?? (orders.set(poNumber, { poNumber, items: [], packages: [] }).get(poNumber)!);
    const ids: Record<string, string> = {};
    if (lin) for (let i = 2; i + 1 < lin.length; i += 2) if (lin[i]) ids[lin[i].trim()] = (lin[i + 1] ?? "").trim();
    const sn1 = first(h, "SN1");
    const iDtm = (q: string) => el(h.segs.find(s => s[0] === "DTM" && el(s, 1) === q), 2);
    const bad: string[] = [];
    const item: EdiShipItem = {
      lineNo, ids, qty: el(sn1, 2) === "" ? null : Number(el(sn1, 2)), unit: el(sn1, 3) || null,
      batch: ids.LT || el(first(h, "REF", "LT"), 2) || null,
      productionDate: date(iDtm("094"), "Production date", bad), bestBeforeDate: date(iDtm("511"), "Best-before date", bad),
      expiryDate: date(iDtm("036"), "Expiry date", bad), badDates: bad, sscc: null,
    };
    const box = up.find(a => (a.level === "P" || a.level === "T") && ssccOf(a));
    item.sscc = box ? ssccOf(box) : null;
    for (const a of up.filter(x => (x.level === "P" || x.level === "T") && ssccOf(x))) {
      const code = ssccOf(a)!;
      if (order.packages.some(p => p.sscc === code)) continue;
      const pallet = a.level === "P" ? ancestors(a).find(x => x.level === "T" && ssccOf(x)) : undefined;
      order.packages.push({ sscc: code, level: a.level === "T" ? "tare" : "pack", parentSscc: pallet ? ssccOf(pallet) : null });
    }
    order.items.push(item);
  }
  return {
    purpose: el(bsn, 1), shipmentId: el(bsn, 2), shipDate, expectedDate,
    carrier: el(td5, 5) || el(td5, 3) || null, trackingNo: ref("CN") || ref("BM") || null,
    orders: [...orders.values()], problems,
  };
}

/**
 * 810 → a supplier invoice. BIG: date, invoice number, PO number (BIG04).
 * IT1: line number (ours, echoed), qty, unit, unit price, identifiers. TDS01 is
 * the total in cents (implied 2 decimals); SAC05 likewise; TXI02 is a decimal.
 */
export function parse810(segments: string[][]): EdiInvoice {
  const big = segments.find(s => s[0] === "BIG");
  const problems: string[] = [];
  const num = (v: string) => (v === "" ? null : Number(v));
  const cents = (v: string, label: string) => {
    if (v === "") return null;
    if (!/^-?\d+$/.test(v)) { problems.push(`${label} "${v}" is not a whole number of cents`); return null; }
    return Number(v) / 100;
  };
  const rawDate = el(big, 1);
  const invoiceDate = rawDate ? ymdFrom(rawDate) : null;
  if (rawDate && !invoiceDate) problems.push(`Invoice date "${rawDate}" is not a date`);
  const itd = segments.find(s => s[0] === "ITD");
  const rawDue = el(itd, 6);
  const dueDate = rawDue ? ymdFrom(rawDue) : null;
  if (rawDue && !dueDate) problems.push(`Due date "${rawDue}" is not a date`);
  const lines: EdiInvoiceLine[] = segments.filter(s => s[0] === "IT1").map(s => {
    const ids: Record<string, string> = {};
    for (let i = 6; i + 1 < s.length; i += 2) if (s[i]) ids[s[i].trim()] = (s[i + 1] ?? "").trim();
    return { lineNo: el(s, 1), qty: num(el(s, 2)), unit: el(s, 3) || null, price: num(el(s, 4)), ids };
  });
  const txi = segments.filter(s => s[0] === "TXI" && el(s, 2) !== "");
  const charges = segments.filter(s => s[0] === "SAC").flatMap(s => {
    const amt = cents(el(s, 5), `Charge ${el(s, 2)}`);
    return amt == null ? [] : [{ code: el(s, 2), amount: el(s, 1) === "A" ? -amt : amt }];
  });
  return {
    invoiceNo: el(big, 2), invoiceDate, poNumber: el(big, 4), currency: el(segments.find(s => s[0] === "CUR"), 2) || null,
    dueDate, netDays: el(itd, 7) === "" ? null : Number(el(itd, 7)),
    lines, total: cents(el(segments.find(s => s[0] === "TDS"), 1), "Total"),
    tax: txi.length ? txi.reduce((a, s) => a + Number(el(s, 2)), 0) : null, charges, problems,
  };
}
