/**
 * Manufacturing Orders — plan, schedule & monitor production jobs. An MO moves
 * Draft → Scheduled → Released → In Progress → Completed (or Cancelled).
 *
 * Accounting (product owner, 2026-09-24): NOTHING posts until Completed.
 * Scheduled/Released show the output as expected stock; In Progress is where
 * production allocates the lots of every material (lib/inventory/allocation.ts
 * — reserved, not issued); Completed posts the one entry, consuming exactly
 * the allocated lots. The MO keeps its OWN copy of its materials (mo_materials),
 * taken from the BOM when the order is created, so a later BOM edit never
 * changes an order already planned.
 *
 * Multi-output: an MO carries a quantity PER output pack (mo_outputs). Material
 * planning derives the total base FP from the packs (× each pack's base content
 * on the BOM), scales the shared ingredients to it, and computes packaging per
 * pack — all vs on-hand. Completing runs buildProductionMulti (posts the GL &
 * moves stock, allocating cost per pack).
 */

import { roundQty } from "@/lib/inventory/round";
import { db } from "@/db";
import { manufacturingOrders, moOutputs, moMaterials, lotAllocations, boms, bomLines, apItems, itemSkus, inventoryLots } from "@/db/schema";
import { and, eq, asc, desc, inArray, sql } from "drizzle-orm";
import { kindOf } from "@/lib/inventory/item-kinds";
import { coverage } from "@/lib/inventory/allocation";
import { LedgerValidationError } from "@/lib/ledger";
import { nextDocNumber } from "@/lib/accounting/numbering";
import { buildProductionMulti } from "@/lib/inventory/production";

const err = (m: string): never => { throw new LedgerValidationError(m); };
const num = (v: any) => Number(v ?? 0);
const s = (v: any, n = 255) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));

export const MO_STATUSES = ["Draft", "Scheduled", "Released", "InProgress", "Completed", "Cancelled"] as const;
export type MoStatus = (typeof MO_STATUSES)[number];
const TRANSITIONS: Record<MoStatus, MoStatus[]> = {
  Draft: ["Scheduled", "Cancelled"],
  Scheduled: ["Released", "Draft", "Cancelled"],
  Released: ["InProgress", "Scheduled", "Cancelled"],
  InProgress: ["Completed", "Released", "Cancelled"],
  Completed: [],
  Cancelled: ["Draft"],
};

export async function listMOs(orgId: string) {
  const rows = await db.select().from(manufacturingOrders).where(eq(manufacturingOrders.orgId, orgId))
    .orderBy(asc(manufacturingOrders.scheduledDate), desc(manufacturingOrders.createdAt));
  const ids = [...new Set(rows.map(r => r.outputItemId).filter(Boolean) as string[])];
  const items = ids.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, ids))) : [];
  const byId = new Map(items.map(i => [i.id, i]));
  return rows.map(r => ({ ...r, qty: num(r.qty), outputItem: r.outputItemId ? byId.get(r.outputItemId) ?? null : null }));
}

