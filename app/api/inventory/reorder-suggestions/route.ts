/**
 * GET /api/inventory/reorder-suggestions
 *
 * Tracked, purchasable items whose available stock (on hand + expected -
 * committed) is below their minimum on-hand, grouped by preferred supplier.
 * Rules live in lib/inventory/reorder.ts; this route only gathers the inputs.
 *
 * Expected  = open PO lines (not closed, PO not closed/rejected) + open MO output
 * Committed = open SO lines + lots allocated to manufacturing orders
 * (the same inputs Stock Status uses, minus closed PO lines, which are no
 * longer expected).
 */

import { db } from "@/db";
import {
  apItems, tradeDocuments, tradeDocumentLines, itemSupplierSkus, parties,
  manufacturingOrders, lotAllocations,
} from "@/db/schema";
import { requireReadScope, ok } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, inArray } from "drizzle-orm";
import { kindOf, itemCanBePurchased } from "@/lib/inventory/item-kinds";
import { QTY_EPSILON, roundQty, round2 } from "@/lib/inventory/round";
import {
  computeReorder, compareUrgency, pickPreferredLink,
  type ReorderSupplierInfo, type ReorderUrgency,
} from "@/lib/inventory/reorder";

const num = (v: unknown) => Number(v ?? 0);
const PO_DEAD = new Set(["Closed", "Cancelled", "Converted"]);

async function openLineQtyByItem(orgIds: string[], kind: "PurchaseOrder" | "SalesOrder"): Promise<Map<string, number>> {
  const docs = await db.select({ id: tradeDocuments.id, status: tradeDocuments.status, rejectedAt: tradeDocuments.rejectedAt })
    .from(tradeDocuments)
    .where(and(inArray(tradeDocuments.orgId, orgIds), eq(tradeDocuments.kind, kind)));
  const live = docs.filter((d) => !PO_DEAD.has(d.status) && !d.rejectedAt);
  const map = new Map<string, number>();
  if (!live.length) return map;
  const lines = await db.select().from(tradeDocumentLines).where(inArray(tradeDocumentLines.documentId, live.map((d) => d.id)));
  for (const l of lines) {
    if (!l.itemId || l.closed) continue;
    const ordered = num(l.orderedBaseQty) || num(l.qty) * num(l.unitsPerOrderUnit || 1);
    const remaining = ordered - num(l.receivedQty); // received (PO) / shipped (SO)
    if (remaining > QTY_EPSILON) map.set(l.itemId, (map.get(l.itemId) ?? 0) + remaining);
  }
  return map;
}

async function moQtyByItem(orgIds: string[]) {
  const expected = new Map<string, number>(), allocated = new Map<string, number>();
  const mos = await db.select({ itemId: manufacturingOrders.outputItemId, qty: manufacturingOrders.qty })
    .from(manufacturingOrders)
    .where(and(inArray(manufacturingOrders.orgId, orgIds), inArray(manufacturingOrders.status, ["Scheduled", "Released", "InProgress"])));
  for (const m of mos) if (m.itemId) expected.set(m.itemId, (expected.get(m.itemId) ?? 0) + num(m.qty));
  const al = await db.select({ itemId: lotAllocations.itemId, qty: lotAllocations.qty })
    .from(lotAllocations).where(inArray(lotAllocations.orgId, orgIds));
  for (const a of al) allocated.set(a.itemId, (allocated.get(a.itemId) ?? 0) + num(a.qty));
  return { expected, allocated };
}

