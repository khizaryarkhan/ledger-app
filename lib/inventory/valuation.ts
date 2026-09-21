/**
 * Perpetual inventory valuation — FIFO by cost lot.
 *
 * A LOT is a dated cost layer created when stock is received (purchase) or
 * produced (BOM build). Issuing stock (sale or production consumption) relieves
 * the oldest open lots first (FIFO) unless specific lots are picked, so every
 * unit carries the exact cost it entered at. The item's on-hand qty and value
 * are cached on ap_items and recomputed from the open lots after every change.
 *
 * neon-http has NO transactions — we plan (read-only) then commit, and always
 * recompute the cached totals from the authoritative lot rows afterwards.
 */

import { db } from "@/db";
import { apItems, inventoryLots, inventoryMovements } from "@/db/schema";
import { and, eq, asc, sql, inArray, or } from "drizzle-orm";
import { kindOf } from "@/lib/inventory/item-kinds";
import { nextDocNumber, resolveDocNumber } from "@/lib/accounting/numbering";
import {
  resolveLocationId, ensureDefaultLocation, placementsForLots, placeQty, takeQty,
  type LotPlacement,
} from "@/lib/inventory/locations";

const n4 = (n: number) => (Math.round((Number(n) || 0) * 1e4) / 1e4).toFixed(4);
const n6 = (n: number) => (Math.round((Number(n) || 0) * 1e6) / 1e6).toFixed(6);
const num = (v: any) => Number(v ?? 0);

export type ItemCostInfo = {
  id: string; name: string; productType: string; baseUom: string | null;
  tracked: boolean; lotTracked: boolean;
  assetAccountId: string | null; cogsAccountId: string | null;
  // Revenue/expense accounts the item is configured to post through. Carried
  // here so document posting can DERIVE a line's account from its item rather
  // than trusting whatever account the client sent (lib/accounting/documents.ts).
  incomeAccountId: string | null; expenseAccountId: string | null;
  unitCost: number | null;
};

/** Load costing metadata for a set of item ids. */
export async function loadItemCostInfo(orgId: string, itemIds: string[]): Promise<Map<string, ItemCostInfo>> {
  const ids = [...new Set(itemIds.filter(Boolean))];
  const map = new Map<string, ItemCostInfo>();
  if (!ids.length) return map;
  const rows = await db.select().from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, ids)));
  for (const r of rows) {
    map.set(r.id, {
      id: r.id, name: r.name, productType: r.productType, baseUom: r.baseUom,
      tracked: kindOf(r.productType).tracked, lotTracked: !!r.lotTracked,
      assetAccountId: r.assetAccountId ?? null, cogsAccountId: r.cogsAccountId ?? null,
      incomeAccountId: r.incomeAccountId ?? null, expenseAccountId: r.expenseAccountId ?? null,
      unitCost: r.unitCost != null ? Number(r.unitCost) : null,
    });
  }
  return map;
}

/** Recompute cached on-hand qty & value from the item's OPEN lots. Authoritative. */
export async function recalcItemCache(orgId: string, itemId: string): Promise<void> {
  const lots = await db.select({ rem: inventoryLots.remainingQty, cost: inventoryLots.unitCost })
    .from(inventoryLots)
    .where(and(eq(inventoryLots.orgId, orgId), eq(inventoryLots.itemId, itemId), eq(inventoryLots.status, "Open")));
  let qty = 0, val = 0;
  for (const l of lots) { const q = num(l.rem); qty += q; val += q * num(l.cost); }
  await db.update(apItems).set({ onHandQty: n4(qty), invValue: n4(val), updatedAt: new Date() })
    .where(and(eq(apItems.id, itemId), eq(apItems.orgId, orgId)));
}

/** On-hand base qty & value per stock SKU (and SKU-less base stock) for an item. */
export async function onHandBySku(orgId: string, itemId: string): Promise<Map<string | null, { qty: number; value: number }>> {
  const lots = await db.select({ skuId: inventoryLots.skuId, rem: inventoryLots.remainingQty, cost: inventoryLots.unitCost })
    .from(inventoryLots)
    .where(and(eq(inventoryLots.orgId, orgId), eq(inventoryLots.itemId, itemId), eq(inventoryLots.status, "Open")));
  const map = new Map<string | null, { qty: number; value: number }>();
  for (const l of lots) {
    const key = l.skuId ?? null; const q = num(l.rem);
    const cur = map.get(key) ?? { qty: 0, value: 0 };
    cur.qty += q; cur.value += q * num(l.cost);
    map.set(key, cur);
  }
  return map;
}

