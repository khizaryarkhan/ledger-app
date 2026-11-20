/**
 * X12 inbound transaction sets → the canonical model. Pure.
 * 997 (functional acknowledgement) and 855 (PO acknowledgement).
 * Dates CCYYMMDD → YYYY-MM-DD by slicing; anything else is reported, not guessed.
 */

import { el } from "@/lib/edi/x12/read";
import type { EdiFunctionalAck, EdiOrderAck, EdiAckLine } from "@/lib/edi/model";

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
