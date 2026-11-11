/**
 * BOM Builder persistence. SERVER ONLY (imports db). The pure rules live in
 * bom-rules.ts so the drawer validates with the exact same code.
 *
 * neon-http has NO transactions, so a whole-BOM save is: validate EVERYTHING
 * (rules + database facts) before the first write, then one multi-row insert per
 * table. If a write fails part-way, a create deletes its header (lines cascade) and
 * an edit puts the previous lines back, and both log loudly — never a half-saved BOM.
 */

import { db } from "@/db";
import { boms, bomLines, bomOperations, workCentres, apItems, itemSkus } from "@/db/schema";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { kindOf } from "@/lib/inventory/item-kinds";
import { convert, uom as uomOf } from "@/lib/inventory/uom";
import { validateBom, nextCopyCode, type BomInput } from "@/lib/inventory/bom-rules";
import { roundQty } from "@/lib/inventory/round";

export class BomValidationError extends Error {
  constructor(public messages: string[], public status = 400) { super(messages.join(" ")); }
}

const str = (v: any, n = 255) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
const numOr = (v: any, d: number | null = null) => (v == null || v === "" || isNaN(Number(v)) ? d : Number(v));

/** Coerce an untrusted request body into the shape the rules expect. */
export function toBomInput(b: any): BomInput {
  const arr = (x: any) => (Array.isArray(x) ? x : []);
  return {
    code: str(b?.code, 64),
    name: String(b?.name ?? "").trim().slice(0, 255),
    outputItemId: str(b?.outputItemId, 64),
    outputSkuId: str(b?.outputSkuId, 64),
    status: ["Active", "Draft", "Archived"].includes(b?.status) ? b.status : "Active",
    batchType: b?.batchType === "Input" ? "Input" : "Output",
    batchSize: numOr(b?.batchSize, 0) as number,
    expYield: b?.expYield == null || b?.expYield === "" ? null : (numOr(b.expYield, NaN) as number),
    processingStep: str(b?.processingStep, 64),
    notes: str(b?.notes, 2000),
    outputs: arr(b?.outputs).map((o: any) => ({ skuId: str(o?.skuId, 64), qty: numOr(o?.qty, 0) as number, outputPackQty: numOr(o?.outputPackQty), packagingConfig: str(o?.packagingConfig, 128) })),
    inputs: arr(b?.inputs).map((i: any) => ({ itemId: String(i?.itemId ?? ""), qty: numOr(i?.qty, 0) as number, uom: str(i?.uom, 16), supplierSkuId: str(i?.supplierSkuId, 64) })),
    packs: arr(b?.packs).map((p: any) => ({ itemId: String(p?.itemId ?? ""), qty: numOr(p?.qty, 0) as number, uom: str(p?.uom, 16), forSkuId: str(p?.forSkuId, 64) })),
    ops: arr(b?.ops).map((o: any) => ({ workCentreId: String(o?.workCentreId ?? ""), hoursPerBatch: numOr(o?.hoursPerBatch, 0) as number, description: str(o?.description, 255) })),
  };
}

/**
 * Rules + database facts. Returns the input with quantities converted to each
 * item's BASE unit (every BOM consumer reads base units), or throws with every
 * problem found, not just the first.
 */
export async function checkBom(orgId: string, input: BomInput, selfId?: string): Promise<BomInput> {
  const errors = validateBom(input);
  if (!input.outputItemId) errors.push("Pick the product this recipe makes.");

  const itemIds = [...new Set([input.outputItemId, ...input.inputs.map(i => i.itemId), ...input.packs.map(p => p.itemId)].filter(Boolean) as string[])];
  const items = itemIds.length ? await db.select({ id: apItems.id, name: apItems.name, productType: apItems.productType, baseUom: apItems.baseUom })
    .from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, itemIds))) : [];
  const byId = new Map(items.map(i => [i.id, i]));

  const out = input.outputItemId ? byId.get(input.outputItemId) : null;
  if (input.outputItemId && !out) errors.push("The product this recipe makes was not found.");
  if (out && !kindOf(out.productType).producible) errors.push(`${out.name} cannot be produced from a BOM (its item type is not producible).`);

  const skuIds = [...new Set(input.outputs.map(o => o.skuId).filter(Boolean) as string[])];
  if (skuIds.length && input.outputItemId) {
    const found = await db.select({ id: itemSkus.id }).from(itemSkus).where(and(eq(itemSkus.orgId, orgId), eq(itemSkus.itemId, input.outputItemId), inArray(itemSkus.id, skuIds)));
    const ok = new Set(found.map(f => f.id));
    if (skuIds.some(s => !ok.has(s))) errors.push("An output pack is not a SKU of the product this recipe makes.");
  }

  const convertLines = <T extends { itemId: string; qty: number; uom: string | null }>(lines: T[], label: string): T[] => lines.map(l => {
    const it = byId.get(l.itemId);
    if (!it) { errors.push(`${label}: an item was not found.`); return l; }
    if (!kindOf(it.productType).consumable) { errors.push(`${it.name} cannot be used in a recipe (its item type is not consumable).`); return l; }
    const base = it.baseUom;
    if (l.uom && base && l.uom.toLowerCase() !== base.toLowerCase()) {
      const r = uomOf(l.uom) && uomOf(base) ? convert(l.qty, l.uom, base) : null;
      if (!r || !r.ok) { errors.push(`${it.name} is kept in ${base}; ${l.uom} can't be converted to it. Enter the amount in ${base}.`); return l; }
      return { ...l, qty: roundQty(r.qty), uom: base };
    }
    return { ...l, uom: base ?? l.uom };
  });
  const inputs = convertLines(input.inputs, "Ingredient");
  const packs = convertLines(input.packs, "Packaging");

  const wcIds = [...new Set(input.ops.map(o => o.workCentreId).filter(Boolean))];
  if (wcIds.length) {
    const found = await db.select({ id: workCentres.id }).from(workCentres).where(and(eq(workCentres.orgId, orgId), inArray(workCentres.id, wcIds)));
    const ok = new Set(found.map(f => f.id));
    if (wcIds.some(w => !ok.has(w))) errors.push("An operation names a work centre that was not found.");
  }

  if (input.code) {
    const dupe = await db.select({ id: boms.id }).from(boms)
      .where(and(eq(boms.orgId, orgId), sql`lower(${boms.code}) = ${input.code.toLowerCase()}`, selfId ? ne(boms.id, selfId) : sql`true`)).limit(1);
    if (dupe.length) errors.push(`Another BOM already uses the ID ${input.code}.`);
  }

  if (errors.length) throw new BomValidationError([...new Set(errors)]);
  return { ...input, inputs, packs, outputSkuId: input.outputs[0]?.skuId ?? input.outputSkuId };
}