export type IssuePick = {
  lotId: string | null; lotNo: string | null; qty: number; unitCost: number;
  // Which physical location this slice leaves from. null means either a
  // shortfall pick (no stock at all — costed at fallback) or stock on a lot
  // that carries no placement row. See `unlocated` below.
  locationId: string | null;
};
export type IssuePlan = {
  itemId: string; qty: number; totalCost: number; picks: IssuePick[]; shortfallQty: number;
  /**
   * Quantity drawn from lots whose placement rows do not account for their
   * remaining balance. That is an integrity break (the reconciliation check
   * reports it), but it must not stop stock physically leaving the building, so
   * it is drawn and flagged rather than refused.
   */
  unlocatedQty: number;
};

export type IssueOptions = {
  /** Specific-identification: restrict to these lots (production lot picking). */
  restrictLotIds?: string[];
  /** Stock SKU when the transaction names one; RM issues pass none. */
  skuId?: string | null;
  /**
   * Issue only from this location. Already validated by the caller through
   * resolveLocationId() — planning does not re-check tenancy, because nothing
   * here writes.
   */
  locationId?: string | null;
};

/**
 * Plan a FIFO issue (read-only).
 *
 * FIFO is decided by LOT (oldest cost layer first) and location only ever
 * narrows what is reachable inside a lot — it never reorders the layers. That
 * ordering is what makes the cost deterministic, and it is the property the
 * whole valuation model rests on.
 *
 * Within one lot, slices are taken in location-code order so a plan built twice
 * from the same data picks the same way.
 *
 * Stock in a non-issuable location (Quarantine) is never picked by FIFO. It has
 * not been released, and consuming it silently is precisely the mistake that
 * location type exists to prevent. Naming such a location explicitly is refused
 * earlier, by resolveLocationId({ forIssue: true }).
 */
export async function planIssue(
  orgId: string,
  item: ItemCostInfo,
  qty: number,
  opts: IssueOptions = {},
): Promise<IssuePlan> {
  const want = Math.max(0, Number(qty) || 0);
  const picks: IssuePick[] = [];
  const empty: IssuePlan = { itemId: item.id, qty: 0, totalCost: 0, picks, shortfallQty: 0, unlocatedQty: 0 };
  if (want === 0) return empty;

  const { restrictLotIds, skuId, locationId } = opts;

  let lots = await db.select().from(inventoryLots)
    .where(and(eq(inventoryLots.orgId, orgId), eq(inventoryLots.itemId, item.id), eq(inventoryLots.status, "Open")))
    .orderBy(asc(inventoryLots.receivedDate), asc(inventoryLots.createdAt));
  // Scope to a stock SKU when the transaction names one (FP/SI sold by pack);
  // RM issues pass no skuId and draw from the item's (SKU-less) base lots.
  if (skuId) lots = lots.filter(l => l.skuId === skuId);
  if (restrictLotIds?.length) { const set = new Set(restrictLotIds); lots = lots.filter(l => set.has(l.id)); }
  if (!lots.length) return shortfallOnly(item, want);

  const placements = await placementsForLots(orgId, lots.map(l => l.id));

  let remaining = want, cost = 0, unlocated = 0;
  for (const lot of lots) {
    if (remaining <= 0) break;
    const lotRemaining = num(lot.remainingQty);
    if (lotRemaining <= 0) continue;
    const unitCost = num(lot.unitCost);

    const slices = reachableSlices(placements.get(lot.id) ?? [], lotRemaining, locationId ?? null);
    for (const slice of slices) {
      if (remaining <= 0) break;
      const take = Math.min(slice.qty, remaining);
      if (take <= 0) continue;
      picks.push({ lotId: lot.id, lotNo: lot.lotNo, qty: take, unitCost, locationId: slice.locationId });
      if (slice.locationId === null) unlocated += take;
      cost += take * unitCost;
      remaining -= take;
    }
  }

  const shortfallQty = Math.round(remaining * 1e4) / 1e4;
  if (shortfallQty > 0) {
    const fb = item.unitCost ?? (picks.length ? picks[picks.length - 1].unitCost : 0);
    picks.push({ lotId: null, lotNo: null, qty: shortfallQty, unitCost: fb, locationId: null });
    cost += shortfallQty * fb;
  }
  return {
    itemId: item.id, qty: want,
    totalCost: Math.round(cost * 1e4) / 1e4,
    picks, shortfallQty,
    unlocatedQty: Math.round(unlocated * 1e4) / 1e4,
  };
}

