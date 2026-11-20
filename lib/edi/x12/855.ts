/**
 * X12 855 Purchase Order Acknowledgement writer (we are the SELLER answering a
 * customer's 850). Pure. Takes the OrderAckOut the builder made; looks nothing
 * up. A first cut against the common 4010/5010 shape: BAK, CUR, then per line
 * PO1 (what they ordered, echoed) with one ACK per status, CTT.
 */

import type { OrderAckOut } from "@/lib/edi/build/sales-order";
import { seg, ccyymmdd, num, interchange, clean, type Envelope } from "@/lib/edi/x12/envelope";

export function write855(ack: OrderAckOut, env: Envelope): string {
  const body: string[] = [seg("BAK", "00", ack.type, clean(ack.poNumber, 22), ccyymmdd(ack.poDate))];
  if (ack.currency) body.push(seg("CUR", "SE", ack.currency));
  for (const l of ack.lines) {
    body.push(seg("PO1", clean(l.lineNo, 20), num(l.qty), l.unit, num(l.price)));
    for (const a of l.acks) {
      body.push(seg("ACK", a.status, a.qty == null ? null : num(a.qty), a.unit, a.date ? "067" : null, a.date ? ccyymmdd(a.date) : null));
    }
  }
  body.push(seg("CTT", ack.lines.length));
  return interchange(env, "PR", "855", body);
}
