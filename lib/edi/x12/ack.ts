/**
 * Our other two acknowledgements of a file the partner sent. Pure.
 *
 * TA1 answers the ENVELOPE: did we read their ISA...IEA (control numbers, counts, separators). It sits between ISA and IEA
 * with no group. 999 answers the SYNTAX of each functional group and transaction set: the 5010 successor of the 997, with
 * IK5 where the 997 says AK5. As with our 997, a file we stored was read in full (a file whose counts do not add up is
 * refused and never stored), so everything we acknowledge is accepted. Whether we AGREE with the content (a price, a
 * quantity) is a business answer, never a TA1 or a 999. An acknowledgement is never acknowledged (see the callers).
 */

import { seg, interchangeSets, interchangeBare, type Envelope } from "@/lib/edi/x12/envelope";
import type { ReceivedGroup } from "@/lib/edi/x12/997";

/** TA1 for one received interchange: its control number, ISA date (YYMMDD) and time (HHMM) echoed back, accepted, no error. */
export function writeTa1(received: { controlNo: number; date: string; time: string }, env: Envelope): string {
  return interchangeBare(env, [seg("TA1", String(received.controlNo).padStart(9, "0"), received.date, received.time, "A", "000")]);
}

/** One 999 per received group, all in one FA group. Null when there is nothing to acknowledge. */
export function write999(groups: ReceivedGroup[], env: Envelope): string | null {
  const sets = groups.filter(g => g.functionalId !== "FA").map(g => ({
    txnSet: "999",
    body: [
      seg("AK1", g.functionalId, g.controlNo, g.version ?? ""),
      ...g.txns.flatMap(t => [seg("AK2", t.setId, t.controlNo), seg("IK5", "A")]),
      seg("AK9", "A", g.txns.length, g.txns.length, g.txns.length),
    ],
  }));
  return sets.length ? interchangeSets(env, "FA", sets) : null;
}
