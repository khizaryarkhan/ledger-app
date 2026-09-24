/**
 * GET /api/inventory/reports?type=valuation|status|lots
 *
 *  valuation → per tracked item: on-hand qty, avg cost, total inventory value
 *  status    → per tracked item: on-hand vs minimum reorder qty (+ below-min flag)
 *  lots      → every open FIFO cost lot with its item, remaining qty, cost & value
 */

import { roundQty, QTY_EPSILON} from "@/lib/inventory/round";
import { db } from "@/db";
import { apItems, inventoryLots, tradeDocuments, tradeDocumentLines, itemSkus, inventoryLotLocations, stockLocations, manufacturingOrders, lotAllocations } from "@/db/schema";
import { requireReadScope, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, asc, inArray } from "drizzle-orm";
import { kindOf } from "@/lib/inventory/item-kinds";

const num = (v: any) => Number(v ?? 0);

/** Open-order remaining qty per item (base UoM), for a PO or SO. */
/**
 * Manufacturing orders: an open MO's output is EXPECTED stock (it will arrive
 * when the order completes), and lots allocated to an MO in progress are on
 * hand but spoken for — so they count against availability, not on-hand.
 */
async function moExpectedAndAllocated(orgIds: string[]) {
  const expected = new Map<string, number>(), allocated = new Map<string, number>();
  const mos = await db.select({ itemId: manufacturingOrders.outputItemId, qty: manufacturingOrders.qty })
    .from(manufacturingOrders)
    .where(and(inArray(manufacturingOrders.orgId, orgIds), inArray(manufacturingOrders.status, ["Scheduled", "Released", "InProgress"])));
  for (const m of mos) if (m.itemId) expected.set(m.itemId, (expected.get(m.itemId) ?? 0) + num(m.qty));
  const al = await db.select({ itemId: lotAllocations.itemId, qty: lotAllocations.qty }).from(lotAllocations).where(inArray(lotAllocations.orgId, orgIds));
  for (const a of al) allocated.set(a.itemId, (allocated.get(a.itemId) ?? 0) + num(a.qty));
  return { expected, allocated };
}

async function openOrderQtyByItem(orgIds: string[], kind: "PurchaseOrder" | "SalesOrder"): Promise<Map<string, number>> {
  const docs = await db.select({ id: tradeDocuments.id }).from(tradeDocuments)
    .where(and(inArray(tradeDocuments.orgId, orgIds), eq(tradeDocuments.kind, kind)));
  const map = new Map<string, number>();
  if (!docs.length) return map;
  const lines = await db.select().from(tradeDocumentLines).where(inArray(tradeDocumentLines.documentId, docs.map(p => p.id)));
  for (const l of lines) {
    if (!l.itemId) continue;
    const ordered = num(l.orderedBaseQty) || num(l.qty) * num(l.unitsPerOrderUnit || 1);
    const remaining = ordered - num(l.receivedQty); // receivedQty = received (PO) / shipped (SO)
    if (remaining > QTY_EPSILON) map.set(l.itemId, (map.get(l.itemId) ?? 0) + remaining);
  }
  return map;
}

/**
 * Where each item's stock physically sits, keyed by item id.
 *
 * One query for the whole org rather than one per item: Stock Status lists
 * every tracked item, and a per-item round trip would be a query storm on a
 * catalogue of any size.
 */
async function placementsByItem(orgIds: string[]) {
  const rows = await db.select({
    itemId: inventoryLots.itemId,
    locationId: stockLocations.id,
    code: stockLocations.code,
    name: stockLocations.name,
    type: stockLocations.type,
    qty: inventoryLotLocations.qty,
  })
    .from(inventoryLotLocations)
    .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryLotLocations.lotId))
    .innerJoin(stockLocations, eq(stockLocations.id, inventoryLotLocations.locationId))
    .where(inArray(inventoryLotLocations.orgId, orgIds))
    .orderBy(asc(stockLocations.code));

  const map = new Map<string, { locationId: string; code: string; name: string; type: string; qty: number }[]>();
  for (const r of rows) {
    const q = num(r.qty);
    if (q <= 0) continue;
    const list = map.get(r.itemId) ?? [];
    const existing = list.find(l => l.locationId === r.locationId);
    if (existing) existing.qty = roundQty(existing.qty + q);
    else list.push({ locationId: r.locationId, code: r.code, name: r.name, type: r.type, qty: roundQty(q) });
    map.set(r.itemId, list);
  }
  return map;
}