export async function GET() {
  const { error, orgId, orgIds } = await requireReadScope();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;

  const items = await db.select().from(apItems).where(inArray(apItems.orgId, orgIds!));
  const candidates = items.filter((i) => kindOf(i.productType).tracked && itemCanBePurchased(i));
  if (!candidates.length) return ok({ groups: [], totals: { items: 0, stockedOut: 0 } });

  const [poQty, soQty, mo] = await Promise.all([
    openLineQtyByItem(orgIds!, "PurchaseOrder"),
    openLineQtyByItem(orgIds!, "SalesOrder"),
    moQtyByItem(orgIds!),
  ]);

  const ids = candidates.map((i) => i.id);
  const links = await db.select().from(itemSupplierSkus).where(inArray(itemSupplierSkus.itemId, ids));
  const supplierIds = [...new Set(links.map((l) => l.supplierId))];
  const supRows = supplierIds.length
    ? await db.select({ id: parties.id, name: parties.name, leadTimeDays: parties.leadTimeDays })
        .from(parties).where(and(inArray(parties.orgId, orgIds!), inArray(parties.id, supplierIds)))
    : [];
  const supById = new Map(supRows.map((s) => [s.id, s]));
  const linksByItem = new Map<string, typeof links>();
  for (const l of links) {
    if (!supById.has(l.supplierId)) continue; // not this org's supplier (tenancy re-check)
    const list = linksByItem.get(l.itemId) ?? [];
    list.push(l);
    linksByItem.set(l.itemId, list);
  }

  type Row = {
    id: string; code: string | null; name: string; category: string | null; baseUom: string | null;
    onHand: number; expected: number; committed: number; available: number; minOh: number; shortfall: number;
    suggestedQty: number; moqBase: number | null; unitCostBase: number | null; estimatedCost: number | null;
    urgency: ReorderUrgency; leadTimeDays: number | null; currency: string | null;
  };
  type Group = {
    supplierId: string | null; supplierName: string; currency: string | null;
    rows: Row[]; totalCost: number; hasUnpriced: boolean;
  };
  const groups = new Map<string, Group>();

  for (const i of candidates) {
    const withName = (linksByItem.get(i.id) ?? []).map((l) => ({ ...l, supplierName: supById.get(l.supplierId)!.name }));
    const link = pickPreferredLink(withName);
    const sup = link ? supById.get(link.supplierId)! : null;
    const supplier: ReorderSupplierInfo | null = link && sup ? {
      supplierId: link.supplierId, supplierName: sup.name, currency: link.currency,
      minOrderQty: link.minOrderQty != null ? num(link.minOrderQty) : null,
      unitPrice: link.unitPrice != null ? num(link.unitPrice) : null,
      conversionFactor: link.conversionFactor != null ? num(link.conversionFactor) : null,
      leadTimeDays: link.leadTimeDays ?? sup.leadTimeDays ?? null,
    } : null;

    const expected = (poQty.get(i.id) ?? 0) + (mo.expected.get(i.id) ?? 0);
    const committed = (soQty.get(i.id) ?? 0) + (mo.allocated.get(i.id) ?? 0);
    const r = computeReorder({ onHand: num(i.onHandQty), expected, committed, minOh: num(i.minOhQty), supplier });
    if (!r.needsReorder) continue;

    const key = supplier?.supplierId ?? "none";
    const g = groups.get(key) ?? {
      supplierId: supplier?.supplierId ?? null,
      supplierName: supplier?.supplierName ?? "No supplier linked",
      currency: supplier?.currency ?? null, rows: [], totalCost: 0, hasUnpriced: false,
    };
    g.rows.push({
      id: i.id, code: i.code, name: i.name, category: i.category, baseUom: i.baseUom,
      onHand: num(i.onHandQty), expected: roundQty(expected), committed: roundQty(committed),
      available: r.available, minOh: num(i.minOhQty), shortfall: r.shortfall,
      suggestedQty: r.suggestedQty, moqBase: r.moqBase, unitCostBase: r.unitCostBase,
      estimatedCost: r.estimatedCost, urgency: r.urgency,
      leadTimeDays: supplier?.leadTimeDays ?? null, currency: supplier?.currency ?? null,
    });
    if (r.estimatedCost == null) g.hasUnpriced = true; else g.totalCost = round2(g.totalCost + r.estimatedCost);
    groups.set(key, g);
  }

  const out = [...groups.values()].map((g) => ({ ...g, rows: g.rows.sort(compareUrgency) }))
    .sort((a, b) => (a.supplierId === null ? 1 : 0) - (b.supplierId === null ? 1 : 0) || a.supplierName.localeCompare(b.supplierName));
  const all = out.flatMap((g) => g.rows);
  return ok({
    groups: out,
    totals: { items: all.length, stockedOut: all.filter((r) => r.urgency === "stocked_out").length },
  });
}
