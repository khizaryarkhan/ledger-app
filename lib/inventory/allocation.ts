/**
 * Lot allocation for manufacturing orders — the pure rules (no db, client-safe).
 *
 * The MO lifecycle agreed with the product owner (2026-09-24):
 *   Scheduled   → no entry; the output shows as EXPECTED stock.
 *   In Progress → no entry; production picks the lots of every RM/WIP that
 *                 goes in, and those quantities are ALLOCATED — still on hand,
 *                 still in their stock account, but no other MO, shipment, sale
 *                 or job work can issue them.
 *   Completed   → the one entry: exactly the allocated lot quantities are
 *                 consumed at their own cost, and the output lot is produced.
 *   Cancelled   → allocations released; nothing ever posted.
 *
 * Nothing issues stock by FIFO or at a typed cost on the way — an MO consumes
 * the lots a person chose, which is what makes its cost and its traceability
 * the same fact.
 */

import { roundQty, QTY_EPSILON } from "@/lib/inventory/round";

export type AllocatableLot = {
  id: string;
  lotNo: string | null;
  remainingQty: number;
  /** Already reserved for OTHER orders. */
  allocatedElsewhere: number;
  expiryDate: string | null;     // YYYY-MM-DD
  receivedDate: string | null;   // YYYY-MM-DD
  unitCost: number;
};

/** What of a lot this order may still take. Never negative. */
export function availableInLot(l: { remainingQty: number; allocatedElsewhere: number }): number {
  return Math.max(0, roundQty(l.remainingQty - l.allocatedElsewhere));
}

/**
 * First-expiry-first-out: lots with an expiry first, earliest expiry first;
 * lots with no expiry after them, oldest receipt first. Date strings are
 * compared literally — they are calendar dates, never instants.
 */
export function fefoOrder<T extends Pick<AllocatableLot, "expiryDate" | "receivedDate" | "id">>(lots: T[]): T[] {
  const key = (d: string | null) => d ?? "9999-12-31";
  return [...lots].sort((a, b) =>
    key(a.expiryDate).localeCompare(key(b.expiryDate))
    || key(a.receivedDate).localeCompare(key(b.receivedDate))
    || a.id.localeCompare(b.id));
}

/** Suggest lot quantities covering `need`, FEFO, from what is available. */
export function suggestPicks(lots: AllocatableLot[], need: number): { lotId: string; qty: number }[] {
  let left = roundQty(Math.max(0, need));
  const out: { lotId: string; qty: number }[] = [];
  for (const l of fefoOrder(lots)) {
    if (left <= QTY_EPSILON) break;
    const take = Math.min(availableInLot(l), left);
    if (take <= QTY_EPSILON) continue;
    out.push({ lotId: l.id, qty: roundQty(take) });
    left = roundQty(left - take);
  }
  return out;
}

export type MaterialCoverage = "none" | "partial" | "full" | "over";

/** How far a material's allocation covers what the order planned. */
export function coverage(planned: number, allocated: number): MaterialCoverage {
  if (allocated <= QTY_EPSILON) return "none";
  const d = roundQty(allocated - planned);
  if (Math.abs(d) <= QTY_EPSILON) return "full";
  return d > 0 ? "over" : "partial";
}

/**
 * Validate a requested allocation for one material against the lots it names.
 * Returns the error to show, or null. A lot may not be over-allocated across
 * orders; the same lot twice in one request is a mistake, not a top-up.
 */
export function allocationError(
  picks: { lotId: string; qty: number }[],
  lots: Map<string, AllocatableLot>,
): string | null {
  const seen = new Set<string>();
  for (const p of picks) {
    if (seen.has(p.lotId)) return "The same lot is listed twice — enter one quantity per lot.";
    seen.add(p.lotId);
    if (!(p.qty > 0)) return "Each lot needs a quantity greater than zero.";
    const l = lots.get(p.lotId);
    if (!l) return "One of the chosen lots is not open stock of this material.";
    const avail = availableInLot(l);
    if (roundQty(p.qty - avail) > QTY_EPSILON) {
      return `Lot ${l.lotNo ?? ""} has only ${avail} available${l.allocatedElsewhere > 0 ? ` (${roundQty(l.allocatedElsewhere)} is allocated to other orders)` : ""}.`;
    }
  }
  return null;
}