/** Materials required to produce a set of output packs on a BOM, vs on-hand. */
export async function materialsForOutputs(orgId: string, bomId: string | null, outputs: { skuId: string; qty: number }[]) {
  const empty = { baseTotal: 0, lines: [] as any[], anyShort: false };
  if (!bomId || !outputs.length) return empty;
  const [bom] = await db.select().from(boms).where(and(eq(boms.id, bomId), eq(boms.orgId, orgId))).limit(1);
  if (!bom) return empty;
  const batch = num(bom.batchSize) || 1;
  const lines = await db.select().from(bomLines).where(and(eq(bomLines.orgId, orgId), eq(bomLines.bomId, bomId)));
  const outLines = lines.filter(l => l.role === "output");
  const inLines = lines.filter(l => l.role === "input");
  const packLines = lines.filter(l => l.role === "pack");
  const unitContent = new Map(outLines.map(l => [l.skuId, num(l.qty)]));

  const baseTotal = roundQty(outputs.reduce((sum, o) => sum + num(o.qty) * (unitContent.get(o.skuId) || 0), 0));
  const factor = batch > 0 ? baseTotal / batch : 0;

  const req = new Map<string, { qty: number; kind: "ingredient" | "packaging" }>();
  for (const l of inLines) { const cur = req.get(l.itemId) ?? { qty: 0, kind: "ingredient" as const }; cur.qty = roundQty(cur.qty + num(l.qty) * factor); req.set(l.itemId, cur); }
  for (const o of outputs) for (const p of packLines.filter(pl => pl.packagingForSkuId === o.skuId)) {
    const cur = req.get(p.itemId) ?? { qty: 0, kind: "packaging" as const }; cur.qty = roundQty(cur.qty + num(p.qty) * num(o.qty)); req.set(p.itemId, cur);
  }
  const ids = [...req.keys()];
  const items = ids.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom, onHand: apItems.onHandQty }).from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, ids))) : [];
  const byId = new Map(items.map(i => [i.id, i]));
  const outLinesList = ids.map(id => {
    const r = req.get(id)!; const it = byId.get(id); const onHand = num(it?.onHand);
    return { itemId: id, name: it?.name ?? "Item", baseUom: it?.baseUom ?? null, kind: r.kind, required: r.qty, onHand, short: roundQty(r.qty - onHand), ok: onHand + 1e-6 >= r.qty };
  });
  return { baseTotal, lines: outLinesList, anyShort: outLinesList.some(l => !l.ok) };
}

/** Read an MO's output packs (with SKU names + unit content from the BOM). */
async function outputsForMO(orgId: string, mo: any) {
  const rows = await db.select().from(moOutputs).where(and(eq(moOutputs.orgId, orgId), eq(moOutputs.moId, mo.id))).orderBy(asc(moOutputs.createdAt));
  const skuIds = rows.map(r => r.skuId).filter(Boolean) as string[];
  const skus = skuIds.length ? await db.select().from(itemSkus).where(inArray(itemSkus.id, skuIds)) : [];
  const skuById = new Map(skus.map(s2 => [s2.id, s2]));
  let unitContent = new Map<string, number>();
  if (mo.bomId) {
    const outLines = await db.select().from(bomLines).where(and(eq(bomLines.orgId, orgId), eq(bomLines.bomId, mo.bomId), eq(bomLines.role, "output")));
    unitContent = new Map(outLines.map(l => [l.skuId, num(l.qty)]));
  }
  return rows.map(r => {
    const sku = r.skuId ? skuById.get(r.skuId) : null;
    return { id: r.id, skuId: r.skuId, qty: num(r.qty), skuName: sku?.skuName ?? sku?.skuCode ?? null, unitContent: r.skuId ? (unitContent.get(r.skuId) || 0) : 0 };
  });
}

/**
 * The MO's own materials. Taken from the BOM on creation; an order created
 * before 0098 gets its copy the first time anyone looks, from the BOM as it is
 * then — which is the best available record of what it was planned with.
 */
export async function ensureMoMaterials(orgId: string, mo: { id: string; bomId: string | null; status: string }) {
  const rows = await db.select().from(moMaterials).where(and(eq(moMaterials.orgId, orgId), eq(moMaterials.moId, mo.id))).orderBy(asc(moMaterials.sortOrder));
  if (rows.length || mo.status === "Completed") return rows;
  const outputs = await outputsForMO(orgId, mo);
  await snapshotMaterials(orgId, mo.id, mo.bomId, outputs.map(o => ({ skuId: o.skuId!, qty: o.qty })));
  return db.select().from(moMaterials).where(and(eq(moMaterials.orgId, orgId), eq(moMaterials.moId, mo.id))).orderBy(asc(moMaterials.sortOrder));
}

