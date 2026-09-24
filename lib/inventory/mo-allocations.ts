/**
 * Lot allocation for manufacturing orders — server side. The rules are pure,
 * in lib/inventory/allocation.ts; this file reads and writes them.
 *
 * An allocation reserves a QUANTITY of a lot for one MO while it is In
 * Progress. No accounting entry is made — the stock stays in its lot and its
 * stock account — but planIssue (valuation.ts) refuses it to every other
 * issue. Completion consumes exactly these quantities.
 *
 * neon-http has no transactions: every request is validated in full first,
 * then the material's allocations are replaced in one delete + one insert.
 */

import { db } from "@/db";
import { lotAllocations, inventoryLots, manufacturingOrders, stockLocations } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { LedgerValidationError } from "@/lib/ledger";
import { roundQty } from "@/lib/inventory/round";
import { ensureMoMaterials } from "@/lib/inventory/manufacturing-orders";
import { allocatedByLot } from "@/lib/inventory/valuation";
import { placementsForLots } from "@/lib/inventory/locations";
import { allocationError, availableInLot, fefoOrder, suggestPicks, type AllocatableLot } from "@/lib/inventory/allocation";

const err = (m: string): never => { throw new LedgerValidationError(m); };
const num = (v: any) => Number(v ?? 0);

async function loadMo(orgId: string, moId: string) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, moId), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) err("MO not found.");
  return mo!;
}

/** Open lots of an item, with what THIS order may take from each. */
async function lotsFor(orgId: string, itemId: string, moId: string): Promise<(AllocatableLot & { mine: number; where: string[] })[]> {
  const lots = await db.select().from(inventoryLots)
    .where(and(eq(inventoryLots.orgId, orgId), eq(inventoryLots.itemId, itemId), eq(inventoryLots.status, "Open")));
  if (!lots.length) return [];
  const ids = lots.map(l => l.id);
  const [elsewhere, all, placements] = await Promise.all([
    allocatedByLot(orgId, ids, moId),
    db.select({ lotId: lotAllocations.lotId, qty: lotAllocations.qty }).from(lotAllocations)
      .where(and(eq(lotAllocations.orgId, orgId), eq(lotAllocations.moId, moId), inArray(lotAllocations.lotId, ids))),
    placementsForLots(orgId, ids),
  ]);
  const mine = new Map(all.map(a => [a.lotId, num(a.qty)]));
  // Location codes, so the floor knows which shelf each lot is on.
  const locIds = [...new Set([...placements.values()].flat().map(p => p.locationId))];
  const codes = locIds.length ? new Map((await db.select({ id: stockLocations.id, code: stockLocations.code }).from(stockLocations)
    .where(and(eq(stockLocations.orgId, orgId), inArray(stockLocations.id, locIds)))).map(r => [r.id, r.code])) : new Map<string, string>();
  return fefoOrder(lots.map(l => ({
    id: l.id, lotNo: l.lotNo, remainingQty: num(l.remainingQty), allocatedElsewhere: elsewhere.get(l.id) ?? 0,
    expiryDate: l.expiryDate ?? null, receivedDate: l.receivedDate ?? null, unitCost: num(l.unitCost),
    mine: mine.get(l.id) ?? 0,
    where: (placements.get(l.id) ?? []).filter(p => p.qty > 0).map(p => codes.get(p.locationId) ?? "?"),
  }))).filter(l => l.remainingQty > 0);
}

/** Per material: its lots (FEFO), what is allocated, and a suggestion for the rest. */
export async function allocationView(orgId: string, moId: string) {
  const mo = await loadMo(orgId, moId);
  const mats = await ensureMoMaterials(orgId, mo);
  const out = [];
  for (const m of mats) {
    const lots = await lotsFor(orgId, m.itemId, moId);
    const planned = num(m.plannedQty);
    const allocated = roundQty(lots.reduce((s, l) => s + l.mine, 0));
    out.push({
      itemId: m.itemId, kind: m.kind, planned, allocated,
      lots: lots.map(l => ({ lotId: l.id, lotNo: l.lotNo, expiryDate: l.expiryDate, receivedDate: l.receivedDate, unitCost: l.unitCost,
        remaining: l.remainingQty, allocatedElsewhere: roundQty(l.allocatedElsewhere), available: availableInLot(l), mine: l.mine, where: l.where })),
      // The whole planned quantity, FEFO — the UI pre-fills from this only
      // when nothing has been chosen yet.
      suggestion: suggestPicks(lots, planned),
    });
  }
  return { status: mo.status, materials: out };
}

/**
 * Replace one material's allocations for an MO. Only while In Progress — the
 * stage at which production is working the order. An empty list releases it.
 */
export async function setMaterialAllocation(orgId: string, moId: string, itemId: string, picks: { lotId: string; qty: number; suggested?: boolean }[], actorId: string | null) {
  const mo = await loadMo(orgId, moId);
  if (mo.status !== "InProgress") err("Lots can be allocated only while the order is In Progress. Start it first.");
  const mats = await ensureMoMaterials(orgId, mo);
  if (!mats.some(m => m.itemId === itemId)) err("That item is not a material of this order.");
  const clean = (picks ?? []).map(p => ({ lotId: String(p.lotId), qty: roundQty(Number(p.qty) || 0), suggested: !!p.suggested })).filter(p => p.qty > 0);
  const lots = await lotsFor(orgId, itemId, moId);
  const why = allocationError(clean, new Map(lots.map(l => [l.id, l])));
  if (why) err(why);

  await db.delete(lotAllocations).where(and(eq(lotAllocations.orgId, orgId), eq(lotAllocations.moId, moId), eq(lotAllocations.itemId, itemId)));
  if (clean.length) {
    await db.insert(lotAllocations).values(clean.map(p => ({
      orgId, moId, itemId, lotId: p.lotId, qty: p.qty.toString(), suggested: p.suggested, allocatedBy: actorId,
    })));
  }
  return { itemId, allocated: roundQty(clean.reduce((s, p) => s + p.qty, 0)) };
}

/** Give back everything an order holds. */
export async function releaseAllocations(orgId: string, moId: string) {
  await loadMo(orgId, moId);
  await db.delete(lotAllocations).where(and(eq(lotAllocations.orgId, orgId), eq(lotAllocations.moId, moId)));
  return { moId, released: true };
}
