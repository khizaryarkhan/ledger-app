/**
 * Lot allocation for manufacturing orders — server side. The rules are pure,
 * in lib/inventory/allocation.ts; this file reads and writes them.
 *
 * An allocation reserves a QUANTITY of a lot for one MO while it is In
 * Progress. No accounting entry is made — the stock stays in its lot and its
 * stock account — but planIssue (valuation.ts) refuses it to every other
 * issue. Completion consumes exactly these quantities.
 *
 * Ingredient substitutes and supplier-SKU limits (BOM Builder phase 2) are read from
 * the MO's OWN copy, taken when the order was planned. A material is made from ONE
 * source — its main item or one substitute, never a mix — and a substitute is only
 * proposed here: a planner chooses it by allocating its lots.
 *
 * neon-http has no transactions: every request is validated in full first,
 * then the material's allocations are replaced in one delete + one insert.
 */

import { db } from "@/db";
import { lotAllocations, inventoryLots, manufacturingOrders, stockLocations, apItems, itemSkus, itemSupplierSkus, moMaterialSubstitutes, moMaterialAllowedSkus } from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { LedgerValidationError } from "@/lib/ledger";
import { roundQty } from "@/lib/inventory/round";
import { ensureMoMaterials } from "@/lib/inventory/manufacturing-orders";
import { allocatedByLot } from "@/lib/inventory/valuation";
import { placementsForLots } from "@/lib/inventory/locations";
import { consumptionUnits } from "@/lib/inventory/order-options";
import {
  allocationError, availableInLot, fefoOrder, suggestPicks, lotsAllowedBySku, proposeSubstitute, substituteConflict,
  type AllocatableLot,
} from "@/lib/inventory/allocation";

const err = (m: string): never => { throw new LedgerValidationError(m); };
const num = (v: any) => Number(v ?? 0);

async function loadMo(orgId: string, moId: string) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, moId), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) err("MO not found.");
  return mo!;
}

type MoLot = AllocatableLot & { mine: number; where: string[]; supplierId: string | null; skuId: string | null; supplierSkuId: string | null };

/** Open lots of an item, with what THIS order may take from each. */
async function lotsFor(orgId: string, itemId: string, moId: string): Promise<MoLot[]> {
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
    mine: mine.get(l.id) ?? 0, supplierId: l.supplierId ?? null, skuId: l.skuId ?? null, supplierSkuId: l.supplierSkuId ?? null,
    where: (placements.get(l.id) ?? []).filter(p => p.qty > 0).map(p => codes.get(p.locationId) ?? "?"),
  }))).filter(l => l.remainingQty > 0);
}

/** The order's frozen substitutes and supplier-SKU limits. */
async function loadFamily(orgId: string, moId: string) {
  const [subs, limits] = await Promise.all([
    db.select().from(moMaterialSubstitutes).where(and(eq(moMaterialSubstitutes.orgId, orgId), eq(moMaterialSubstitutes.moId, moId))).orderBy(asc(moMaterialSubstitutes.sortOrder)),
    db.select().from(moMaterialAllowedSkus).where(and(eq(moMaterialAllowedSkus.orgId, orgId), eq(moMaterialAllowedSkus.moId, moId))),
  ]);
  const subsOf = (primary: string) => subs.filter(s => s.primaryItemId === primary);
  const limitFor = (primary: string, item: string) => limits.filter(l => l.primaryItemId === primary && l.itemId === item).map(l => l.supplierSkuId);
  return { subs, subsOf, limitFor };
}

const refusalText = (lotNo: string | null, reason: "unknown" | "other") => reason === "unknown"
  ? `Lot ${lotNo ?? ""} has no supplier SKU on record, and this ingredient is limited to specific supplier SKUs. Clear the limit on the BOM, or record the lot's SKU.`
  : `Lot ${lotNo ?? ""} is a supplier SKU this ingredient is not limited to.`;