async function snapshotMaterials(orgId: string, moId: string, bomId: string | null, outputs: { skuId: string; qty: number }[]) {
  const mat = await materialsForOutputs(orgId, bomId, outputs);
  await db.delete(moMaterials).where(and(eq(moMaterials.orgId, orgId), eq(moMaterials.moId, moId)));
  if (mat.lines.length) {
    await db.insert(moMaterials).values(mat.lines.map((l: any, i: number) => ({
      orgId, moId, itemId: l.itemId, kind: l.kind, plannedQty: roundQty(l.required).toString(), sortOrder: i,
    })));
  }
}

/** Allocated quantity per (mo, item), and per item across OTHER orders. */
async function allocationTotals(orgId: string, moId: string, itemIds: string[]) {
  const mine = new Map<string, number>(), others = new Map<string, number>();
  if (!itemIds.length) return { mine, others };
  const rows = await db.select({ moId: lotAllocations.moId, itemId: lotAllocations.itemId, qty: lotAllocations.qty })
    .from(lotAllocations).where(and(eq(lotAllocations.orgId, orgId), inArray(lotAllocations.itemId, itemIds)));
  for (const r of rows) {
    const m = r.moId === moId ? mine : others;
    m.set(r.itemId, (m.get(r.itemId) ?? 0) + num(r.qty));
  }
  return { mine, others };
}

export async function moDetail(orgId: string, id: string) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) return null;
  const [item] = mo.outputItemId ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(eq(apItems.id, mo.outputItemId)).limit(1) : [null];
  const outputs = await outputsForMO(orgId, mo);
  const plannedBase = await materialsForOutputs(orgId, mo.bomId, outputs.map(o => ({ skuId: o.skuId!, qty: o.qty })));
  const snap = await ensureMoMaterials(orgId, mo);
  const ids = snap.map(m => m.itemId);
  const items = ids.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom, onHand: apItems.onHandQty, productType: apItems.productType }).from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, ids))) : [];
  const byId = new Map(items.map(i => [i.id, i]));
  const { mine, others } = await allocationTotals(orgId, id, ids);
  const lines = snap.map(m => {
    const it = byId.get(m.itemId);
    const required = num(m.plannedQty);
    const allocated = roundQty(mine.get(m.itemId) ?? 0);
    // Available to THIS order: on hand, less what other orders hold, plus what
    // this order already holds (it is on hand and it is ours).
    const onHand = roundQty(num(it?.onHand) - (others.get(m.itemId) ?? 0));
    const tracked = kindOf(it?.productType).tracked;
    return {
      itemId: m.itemId, name: it?.name ?? "Item", baseUom: it?.baseUom ?? null, kind: m.kind, tracked,
      required, onHand, allocated, coverage: tracked ? coverage(required, allocated) : "full",
      short: roundQty(required - onHand), ok: onHand + 1e-6 >= required,
    };
  });
  const materials = { baseTotal: plannedBase.baseTotal || num(mo.qty), lines, anyShort: lines.some(l => !l.ok) };
  return { mo: { ...mo, qty: num(mo.qty) }, outputItem: item ?? null, outputs, materials };
}

/** Normalise create/edit output packs from the request body. */
function readOutputs(b: any): { skuId: string; qty: number }[] {
  if (Array.isArray(b?.outputs)) return b.outputs.filter((o: any) => o?.skuId && num(o.qty) > 0).map((o: any) => ({ skuId: String(o.skuId), qty: num(o.qty) }));
  if (b?.outputSkuId && num(b?.qty) > 0) return [{ skuId: String(b.outputSkuId), qty: num(b.qty) }];
  return [];
}