/** Where each LOT sits — same reasoning, one query for the lots report. */
async function placementsByLot(orgIds: string[]) {
  const rows = await db.select({
    lotId: inventoryLotLocations.lotId,
    code: stockLocations.code,
    name: stockLocations.name,
    qty: inventoryLotLocations.qty,
  })
    .from(inventoryLotLocations)
    .innerJoin(stockLocations, eq(stockLocations.id, inventoryLotLocations.locationId))
    .where(inArray(inventoryLotLocations.orgId, orgIds))
    .orderBy(asc(stockLocations.code));

  const map = new Map<string, { code: string; name: string; qty: number }[]>();
  for (const r of rows) {
    const q = num(r.qty);
    if (q <= 0) continue;
    const list = map.get(r.lotId) ?? [];
    list.push({ code: r.code, name: r.name, qty: roundQty(q) });
    map.set(r.lotId, list);
  }
  return map;
}

export async function GET(req: Request) {
  const { error, orgId, orgIds } = await requireReadScope();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const type = new URL(req.url).searchParams.get("type") || "valuation";

  const items = await db.select().from(apItems).where(inArray(apItems.orgId, orgIds!)).orderBy(asc(apItems.name));
  const tracked = items.filter(i => kindOf(i.productType).tracked);

  if (type === "status") {
    const expected = await openOrderQtyByItem(orgIds!, "PurchaseOrder");
    const committed = await openOrderQtyByItem(orgIds!, "SalesOrder");
    const mo = await moExpectedAndAllocated(orgIds!);
    const placements = await placementsByItem(orgIds!);
    return ok(tracked.map(i => {
      const onHand = num(i.onHandQty), min = num(i.minOhQty);
      const exp = (expected.get(i.id) ?? 0) + (mo.expected.get(i.id) ?? 0);
      const com = committed.get(i.id) ?? 0, alloc = mo.allocated.get(i.id) ?? 0;
      const available = onHand + exp - com - alloc;
      return {
        id: i.id, name: i.name, code: i.code, category: i.category, baseUom: i.baseUom, productType: i.productType,
        onHandQty: onHand, expectedQty: roundQty(exp), committedQty: roundQty(com), allocatedQty: roundQty(alloc),
        availableQty: roundQty(available), minOhQty: min,
        belowMin: min > 0 && available < min, out: onHand <= 0,
        // Where the on-hand quantity actually is. Empty for an org with no
        // locations yet, and for stock whose placement rows do not cover its
        // lot balance — reconcile.ts reports that drift rather than this report
        // inventing a place for it.
        byLocation: placements.get(i.id) ?? [],
      };
    }));
  }

  if (type === "lots") {
    const ids = tracked.map(i => i.id);
    const nameById = new Map(tracked.map(i => [i.id, { name: i.name, code: i.code, baseUom: i.baseUom }]));
    const lots = ids.length
      ? await db.select().from(inventoryLots)
          .where(and(inArray(inventoryLots.orgId, orgIds!), eq(inventoryLots.status, "Open")))
          .orderBy(asc(inventoryLots.itemId), asc(inventoryLots.receivedDate), asc(inventoryLots.createdAt))
      : [];
    const skuIds = [...new Set(lots.map(l => l.skuId).filter(Boolean) as string[])];
    const skuRows = skuIds.length ? await db.select({ id: itemSkus.id, name: itemSkus.skuName, size: itemSkus.innerUnitPackSize, packType: itemSkus.innerPackType }).from(itemSkus).where(inArray(itemSkus.id, skuIds)) : [];
    const skuById = new Map(skuRows.map(s => [s.id, s]));
    const lotPlacements = await placementsByLot(orgIds!);
    return ok(lots.filter(l => nameById.has(l.itemId)).map(l => {
      const meta = nameById.get(l.itemId)!;
      const sku = l.skuId ? skuById.get(l.skuId) : null;
      const rem = num(l.remainingQty), cost = num(l.unitCost);
      const packSize = sku ? num(sku.size) : 0;
      return {
        id: l.id, itemId: l.itemId, itemName: meta.name, itemCode: meta.code, baseUom: meta.baseUom,
        skuName: sku?.name ?? null, packs: packSize > 0 ? roundQty(rem / packSize) : null, packType: sku?.packType ?? null,
        lotNo: l.lotNo, sourceType: l.sourceType, receivedDate: l.receivedDate, expiryDate: l.expiryDate,
        remainingQty: rem, unitCost: cost, value: Math.round(rem * cost * 100) / 100,
        locations: lotPlacements.get(l.id) ?? [],
      };
    }));
  }

  // valuation (default)
  let grand = 0;
  const rows = tracked.map(i => {
    const onHand = num(i.onHandQty), value = num(i.invValue);
    grand += value;
    return {
      id: i.id, name: i.name, code: i.code, category: i.category, baseUom: i.baseUom, productType: i.productType,
      onHandQty: onHand, avgCost: onHand !== 0 ? Math.round((value / onHand) * 1e6) / 1e6 : 0, value: Math.round(value * 100) / 100,
    };
  });
  return ok({ rows, total: Math.round(grand * 100) / 100 });
}