function shortfallOnly(item: ItemCostInfo, want: number): IssuePlan {
  const fb = item.unitCost ?? 0;
  return {
    itemId: item.id, qty: want, totalCost: Math.round(want * fb * 1e4) / 1e4,
    picks: [{ lotId: null, lotNo: null, qty: want, unitCost: fb, locationId: null }],
    shortfallQty: want, unlocatedQty: 0,
  };
}

export type Slice = { locationId: string | null; qty: number };

/**
 * What of a lot's remaining balance can this issue actually reach, in pick order.
 *
 * Exported for tests: this is the whole rule that decides which physical stock
 * an issue may touch, and it is pure, so it is the one part of the
 * location-aware engine that can be proven without a database.
 *
 * `placements` arrives ordered by location code (placementsForLots), which is
 * what makes an unscoped pick reproducible.
 */
export function reachableSlices(placements: LotPlacement[], lotRemaining: number, locationId: string | null): Slice[] {
  if (locationId) {
    // Scoped: only that location, and only up to what the lot still holds —
    // a placement row larger than the lot's remaining balance is drift, and
    // honouring it would let an issue relieve stock the lot does not have.
    const p = placements.find(x => x.locationId === locationId);
    if (!p) return [];
    return [{ locationId, qty: Math.min(p.qty, lotRemaining) }];
  }

  const slices: Slice[] = [];
  let budget = lotRemaining;
  for (const p of placements) {
    if (budget <= 0) break;
    if (!p.issuable) continue;   // Quarantine and friends are not reachable by FIFO
    const q = Math.min(p.qty, budget);
    if (q <= 0) continue;
    slices.push({ locationId: p.locationId, qty: q });
    budget -= q;
  }

  // Anything the placement rows do not account for. Held stock that nobody can
  // say where it is, is still held stock — draw it, mark it, and let the
  // reconciliation check be the thing that complains.
  const placed = placements.reduce((s, p) => s + p.qty, 0);
  const gap = Math.round((lotRemaining - placed) * 1e4) / 1e4;
  if (gap > 0) slices.push({ locationId: null, qty: gap });

  return slices;
}

export type ReceiptInput = {
  itemId: string; qty: number; unitCost: number;
  skuId?: string | null;           // stock SKU (item_skus) for SI/FP; null = base-UoM (RM)
  // The item's productType (apItems.productType) — required to resolve the
  // lot code: FinishedProduct/WorkInProgress always get a system-generated
  // code (lotNo below is ignored for them); StockItem/RawMaterial use lotNo
  // as a suggested default the caller pre-filled, overridable by the user.
  productType: string;
  lotNo?: string | null; expiryDate?: string | null; supplierId?: string | null;
  sourceType?: "purchase" | "production" | "opening" | "adjustment" | "jobwork";
  receivedDate: string; refType: string; refId: string; entryId?: string | null;
  createdBy?: string | null; note?: string | null;
  /**
   * Where the stock physically lands. Required as a property (so every call
   * site had to decide) but nullable as a value, which resolves to the org
   * default — that is what keeps a caller who genuinely has no choice to offer,
   * such as an opening-balance import, working.
   *
   * The id is validated against this org before use; never write it straight
   * onto a lot.
   */
  locationId: string | null;
};

/**
 * Resolve the lot code to actually store. FP/WIP: always system-generated,
 * a real, unique, immutable identifier — never the caller's input (matches
 * the UI, which doesn't offer an editable field for these kinds). SI/RM: the
 * caller's input is itself expected to already be a system-suggested default
 * (peekDocNumber against the LotSIRM series) that the user may have
 * overwritten with a supplier's own batch number — resolveDocNumber records
 * whichever was used and advances the series past it either way.
 */
async function resolveLotNo(orgId: string, productType: string, requested?: string | null): Promise<string> {
  const isFPWIP = ["FinishedProduct", "WorkInProgress"].includes(kindOf(productType).kind);
  if (isFPWIP) return nextDocNumber(orgId, "LotFPWIP");
  return resolveDocNumber(orgId, "LotSIRM", requested);
}