function lineRows(orgId: string, bomId: string, b: BomInput, baseUom: string | null) {
  let n = 0;
  return [
    ...b.outputs.map(o => ({ orgId, bomId, role: "output", itemId: b.outputItemId!, skuId: o.skuId, qty: String(o.qty), uom: baseUom, packagingConfig: o.packagingConfig ?? null, outputPackQty: o.outputPackQty == null ? null : String(o.outputPackQty), sortOrder: n++ })),
    ...b.inputs.map(i => ({ orgId, bomId, role: "input", itemId: i.itemId, qty: String(i.qty), uom: i.uom, supplierSkuId: i.supplierSkuId ?? null, sortOrder: n++ })),
    ...b.packs.map(p => ({ orgId, bomId, role: "pack", itemId: p.itemId, qty: String(p.qty), uom: p.uom, packagingForSkuId: p.forSkuId, sortOrder: n++ })),
  ] as any[];
}
const opRows = (orgId: string, bomId: string, b: BomInput) => b.ops.map((o, i) => ({ orgId, bomId, workCentreId: o.workCentreId, hoursPerBatch: String(o.hoursPerBatch), description: o.description, sortOrder: i })) as any[];
const headerValues = (b: BomInput) => ({
  code: b.code, name: b.name, outputItemId: b.outputItemId as any, outputSkuId: b.outputSkuId as any, status: b.status, batchType: b.batchType,
  batchSize: String(b.batchSize), expYield: b.expYield == null ? null : String(b.expYield), processingStep: b.processingStep, notes: b.notes,
});

/** A unique-index rejection from the 0134 indexes, as a message a person can act on. */
function friendly(e: any): never {
  const m = String(e?.message ?? e);
  if (e?.code === "23505" || /bom_lines_(output|input|pack)_unique/.test(m)) throw new BomValidationError(["The same output pack, ingredient or packaging line appears more than once in this BOM."], 409);
  throw e;
}

async function baseUomOf(orgId: string, itemId: string): Promise<string | null> {
  const [r] = await db.select({ baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId), eq(apItems.id, itemId))).limit(1);
  return r?.baseUom ?? null;
}

export async function createBom(orgId: string, raw: BomInput): Promise<string> {
  const b = await checkBom(orgId, raw);
  const baseUom = await baseUomOf(orgId, b.outputItemId!);
  const [head] = await db.insert(boms).values({ orgId, ...headerValues(b) } as any).returning({ id: boms.id });
  try {
    const lines = lineRows(orgId, head.id, b, baseUom);
    if (lines.length) await db.insert(bomLines).values(lines);
    const ops = opRows(orgId, head.id, b);
    if (ops.length) await db.insert(bomOperations).values(ops);
  } catch (e) {
    console.error("[bom-save] create failed part-way; removing the header", head.id, e);
    await db.delete(boms).where(eq(boms.id, head.id)).catch(err => console.error("[bom-save] CLEANUP FAILED, orphan BOM header", head.id, err));
    friendly(e);
  }
  return head.id;
}