export async function createMO(orgId: string, b: any, actorId: string | null) {
  if (!s(b?.outputItemId)) err("Choose the item to produce.");
  const outs = readOutputs(b);
  if (!outs.length) err("Add at least one output pack with a quantity.");
  const mat = await materialsForOutputs(orgId, s(b?.bomId, 64), outs);
  const moNo = await nextDocNumber(orgId, "MO");
  const [row] = await db.insert(manufacturingOrders).values({
    orgId, moNo, bomId: s(b?.bomId, 64) as any, outputItemId: s(b?.outputItemId, 64)!, outputSkuId: outs[0].skuId,
    qty: String(mat.baseTotal || outs.reduce((sm, o) => sm + o.qty, 0)),
    scheduledDate: s(b?.scheduledDate, 16), dueDate: s(b?.dueDate, 16),
    priority: ["Low", "Normal", "High"].includes(b?.priority) ? b.priority : "Normal",
    status: b?.status === "Scheduled" ? "Scheduled" : "Draft", notes: s(b?.notes, 2000), createdBy: actorId,
    salesOrderId: s(b?.salesOrderId, 64),
  } as any).returning();
  await db.insert(moOutputs).values(outs.map(o => ({ orgId, moId: row.id, itemId: s(b?.outputItemId, 64)!, skuId: o.skuId, qty: String(o.qty) })) as any);
  await snapshotMaterials(orgId, row.id, s(b?.bomId, 64), outs);
  return row;
}

export async function updateMO(orgId: string, id: string, b: any) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) err("MO not found.");
  if (mo!.status === "Completed") err("A completed MO can't be edited — void its build first.");
  const changesPlan = Array.isArray(b.outputs) || (b.bomId !== undefined && s(b.bomId, 64) !== mo!.bomId);
  if (changesPlan && await hasAllocations(orgId, id)) {
    err("Lots are already allocated to this order. Release its allocations before changing what it makes or the BOM it follows.");
  }
  const set: Record<string, any> = { updatedAt: new Date() };
  if (b.bomId !== undefined) set.bomId = s(b.bomId, 64);
  if (b.outputItemId !== undefined) set.outputItemId = s(b.outputItemId, 64);
  if (b.scheduledDate !== undefined) set.scheduledDate = s(b.scheduledDate, 16);
  if (b.dueDate !== undefined) set.dueDate = s(b.dueDate, 16);
  if (b.priority !== undefined && ["Low", "Normal", "High"].includes(b.priority)) set.priority = b.priority;
  if (b.notes !== undefined) set.notes = s(b.notes, 2000);
  if (b.salesOrderId !== undefined) set.salesOrderId = s(b.salesOrderId, 64);
  if (Array.isArray(b.outputs)) {
    const outs = readOutputs(b);
    const mat = await materialsForOutputs(orgId, s(b?.bomId, 64) ?? mo!.bomId, outs);
    set.qty = String(mat.baseTotal || 0); set.outputSkuId = outs[0]?.skuId ?? null;
    await db.delete(moOutputs).where(and(eq(moOutputs.orgId, orgId), eq(moOutputs.moId, id)));
    if (outs.length) await db.insert(moOutputs).values(outs.map(o => ({ orgId, moId: id, itemId: (set.outputItemId ?? mo!.outputItemId), skuId: o.skuId, qty: String(o.qty) })) as any);
  }
  await db.update(manufacturingOrders).set(set).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId)));
  if (changesPlan) {
    const outs = (await outputsForMO(orgId, { ...mo, ...set })).map(o => ({ skuId: o.skuId!, qty: o.qty }));
    await snapshotMaterials(orgId, id, set.bomId !== undefined ? set.bomId : mo!.bomId, outs);
  }
  return { id, updated: true };
}

export async function setMoStatus(orgId: string, id: string, status: MoStatus) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) err("MO not found.");
  if (status === "Completed") err("Use Complete build to finish an MO.");
  if (!(MO_STATUSES as readonly string[]).includes(status)) err("Unknown status.");
  const allowed = TRANSITIONS[mo!.status as MoStatus] ?? [];
  if (!allowed.includes(status)) err(`Can't move a ${mo!.status} order to ${status}.`);
  // Stepping back out of In Progress would leave stock reserved for an order
  // nobody is working on. Cancelling is the explicit way to give it back.
  if (mo!.status === "InProgress" && status === "Released" && await hasAllocations(orgId, id)) {
    err("This order has lots allocated. Release them first, or cancel the order to give the stock back.");
  }
  await db.update(manufacturingOrders).set({ status, updatedAt: new Date() }).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId)));
  if (status === "Cancelled") await db.delete(lotAllocations).where(and(eq(lotAllocations.orgId, orgId), eq(lotAllocations.moId, id)));
  return { id, status };
}