/** Commit a stock receipt: create a lot + placement + movement, refresh the item cache. Returns the lot id. */
export async function commitReceipt(orgId: string, r: ReceiptInput): Promise<string> {
  const qty = Math.max(0, Number(r.qty) || 0);
  const unitCost = Math.max(0, Number(r.unitCost) || 0);
  // Resolved BEFORE the lot is written. If the caller supplied a location that
  // is not theirs, inactive, or unknown, this throws and nothing has been
  // created — rather than leaving a lot behind with nowhere to put it.
  const locationId = await resolveLocationId(orgId, r.locationId, { label: "Receiving location" });
  const lotNo = await resolveLotNo(orgId, r.productType, r.lotNo);
  const [lot] = await db.insert(inventoryLots).values({
    orgId, itemId: r.itemId, skuId: r.skuId ?? null,
    lotNo,
    sourceType: r.sourceType ?? "purchase", sourceId: r.entryId ?? r.refId,
    supplierId: r.supplierId ?? null,
    receivedDate: r.receivedDate, expiryDate: r.expiryDate ?? null,
    origQty: n4(qty), remainingQty: n4(qty), unitCost: n6(unitCost),
    status: qty > 0 ? "Open" : "Depleted", note: r.note ?? null,
  } as any).returning({ id: inventoryLots.id });

  // Place it. A zero-quantity lot gets no placement row: "no rows" is how the
  // invariant expresses zero, so an empty lot is already consistent.
  if (qty > 0) await placeQty(orgId, lot.id, locationId, qty);

  await db.insert(inventoryMovements).values({
    orgId, itemId: r.itemId, skuId: r.skuId ?? null, lotId: lot.id, movementType: r.sourceType === "production" ? "produce" : r.sourceType === "jobwork" ? "jobwork_receipt" : "receipt",
    qty: n4(qty), unitCost: n6(unitCost), totalCost: n4(qty * unitCost),
    toLocationId: locationId,
    refType: r.refType, refId: r.refId, entryId: r.entryId ?? null,
    movementDate: r.receivedDate, note: r.note ?? null, createdBy: r.createdBy ?? null,
  } as any);
  await recalcItemCache(orgId, r.itemId);
  return lot.id;
}

export type IssueCommit = {
  itemId: string; plan: IssuePlan; movementType: "issue_sale" | "issue_production" | "adjustment" | "issue_jobwork";
  skuId?: string | null;
  refType: string; refId: string; entryId?: string | null; date: string; createdBy?: string | null; note?: string | null;
};

/** Commit a planned issue: relieve the picked lots + placements, write movements, refresh cache. */
export async function commitIssue(orgId: string, c: IssueCommit): Promise<void> {
  for (const p of c.plan.picks) {
    let fromLocationId = p.locationId;

    if (p.lotId) {
      // Guarded decrement — never drive a lot negative if a concurrent write moved it.
      await db.update(inventoryLots).set({
        remainingQty: sql`greatest(${inventoryLots.remainingQty} - ${n4(p.qty)}, 0)`,
        status: sql`case when ${inventoryLots.remainingQty} - ${n4(p.qty)} <= 0 then 'Depleted' else 'Open' end`,
      }).where(and(eq(inventoryLots.id, p.lotId), eq(inventoryLots.orgId, orgId)));

      if (p.locationId) {
        // The lot's balance has already gone down, so the placement MUST come
        // down by the same amount or the two disagree. The plan was read moments
        // ago and a concurrent issue may have emptied the row since — so take
        // what is there, then spill the rest across the lot's other placements
        // rather than leaving the difference stranded.
        const taken = await takeQty(orgId, p.lotId, p.locationId, p.qty);
        const short = Math.round((p.qty - taken) * 1e4) / 1e4;
        if (short > 0) {
          const spilled = await spillTake(orgId, p.lotId, short, p.locationId);
          if (spilled < short) {
            // Genuinely unplaceable: the lot's placements no longer cover its
            // balance. Loud, because the reconciliation check will report the
            // drift later and this line is what explains how it got there.
            console.error(
              `[inventory] placement shortfall: lot=${p.lotId} location=${p.locationId} ` +
              `wanted=${p.qty} taken=${taken} spilled=${spilled} ref=${c.refType}:${c.refId}`,
            );
          }
        }
      }
    } else {
      fromLocationId = null;   // shortfall pick — nothing physically left anywhere
    }

    await db.insert(inventoryMovements).values({
      orgId, itemId: c.itemId, skuId: c.skuId ?? null, lotId: p.lotId, movementType: c.movementType,
      qty: n4(-p.qty), unitCost: n6(p.unitCost), totalCost: n4(-(p.qty * p.unitCost)),
      fromLocationId: fromLocationId ?? null,
      refType: c.refType, refId: c.refId, entryId: c.entryId ?? null,
      movementDate: c.date, note: p.lotId ? c.note ?? null : (c.note ? `${c.note} (no stock — costed at fallback)` : "No stock on hand — costed at fallback"),
      createdBy: c.createdBy ?? null,
    } as any);
  }
  await recalcItemCache(orgId, c.itemId);
}

