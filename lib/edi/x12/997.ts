/**
 * Our X12 997 for a file the partner sent. Pure.
 *
 * A 997 answers one thing: did OUR translator accept the envelope and syntax of
 * each functional group. A file we stored was read in full (readInterchange
 * refuses a file whose counts or control numbers do not add up, and such a file
 * is never stored), so every group we acknowledge is accepted (AK5/AK9 = A).
 * Whether we agree with the CONTENT (a price, a quantity) is a business answer,
 * not a 997. A 997 is never acknowledged with a 997 (an FA group is skipped).
 */

import { seg, interchangeSets, type Envelope } from "@/lib/edi/x12/envelope";

export type ReceivedGroup = { functionalId: string; controlNo: number; txns: { setId: string; controlNo: string }[] };

/** One 997 per received group, all in one FA group. Null when there is nothing to acknowledge. */
export function write997(groups: ReceivedGroup[], env: Envelope): string | null {
  const sets = groups.filter(g => g.functionalId !== "FA").map(g => ({
    txnSet: "997",
    body: [
      seg("AK1", g.functionalId, g.controlNo),
      ...g.txns.flatMap(t => [seg("AK2", t.setId, t.controlNo), seg("AK5", "A")]),
      seg("AK9", "A", g.txns.length, g.txns.length, g.txns.length),
    ],
  }));
  return sets.length ? interchangeSets(env, "FA", sets) : null;
}