/** Per material: its lots (FEFO), what is allocated, a suggestion, its substitutes, and a proposal when short. */
export async function allocationView(orgId: string, moId: string) {
  const mo = await loadMo(orgId, moId);
  const mats = await ensureMoMaterials(orgId, mo);
  const fam = await loadFamily(orgId, moId);
  // Pack configurations, so the floor can count a lot in the unit it is
  // physically handling ("3 bags") rather than converting to kg by hand.
  // One query per table for every material, not one per lot.
  const itemIds = [...new Set([...mats.map(m => m.itemId), ...fam.subs.map(s => s.itemId)])];
  const [items, supSkus, ownSkus] = itemIds.length ? await Promise.all([
    db.select({ id: apItems.id, name: apItems.name, code: apItems.code, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, itemIds))),
    db.select().from(itemSupplierSkus).where(and(eq(itemSupplierSkus.orgId, orgId), inArray(itemSupplierSkus.itemId, itemIds))),
    db.select().from(itemSkus).where(and(eq(itemSkus.orgId, orgId), inArray(itemSkus.itemId, itemIds))),
  ]) : [[], [], []];
  const itemById = new Map(items.map(i => [i.id, i]));

  /** One source of a material (the item itself or a substitute): allowed lots, allocation, suggestion. */
  const source = async (primary: string, itemId: string, planned: number) => {
    const { allowed, refused } = lotsAllowedBySku(await lotsFor(orgId, itemId, moId), fam.limitFor(primary, itemId));
    const base = itemById.get(itemId)?.baseUom ?? null;
    return {
      allocated: roundQty(allowed.reduce((s, l) => s + l.mine, 0)),
      available: roundQty(allowed.reduce((s, l) => s + availableInLot(l), 0)),
      limitSkuIds: fam.limitFor(primary, itemId),
      refused: refused.map(r => ({ lotId: r.lot.id, lotNo: r.lot.lotNo, reason: r.reason, message: refusalText(r.lot.lotNo, r.reason) })),
      lots: allowed.map(l => ({ lotId: l.id, lotNo: l.lotNo, expiryDate: l.expiryDate, receivedDate: l.receivedDate, unitCost: l.unitCost,
        remaining: l.remainingQty, allocatedElsewhere: roundQty(l.allocatedElsewhere), available: availableInLot(l), mine: l.mine, where: l.where,
        units: consumptionUnits(base, l, supSkus.filter(x => x.itemId === itemId), ownSkus.filter(x => x.itemId === itemId))
          .map(u => ({ label: u.label, packLevel: u.packLevel, uom: u.orderUom, perUnit: u.unitsPerOrderUnit })) })),
      // The whole planned quantity, FEFO — the UI pre-fills from this only when nothing has been chosen yet.
      suggestion: suggestPicks(allowed, planned),
    };
  };

  const out = [];
  for (const m of mats) {
    const planned = num(m.plannedQty);
    const main = await source(m.itemId, m.itemId, planned);
    const substitutes = [];
    for (const s of fam.subsOf(m.itemId)) {
      const sp = num(s.plannedQty), info = itemById.get(s.itemId);
      substitutes.push({ itemId: s.itemId, name: info?.name ?? "Item", code: info?.code ?? null, baseUom: info?.baseUom ?? null, order: substitutes.length + 1, planned: sp, ...(await source(m.itemId, s.itemId, sp)) });
    }
    const using = substitutes.find(s => s.allocated > 0)?.itemId ?? null;
    // Only ever a PROPOSAL, and only while nothing is chosen: a planner accepts it by allocating its lots.
    const proposal = main.allocated > 0 || using ? null
      : proposeSubstitute({ planned, primaryAvailable: main.available, subs: substitutes.map(s => ({ itemId: s.itemId, planned: s.planned, available: s.available })) });
    out.push({ itemId: m.itemId, kind: m.kind, planned, ...main, substitutes, usingSubstitute: using, proposal });
  }
  return { status: mo.status, materials: out };
}

/**
 * Replace one source's allocations for an MO. `itemId` is a material of the order or
 * one of that material's substitutes. Only while In Progress — the stage at which
 * production is working the order. An empty list releases it.
 */
export async function setMaterialAllocation(orgId: string, moId: string, itemId: string, picks: { lotId: string; qty: number; suggested?: boolean }[], actorId: string | null) {
  const mo = await loadMo(orgId, moId);
  if (mo.status !== "InProgress") err("Lots can be allocated only while the order is In Progress. Start it first.");
  const mats = await ensureMoMaterials(orgId, mo);
  const fam = await loadFamily(orgId, moId);

  let primary = mats.find(m => m.itemId === itemId)?.itemId ?? null, forItemId: string | null = null;
  if (!primary) {
    const sub = fam.subs.find(s => s.itemId === itemId);
    if (!sub) err("That item is not a material of this order or one of its substitutes.");
    primary = sub!.primaryItemId; forItemId = primary;
  }
  const clean = (picks ?? []).map(p => ({ lotId: String(p.lotId), qty: roundQty(Number(p.qty) || 0), suggested: !!p.suggested })).filter(p => p.qty > 0);

  if (clean.length) {
    const family = [primary!, ...fam.subsOf(primary!).map(s => s.itemId)];
    const held = await db.select({ itemId: lotAllocations.itemId }).from(lotAllocations)
      .where(and(eq(lotAllocations.orgId, orgId), eq(lotAllocations.moId, moId), inArray(lotAllocations.itemId, family)));
    const why = substituteConflict({ target: itemId, primary: primary!, substituteIds: fam.subsOf(primary!).map(s => s.itemId), allocatedItemIds: [...new Set(held.map(h => h.itemId))] });
    if (why) err(why);
  }

  const { allowed, refused } = lotsAllowedBySku(await lotsFor(orgId, itemId, moId), fam.limitFor(primary!, itemId));
  for (const p of clean) {
    const r = refused.find(x => x.lot.id === p.lotId);
    if (r) err(refusalText(r.lot.lotNo, r.reason));
  }
  const why = allocationError(clean, new Map(allowed.map(l => [l.id, l])));
  if (why) err(why);

  await db.delete(lotAllocations).where(and(eq(lotAllocations.orgId, orgId), eq(lotAllocations.moId, moId), eq(lotAllocations.itemId, itemId)));
  if (clean.length) {
    await db.insert(lotAllocations).values(clean.map(p => ({
      orgId, moId, itemId, forItemId, lotId: p.lotId, qty: p.qty.toString(), suggested: p.suggested, allocatedBy: actorId,
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