/**
 * Take `qty` from a lot's placements other than `exceptLocationId`, in
 * location-code order. Used only to absorb a concurrent-write shortfall in
 * commitIssue. Returns how much it managed to take.
 */
async function spillTake(orgId: string, lotId: string, qty: number, exceptLocationId: string): Promise<number> {
  const placements = (await placementsForLots(orgId, [lotId])).get(lotId) ?? [];
  let need = qty, got = 0;
  for (const p of placements) {
    if (need <= 0) break;
    if (p.locationId === exceptLocationId) continue;
    const taken = await takeQty(orgId, lotId, p.locationId, Math.min(p.qty, need));
    got += taken; need -= taken;
  }
  return Math.round(got * 1e4) / 1e4;
}

/**
 * Reverse all inventory movements a document created (by entry id) — for
 * delete / reverse / edit-then-reapply. Restores issued lots and removes receipt
 * lots. Refuses when a receipt lot has already been partly sold/consumed
 * downstream (its cost can't be cleanly unwound — reverse the later doc first).
 */
export async function reverseInventoryByEntry(orgId: string, entryId: string): Promise<void> {
  // Match by entryId OR refId: a zero-cost receipt/shipment/build posts no GL
  // entry, so its movements carry entryId=null and refId=<event id>. The caller
  // passes entryId ?? <event id>, so keying on either finds them.
  const moves = await db.select().from(inventoryMovements)
    .where(and(eq(inventoryMovements.orgId, orgId), or(eq(inventoryMovements.entryId, entryId), eq(inventoryMovements.refId, entryId))));
  if (!moves.length) return;

  const affected = new Set<string>();
  // 1. Guard receipt/produce lots that have already been drawn down.
  const receiptLotIds = moves.filter(m => (m.movementType === "receipt" || m.movementType === "produce") && m.lotId).map(m => m.lotId!) as string[];
  if (receiptLotIds.length) {
    const lots = await db.select().from(inventoryLots)
      .where(and(eq(inventoryLots.orgId, orgId), inArray(inventoryLots.id, receiptLotIds)));
    for (const lot of lots) {
      if (num(lot.remainingQty) < num(lot.origQty)) {
        throw new Error("Inventory received/produced by this document has already been sold or consumed. Reverse the later transaction(s) first.");
      }
    }
  }

  // 2. Undo each movement.
  for (const m of moves) {
    affected.add(m.itemId);
    const isReceiptish = m.movementType === "receipt" || m.movementType === "produce" || m.movementType === "jobwork_receipt";

    if (isReceiptish && m.lotId) {
      // Deleting the lot takes its placement rows with it — the FK on
      // inventory_lot_locations.lot_id is ON DELETE CASCADE precisely so a
      // voided receipt cannot leave an orphaned placement behind for the
      // reconciliation check to find.
      await db.delete(inventoryLots).where(and(eq(inventoryLots.id, m.lotId), eq(inventoryLots.orgId, orgId)));
    } else if (m.movementType === "transfer" && m.lotId) {
      // A transfer changed no balance, only where it sits: put it back.
      const moved = Math.abs(num(m.qty));
      if (m.toLocationId) await takeQty(orgId, m.lotId, m.toLocationId, moved);
      if (m.fromLocationId) await placeQty(orgId, m.lotId, m.fromLocationId, moved);
    } else if (m.lotId) {
      // Issue — put the qty back on the lot, reopen it, and return it to the
      // location it left from.
      const back = Math.abs(num(m.qty));
      await db.update(inventoryLots).set({
        remainingQty: sql`${inventoryLots.remainingQty} + ${n4(back)}`, status: "Open",
      }).where(and(eq(inventoryLots.id, m.lotId), eq(inventoryLots.orgId, orgId)));

      // Movements written before locations existed carry no from_location_id
      // (migration 0087 deliberately did not invent one). The lot's balance has
      // just gone UP, so a placement must go up with it or the invariant breaks
      // — the org default is the only defensible destination, and a placement
      // that is merely imprecise is better than stock the system cannot locate
      // at all.
      const restoreTo = m.fromLocationId ?? await ensureDefaultLocation(orgId);
      await placeQty(orgId, m.lotId, restoreTo, back);
    }
  }
  await db.delete(inventoryMovements).where(and(eq(inventoryMovements.orgId, orgId), or(eq(inventoryMovements.entryId, entryId), eq(inventoryMovements.refId, entryId))));
  for (const itemId of affected) await recalcItemCache(orgId, itemId);
}
