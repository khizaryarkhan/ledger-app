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

// ── BOM Builder phase 2: supplier-SKU limits and substitutes ────────────────
// Decided with the product owner (2026-11-11): under a SKU limit a lot whose supplier
// SKU is UNKNOWN is refused (a limit always means what it says), and a substitute is
// only ever PROPOSED — a planner confirms it before any lot of it is reserved.

/**
 * Split lots by an ingredient's SKU limit. No limit = every lot. Under a limit a lot
 * must carry an allowed supplier SKU: "other" is a different SKU, "unknown" is a lot
 * that never recorded one (no-PO receipts, counts, opening stock, production).
 */
export function lotsAllowedBySku<T extends { supplierSkuId: string | null }>(lots: T[], allowedSkuIds: string[]): { allowed: T[]; refused: { lot: T; reason: "unknown" | "other" }[] } {
  if (!allowedSkuIds.length) return { allowed: lots, refused: [] };
  const ok = new Set(allowedSkuIds);
  const allowed: T[] = [], refused: { lot: T; reason: "unknown" | "other" }[] = [];
  for (const l of lots) {
    if (l.supplierSkuId && ok.has(l.supplierSkuId)) allowed.push(l);
    else refused.push({ lot: l, reason: l.supplierSkuId ? "other" : "unknown" });
  }
  return { allowed, refused };
}

/**
 * The substitute to offer when the main item cannot cover the order: the first, in
 * the BOM's order, that can cover ITS OWN planned amount in full. Null while the main
 * item covers, or when nothing does. A substitute never tops up a partial main item.
 */
export function proposeSubstitute(a: { planned: number; primaryAvailable: number; subs: { itemId: string; planned: number; available: number }[] }): { itemId: string; order: number } | null {
  if (a.primaryAvailable + QTY_EPSILON >= a.planned) return null;
  for (let i = 0; i < a.subs.length; i++) {
    const s = a.subs[i];
    if (s.planned > 0 && s.available + QTY_EPSILON >= s.planned) return { itemId: s.itemId, order: i + 1 };
  }
  return null;
}

/**
 * A material is made from ONE source: its main item or exactly one substitute, never
 * a mix. Returns the reason an allocation to `target` would break that, or null.
 * `allocatedItemIds` = items of this material's family that already hold lots.
 */
export function substituteConflict(a: { target: string; primary: string; substituteIds: string[]; allocatedItemIds: string[] }): string | null {
  const family = new Set([a.primary, ...a.substituteIds]);
  if (!family.has(a.target)) return "That item is not a material of this order or one of its substitutes.";
  const other = a.allocatedItemIds.find(id => id !== a.target && family.has(id));
  return other ? "A material uses one source: its main item or one substitute, never a mix. Release the lots already chosen for the other source first." : null;
}
