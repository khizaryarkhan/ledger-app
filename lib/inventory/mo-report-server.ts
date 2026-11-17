/**
 * Loads everything the MO report needs for ONE order, read-only. The report itself (rules + HTML) is pure and
 * lives in lib/inventory/mo-report.ts; this is only the database half, same split as modules / modules-server.
 */

import { db } from "@/db";
import {
  manufacturingOrders, moOutputs, moMaterials, moMaterialSubstitutes, moOperations, productionRuns, productionConsumptions,
  productionOutputs, inventoryLots, apItems, itemSkus, organisations, users, boms,
} from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { fmt } from "@/lib/format";
import { DELAY_REASONS, SCRAP_REASONS, reasonLabel } from "@/lib/inventory/production-performance";
import type { MoReportData, MoReportLot, MoReportMaterial, MoReportOperation, MoReportOutput, MoReportRun } from "@/lib/inventory/mo-report";

const num = (v: any) => Number(v ?? 0);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const fmtN = (n: number) => fmt.qty(n);

export async function loadMoReport(orgId: string, moId: string): Promise<MoReportData | null> {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, moId), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) return null;

  const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName, logoUrl: organisations.logoUrl })
    .from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const [product] = mo.outputItemId ? await db.select({ name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(eq(apItems.id, mo.outputItemId)).limit(1) : [null];
  const [bom] = mo.bomId ? await db.select({ code: boms.code, name: boms.name }).from(boms).where(and(eq(boms.id, mo.bomId), eq(boms.orgId, orgId))).limit(1) : [null];
  const [creator] = mo.createdBy ? await db.select({ name: users.name }).from(users).where(eq(users.id, mo.createdBy)).limit(1) : [null];

  const runs = await db.select().from(productionRuns).where(and(eq(productionRuns.orgId, orgId), eq(productionRuns.moId, moId))).orderBy(asc(productionRuns.createdAt));
  const runIds = runs.map(r => r.id);
  const runNoById = new Map(runs.map(r => [r.id, r.runNo]));

  const [outs, mats, subs, ops] = await Promise.all([
    db.select().from(moOutputs).where(and(eq(moOutputs.orgId, orgId), eq(moOutputs.moId, moId))),
    db.select().from(moMaterials).where(and(eq(moMaterials.orgId, orgId), eq(moMaterials.moId, moId))),
    db.select().from(moMaterialSubstitutes).where(and(eq(moMaterialSubstitutes.orgId, orgId), eq(moMaterialSubstitutes.moId, moId))),
    db.select().from(moOperations).where(and(eq(moOperations.orgId, orgId), eq(moOperations.moId, moId))).orderBy(asc(moOperations.sortOrder)),
  ]);
  const cons = runIds.length ? await db.select().from(productionConsumptions).where(and(eq(productionConsumptions.orgId, orgId), inArray(productionConsumptions.runId, runIds))) : [];
  const prodOuts = runIds.length ? await db.select().from(productionOutputs).where(and(eq(productionOutputs.orgId, orgId), inArray(productionOutputs.runId, runIds))) : [];

  const itemIds = [...new Set([...mats.map(m => m.itemId), ...subs.map(s => s.itemId), ...cons.map(c => c.itemId)])];
  const items = itemIds.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, itemIds))) : [];
  const item = new Map(items.map(i => [i.id, i]));
  const lotIds = [...new Set([...cons.map(c => c.lotId), ...prodOuts.map(o => o.lotId).filter(Boolean) as string[]])];
  const lots = lotIds.length ? await db.select().from(inventoryLots).where(and(eq(inventoryLots.orgId, orgId), inArray(inventoryLots.id, lotIds))) : [];
  const lot = new Map(lots.map(l => [l.id, l]));
  const skuIds = [...new Set(outs.map(o => o.skuId).filter(Boolean) as string[])];
  const skus = skuIds.length ? await db.select({ id: itemSkus.id, skuName: itemSkus.skuName, skuCode: itemSkus.skuCode }).from(itemSkus).where(inArray(itemSkus.id, skuIds)) : [];
  const sku = new Map(skus.map(s => [s.id, s]));

  const baseUom = product?.baseUom ?? "";
  const packLabel = (skuId: string | null) => {
    const s = skuId ? sku.get(skuId) : null;
    return s ? `${s.skuName ?? product?.name ?? "Pack"}${s.skuCode ? ` [${s.skuCode}]` : ""}` : `${product?.name ?? "Item"} (base unit)`;
  };
  const outputs: MoReportOutput[] = outs.map(o => {
    const made = prodOuts.filter(p => (p.skuId ?? null) === (o.skuId ?? null));
    const amount = made.reduce((s, p) => s + num(p.amount), 0);
    const base = made.reduce((s, p) => s + num(p.qtyBase), 0);
    const outLots = made.map(p => (p.lotId ? lot.get(p.lotId) : null)).filter(Boolean) as (typeof lots)[number][];
    const first = outLots[0];
    const s = o.skuId ? sku.get(o.skuId) : null;
    return {
      label: packLabel(o.skuId ?? null),
      plannedPacks: num(o.qty), producedPacks: num(o.completedQty), unitContent: num(o.unitContent) || 1, baseUom,
      lotNo: outLots.length ? [...new Set(outLots.map(l => l.lotNo).filter(Boolean))].join(", ") || null : null,
      bestBefore: first?.bestBeforeDate ?? null, expiryDate: first?.expiryDate ?? null,
      cost: amount, unitCost: base > 0 ? amount / base : 0,
    };
  });

  // One row per planned material. Where a substitute stood in for it, the row IS the substitute (its own
  // planned amount and unit), so the variance compares like with like instead of reading -100% against an
  // ingredient that was deliberately not used.
  const planned = new Map<string, { kind: "ingredient" | "packaging"; planned: number; forPack: string | null }>();
  // A packaging item belongs to ONE pack only when exactly one pack names it; consumptions carry no pack, so an item
  // serving several packs stays one shared row rather than being split by a guess.
  const packsOf = new Map<string, Set<string>>();
  for (const m of mats) if (m.kind === "packaging" && m.forSkuId) packsOf.set(m.itemId, (packsOf.get(m.itemId) ?? new Set()).add(m.forSkuId));
  for (const m of mats) {
    const cur = planned.get(m.itemId) ?? { kind: m.kind === "packaging" ? "packaging" as const : "ingredient" as const, planned: 0, forPack: null as string | null };
    cur.planned += num(m.plannedQty); if (m.kind === "ingredient") cur.kind = "ingredient";
    const ps = packsOf.get(m.itemId);
    if (cur.kind === "packaging" && ps?.size === 1) cur.forPack = packLabel([...ps][0]);
    planned.set(m.itemId, cur);
  }
  const materials: MoReportMaterial[] = [];
  for (const [itemId, p] of planned) {
    const own = cons.filter(c => c.itemId === itemId && !c.forItemId);
    const stoodIn = cons.filter(c => c.forItemId === itemId && c.itemId !== itemId);
    const name = item.get(itemId)?.name ?? "Item";
    if (stoodIn.length && !own.length) {
      for (const subId of new Set(stoodIn.map(c => c.itemId))) {
        const rows = stoodIn.filter(c => c.itemId === subId);
        const sp = subs.find(s => s.primaryItemId === itemId && s.itemId === subId);
        materials.push({ name: `${item.get(subId)?.name ?? "Item"} (in place of ${name})`, kind: p.kind, uom: item.get(subId)?.baseUom ?? "", planned: num(sp?.plannedQty), used: rows.reduce((s, c) => s + num(c.qty), 0), cost: rows.reduce((s, c) => s + num(c.totalCost), 0), substitutes: [], forPack: p.forPack });
      }
    } else {
      materials.push({ name, kind: p.kind, uom: item.get(itemId)?.baseUom ?? "", planned: p.planned, used: own.reduce((s, c) => s + num(c.qty), 0), cost: own.reduce((s, c) => s + num(c.totalCost), 0), substitutes: [], forPack: p.forPack });
    }
  }

  const lotRows: MoReportLot[] = cons.map(c => {
    const l = lot.get(c.lotId);
    return {
      itemName: item.get(c.itemId)?.name ?? "Item", lotNo: l?.lotNo ?? null, supplierBatchNo: l?.supplierBatchNo ?? null, expiryDate: l?.expiryDate ?? null,
      qty: num(c.qty), uom: item.get(c.itemId)?.baseUom ?? "", unitCost: num(c.unitCost), cost: num(c.totalCost),
      standsInFor: c.forItemId && c.forItemId !== c.itemId ? item.get(c.forItemId)?.name ?? null : null, runNo: runNoById.get(c.runId) ?? null,
    };
  });

  // Actual hours per operation come from the runs' own record; an order with none typed reads "not recorded".
  const actualByOp = new Map<string, number>();
  for (const r of runs) for (const h of ((r.operationHours as any[]) ?? [])) {
    if (h?.operationId) actualByOp.set(h.operationId, (actualByOp.get(h.operationId) ?? 0) + num(h.hours));
  }
  const operations: MoReportOperation[] = ops.map(o => ({
    name: o.name, plannedHours: num(o.plannedHours), actualHours: actualByOp.has(o.id) ? actualByOp.get(o.id)! : null,
    plannedCost: num(o.plannedHours) * (num(o.labourRate) + num(o.overheadRate)),
  }));

  const packsOfRun = (runId: string) => {
    const bySku = new Map<string, number>();
    for (const p of prodOuts.filter(x => x.runId === runId)) bySku.set(p.skuId ?? "", (bySku.get(p.skuId ?? "") ?? 0) + num(p.qtyPacks));
    return [...bySku].map(([k, n]) => `${fmtN(n)} × ${packLabel(k || null)}`).join(", ");
  };
  const runRows: MoReportRun[] = runs.map(r => ({
    packs: packsOfRun(r.id),
    runNo: r.runNo, date: r.producedDate, good: num(r.goodQty), rejected: num(r.rejectedQty),
    materialCost: num(r.totalInputCost) - num(r.labourCost) - num(r.overheadCost), labourCost: num(r.labourCost), overheadCost: num(r.overheadCost), scrapCost: num(r.scrapCost),
    rejectReason: r.rejectReason ? reasonLabel(SCRAP_REASONS, r.rejectReason) : null,
  }));

  return {
    orgName: org?.displayName || org?.name || "Your Company", logoUrl: org?.logoUrl ?? null,
    mo: {
      moNo: mo.moNo ?? "—", status: mo.status, productName: product?.name ?? "—", bomCode: bom?.code ?? null, bomName: bom?.name ?? null, baseUom, priority: mo.priority,
      scheduledDate: mo.scheduledDate, dueDate: mo.dueDate, originalDueDate: mo.originalDueDate, rescheduleCount: mo.rescheduleCount,
      delayReason: mo.delayReason ? reasonLabel(DELAY_REASONS, mo.delayReason) : null, delayNote: mo.delayNote,
      startedAt: iso(mo.startedAt), completedAt: iso(mo.completedAt), createdBy: creator?.name ?? null, notes: mo.notes, expYield: mo.expYield != null ? num(mo.expYield) : null,
    },
    outputs, materials, lots: lotRows, operations, runs: runRows,
  };
}