export async function deleteMO(orgId: string, id: string) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) err("MO not found.");
  if (mo!.status === "Completed" || mo!.productionRunId) err("This MO has been built — void the build from Production first.");
  await db.delete(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))); // mo_outputs cascade
  return { id, deleted: true };
}

/** Complete an MO by running the multi-output build (FIFO). */
export async function completeMO(orgId: string, id: string, actorId: string | null, opts?: { producedDate?: string }) {
  const [mo] = await db.select().from(manufacturingOrders).where(and(eq(manufacturingOrders.id, id), eq(manufacturingOrders.orgId, orgId))).limit(1);
  if (!mo) err("MO not found.");
  if (mo!.status === "Completed") err("This MO is already completed.");
  if (mo!.status === "Cancelled") err("This MO was cancelled.");
  if (mo!.status !== "InProgress") err("Start the order (In Progress) and allocate its lots before completing it.");
  if (!mo!.bomId) err("This MO has no BOM — a build needs a recipe.");
  const outs = await outputsForMO(orgId, mo!);
  if (!outs.length) err("This MO has no output packs.");

  // Every stocked material must have lots allocated. What is allocated is what
  // was used: the build consumes exactly these, never FIFO, never a typed cost.
  const detail = await moDetail(orgId, id);
  const missing = (detail?.materials.lines ?? []).filter((l: any) => l.tracked && l.required > 0 && !(l.allocated > 0));
  if (missing.length) err(`Allocate lots for ${missing.slice(0, 3).map((l: any) => l.name).join(", ")}${missing.length > 3 ? ` and ${missing.length - 3} more` : ""} before completing.`);
  const allocs = await db.select({ itemId: lotAllocations.itemId, lotId: lotAllocations.lotId, qty: lotAllocations.qty })
    .from(lotAllocations).where(and(eq(lotAllocations.orgId, orgId), eq(lotAllocations.moId, id)));
  const lotPicks: Record<string, { lotId: string; qty: number }[]> = {};
  for (const a of allocs) (lotPicks[a.itemId] ??= []).push({ lotId: a.lotId, qty: num(a.qty) });

  const res: any = await buildProductionMulti(orgId, {
    bomId: mo!.bomId!, outputs: outs.map(o => ({ skuId: o.skuId!, qty: o.qty })),
    producedDate: opts?.producedDate || mo!.scheduledDate || new Date().toISOString().slice(0, 10),
    moId: id, lotPicks,
  }, actorId);

  if (res.pending) return { id, pending: true, approvalId: res.id, amount: res.amount };

  await finishMoCompletion(orgId, id, res.id);
  return { id, status: "Completed", runId: res.id, runNo: res.runNo, totalCost: res.totalInputCost };
}

/** Does this order hold any lot allocations? */
export async function hasAllocations(orgId: string, moId: string): Promise<boolean> {
  const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(lotAllocations).where(and(eq(lotAllocations.orgId, orgId), eq(lotAllocations.moId, moId)));
  return Number(r?.n ?? 0) > 0;
}

/**
 * Mark an MO completed by a build and drop its allocations — the lots have
 * been consumed, so the reservation has nothing left to hold. Shared by
 * completeMO and by the approval path, which runs the build later.
 */
export async function finishMoCompletion(orgId: string, moId: string, runId: string) {
  await db.update(manufacturingOrders).set({ status: "Completed", productionRunId: runId, updatedAt: new Date() })
    .where(and(eq(manufacturingOrders.id, moId), eq(manufacturingOrders.orgId, orgId)));
  await db.delete(lotAllocations).where(and(eq(lotAllocations.orgId, orgId), eq(lotAllocations.moId, moId)));
}