/** Replace a BOM's header, lines and operations. Refuses if someone else saved since `expectedUpdatedAt`. */
export async function replaceBom(orgId: string, id: string, raw: BomInput, expectedUpdatedAt: string | number | null): Promise<void> {
  const [cur] = await db.select().from(boms).where(and(eq(boms.id, id), eq(boms.orgId, orgId))).limit(1);
  if (!cur) throw new BomValidationError(["BOM not found."], 404);
  if (expectedUpdatedAt != null && new Date(expectedUpdatedAt as any).getTime() !== cur.updatedAt.getTime()) {
    throw new BomValidationError(["Someone else changed this BOM since you opened it. Close it and open it again to see their changes."], 409);
  }
  const b = await checkBom(orgId, raw, id);
  const baseUom = await baseUomOf(orgId, b.outputItemId!);
  const oldLines = await db.select().from(bomLines).where(eq(bomLines.bomId, id));
  const oldOps = await db.select().from(bomOperations).where(eq(bomOperations.bomId, id));

  await db.update(boms).set({ ...headerValues(b), updatedAt: new Date() } as any).where(and(eq(boms.id, id), eq(boms.orgId, orgId)));
  await db.delete(bomLines).where(eq(bomLines.bomId, id));
  await db.delete(bomOperations).where(eq(bomOperations.bomId, id));
  try {
    const lines = lineRows(orgId, id, b, baseUom);
    if (lines.length) await db.insert(bomLines).values(lines);
    const ops = opRows(orgId, id, b);
    if (ops.length) await db.insert(bomOperations).values(ops);
  } catch (e) {
    console.error("[bom-save] edit failed part-way; restoring the previous lines", id, e);
    try {
      await db.delete(bomLines).where(eq(bomLines.bomId, id));
      await db.delete(bomOperations).where(eq(bomOperations.bomId, id));
      if (oldLines.length) await db.insert(bomLines).values(oldLines);
      if (oldOps.length) await db.insert(bomOperations).values(oldOps);
      await db.update(boms).set({ code: cur.code, name: cur.name, outputItemId: cur.outputItemId, outputSkuId: cur.outputSkuId, status: cur.status, batchType: cur.batchType, batchSize: cur.batchSize, expYield: cur.expYield, processingStep: cur.processingStep, notes: cur.notes, updatedAt: cur.updatedAt }).where(eq(boms.id, id));
    } catch (err) { console.error("[bom-save] RESTORE FAILED — BOM", id, "may be missing lines", err); }
    friendly(e);
  }
}

/** A BOM in the shape the builder edits, plus the concurrency token. */
export async function loadBomFull(orgId: string, id: string) {
  const [bom] = await db.select().from(boms).where(and(eq(boms.id, id), eq(boms.orgId, orgId))).limit(1);
  if (!bom) return null;
  const lines = await db.select().from(bomLines).where(eq(bomLines.bomId, id)).orderBy(asc(bomLines.sortOrder), asc(bomLines.createdAt));
  const ops = await db.select().from(bomOperations).where(eq(bomOperations.bomId, id)).orderBy(asc(bomOperations.sortOrder), asc(bomOperations.createdAt));
  const input: BomInput = {
    code: bom.code, name: bom.name, outputItemId: bom.outputItemId, outputSkuId: bom.outputSkuId, status: bom.status, batchType: bom.batchType,
    batchSize: Number(bom.batchSize), expYield: bom.expYield == null ? null : Number(bom.expYield), processingStep: bom.processingStep, notes: bom.notes,
    outputs: lines.filter(l => l.role === "output").map(l => ({ skuId: l.skuId, qty: Number(l.qty), outputPackQty: l.outputPackQty == null ? null : Number(l.outputPackQty), packagingConfig: l.packagingConfig })),
    inputs: lines.filter(l => l.role === "input").map(l => ({ itemId: l.itemId, qty: Number(l.qty), uom: l.uom, supplierSkuId: l.supplierSkuId })),
    packs: lines.filter(l => l.role === "pack").map(l => ({ itemId: l.itemId, qty: Number(l.qty), uom: l.uom, forSkuId: l.packagingForSkuId })),
    ops: ops.map(o => ({ workCentreId: o.workCentreId, hoursPerBatch: Number(o.hoursPerBatch), description: o.description })),
  };
  return { id: bom.id, updatedAt: bom.updatedAt.toISOString(), input };
}

/** The most recently updated Active BOM for a product, as a prefill for a NEW one. */
export async function suggestFor(orgId: string, itemId: string) {
  const [src] = await db.select({ id: boms.id, code: boms.code }).from(boms)
    .where(and(eq(boms.orgId, orgId), eq(boms.outputItemId, itemId), eq(boms.status, "Active"))).orderBy(sql`${boms.updatedAt} desc`).limit(1);
  const codes = (await db.select({ code: boms.code }).from(boms).where(eq(boms.orgId, orgId))).map(r => r.code).filter(Boolean) as string[];
  if (!src) return { source: null, suggestedCode: null, input: null };
  const full = await loadBomFull(orgId, src.id);
  const suggestedCode = nextCopyCode(src.code || "BOM", codes);
  return { source: { id: src.id, code: src.code }, suggestedCode, input: full ? { ...full.input, code: suggestedCode } : null };
}
