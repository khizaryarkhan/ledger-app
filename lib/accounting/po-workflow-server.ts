/**
 * Purchase-order workflow — the db half (rules are in po-workflow.ts).
 *
 * Stages, the expandable "items" view of a PO, closing / reopening a line, and
 * rejecting / reopening a whole order. neon-http has no transactions, so every
 * function validates fully before its first write.
 */
import { db } from "@/db";
import {
  tradeDocuments, tradeDocumentLines, poStages, poSupplierResponses, apItems, itemSkus, itemSupplierSkus,
} from "@/db/schema";
import { and, asc, eq, inArray } from "drizzle-orm";
import { logEvent } from "@/lib/audit";
import { LedgerValidationError } from "@/lib/ledger";
import { roundQty } from "@/lib/inventory/round";
import {
  SYSTEM_PO_STAGES, FULFILMENT_STAGES, CLOSE_REASONS, isManuallySettable, lineBalance, lineState, type PoStageDef, type LineState,
} from "@/lib/accounting/po-workflow";

const err = (m: string): never => { throw new LedgerValidationError(m); };
const KEY_RE = /^[A-Za-z0-9 _-]{1,40}$/;

/** Every stage a PO can show: system, the org's own, and the derived fulfilment ones. */
export async function listPoStages(orgId: string): Promise<{ system: PoStageDef[]; custom: PoStageDef[]; fulfilment: PoStageDef[] }> {
  const rows = await db.select().from(poStages).where(eq(poStages.orgId, orgId)).orderBy(asc(poStages.sortOrder), asc(poStages.createdAt));
  const custom = rows.map(r => ({ key: r.key, label: r.label, color: r.color, locked: false }));
  // A rename of a system stage's label is stored as a row with that key.
  const system = SYSTEM_PO_STAGES.map(s => {
    const o = rows.find(r => r.key === s.key);
    return o ? { ...s, label: o.label } : s;
  });
  return { system, custom: custom.filter(c => !SYSTEM_PO_STAGES.some(s => s.key === c.key)), fulfilment: FULFILMENT_STAGES };
}

export async function createPoStage(orgId: string, input: { label: string; color?: string }) {
  const label = input.label?.trim();
  if (!label) err("Give the stage a name.");
  const key = label.slice(0, 40);
  if (label.length > 40) err("Keep a stage name to 40 characters or fewer.");
  if (!KEY_RE.test(key)) err("Use letters, numbers, spaces, - or _ in a stage name.");
  const all = await listPoStages(orgId);
  const taken = [...all.system, ...all.custom, ...all.fulfilment];
  if (taken.some(s => s.key.toLowerCase() === key.toLowerCase() || s.label.toLowerCase() === label.toLowerCase())) err("A stage with that name already exists.");
  const [row] = await db.insert(poStages).values({ orgId, key, label, color: input.color || "stone", sortOrder: all.custom.length + 1 }).returning();
  return row;
}

export async function renamePoStage(orgId: string, key: string, label: string) {
  const next = label?.trim();
  if (!next) err("Give the stage a name.");
  if (next.length > 40) err("Keep a stage name to 40 characters or fewer.");
  const others = await listPoStages(orgId);
  if ([...others.system, ...others.custom, ...others.fulfilment].some(s => s.key !== key && s.label.toLowerCase() === next.toLowerCase())) err("A stage with that name already exists.");
  const sys = SYSTEM_PO_STAGES.find(s => s.key === key);
  if (sys?.locked) err("This stage is managed by the workflow and cannot be renamed.");
  const [existing] = await db.select().from(poStages).where(and(eq(poStages.orgId, orgId), eq(poStages.key, key))).limit(1);
  if (existing) await db.update(poStages).set({ label: next }).where(eq(poStages.id, existing.id));
  else if (sys) await db.insert(poStages).values({ orgId, key, label: next, color: sys.color });
  else err("Stage not found.");
  return { key, label: next };
}

export async function deletePoStage(orgId: string, key: string) {
  if (SYSTEM_PO_STAGES.some(s => s.key === key)) err("Workflow stages cannot be deleted.");
  const [inUse] = await db.select({ id: tradeDocuments.id }).from(tradeDocuments)
    .where(and(eq(tradeDocuments.orgId, orgId), eq(tradeDocuments.stage, key))).limit(1);
  if (inUse) err("Purchase orders are still on this stage — move them first.");
  await db.delete(poStages).where(and(eq(poStages.orgId, orgId), eq(poStages.key, key)));
  return { key, deleted: true };
}

/** Put a PO on a manual stage, or clear it (null) so the stage is derived again. */
export async function setPoStage(orgId: string, id: string, stage: string | null, actorId: string | null) {
  const [doc] = await db.select().from(tradeDocuments).where(and(eq(tradeDocuments.id, id), eq(tradeDocuments.orgId, orgId))).limit(1);
  if (!doc || doc.kind !== "PurchaseOrder") err("Purchase order not found.");
  if (stage !== null) {
    if (!isManuallySettable(stage)) err("That stage is set by sending, the supplier's answer, or your decision — not picked by hand.");
    const all = await listPoStages(orgId);
    if (![...all.system, ...all.custom].some(s => s.key === stage)) err("Unknown stage.");
  }
  await db.update(tradeDocuments).set({ stage, updatedAt: new Date() }).where(eq(tradeDocuments.id, id));
  logEvent({ orgId, eventType: "document_edited", docType: "trade", docId: id, actorId, meta: { action: "po_stage", stage } })
    .catch(e => console.error("[audit] po_stage failed:", e));
  return { id, stage };
}

/** The supplier turned the order down, or the buyer cancels it. Reopenable. */
export async function rejectPo(orgId: string, id: string, reason: string, actorId: string | null) {
  const why = reason?.trim();
  if (!why) err("A reason is required to reject an order.");
  const [doc] = await db.select().from(tradeDocuments).where(and(eq(tradeDocuments.id, id), eq(tradeDocuments.orgId, orgId))).limit(1);
  if (!doc || doc.kind !== "PurchaseOrder") err("Purchase order not found.");
  const lines = await db.select({ r: tradeDocumentLines.receivedQty }).from(tradeDocumentLines).where(eq(tradeDocumentLines.documentId, id));
  if (lines.some(l => Number(l.r) > 0)) err("Goods have already been received against this order — close its lines instead.");
  await db.update(tradeDocuments).set({ rejectedAt: new Date(), rejectedBy: actorId, rejectReason: why, updatedAt: new Date() }).where(eq(tradeDocuments.id, id));
  logEvent({ orgId, eventType: "document_edited", docType: "trade", docId: id, actorId, meta: { action: "po_rejected", reason: why } })
    .catch(e => console.error("[audit] po_rejected failed:", e));
  return { id, rejected: true };
}

export async function reopenPo(orgId: string, id: string, actorId: string | null) {
  const [doc] = await db.select().from(tradeDocuments).where(and(eq(tradeDocuments.id, id), eq(tradeDocuments.orgId, orgId))).limit(1);
  if (!doc || doc.kind !== "PurchaseOrder") err("Purchase order not found.");
  if (!doc.rejectedAt) err("This order is not rejected.");
  await db.update(tradeDocuments).set({ rejectedAt: null, rejectedBy: null, rejectReason: null, updatedAt: new Date() }).where(eq(tradeDocuments.id, id));
  logEvent({ orgId, eventType: "document_edited", docType: "trade", docId: id, actorId, meta: { action: "po_reopened" } })
    .catch(e => console.error("[audit] po_reopened failed:", e));
  return { id, rejected: false };
}

export interface PoItemRow {
  id: string; lineNo: number; name: string; sku: string | null;
  orderUom: string | null; packLevel: string | null; unitsPerOrderUnit: number; baseUom: string | null;
  qty: number; orderedBase: number; receivedBase: number; balanceBase: number;
  receivedOrder: number; balanceOrder: number;
  rate: number; amount: number; billedBase: number;
  requestedDate: string | null; promisedDate: string | null; originalPromisedDate: string | null; promiseRevisions: number;
  state: LineState; closed: boolean; closeCode: string | null; closeNote: string | null; closedAt: string | null;
}

/** The expandable items view: one row per line, in the order unit AND the base unit. */
export async function poItems(orgId: string, id: string, today: string): Promise<PoItemRow[]> {
  const lines = await db.select().from(tradeDocumentLines)
    .where(and(eq(tradeDocumentLines.documentId, id), eq(tradeDocumentLines.orgId, orgId))).orderBy(tradeDocumentLines.lineNo);
  const itemIds = Array.from(new Set(lines.map(l => l.itemId).filter(Boolean) as string[]));
  const skuIds = Array.from(new Set(lines.map(l => l.skuId).filter(Boolean) as string[]));
  const supIds = Array.from(new Set(lines.map(l => l.supplierSkuId).filter(Boolean) as string[]));
  const [items, skus, sups] = await Promise.all([
    itemIds.length ? db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(inArray(apItems.id, itemIds)) : Promise.resolve([] as { id: string; name: string; baseUom: string | null }[]),
    skuIds.length ? db.select({ id: itemSkus.id, name: itemSkus.skuName, code: itemSkus.skuCode }).from(itemSkus).where(inArray(itemSkus.id, skuIds)) : Promise.resolve([] as { id: string; name: string | null; code: string | null }[]),
    supIds.length ? db.select({ id: itemSupplierSkus.id, name: itemSupplierSkus.skuName, code: itemSupplierSkus.supplierSku }).from(itemSupplierSkus).where(inArray(itemSupplierSkus.id, supIds)) : Promise.resolve([] as { id: string; name: string | null; code: string | null }[]),
  ]);
  const itemBy = new Map(items.map(i => [i.id, i]));
  const skuBy = new Map(skus.map(s => [s.id, s]));
  const supBy = new Map(sups.map(s => [s.id, s]));
  return lines.map(l => {
    const item = l.itemId ? itemBy.get(l.itemId) : undefined;
    const sup = l.supplierSkuId ? supBy.get(l.supplierSkuId) : undefined;
    const sku = l.skuId ? skuBy.get(l.skuId) : undefined;
    const per = Number(l.unitsPerOrderUnit) || 1;
    const orderedBase = Number(l.orderedBaseQty), receivedBase = Number(l.receivedQty);
    const facts = { orderedBaseQty: orderedBase, receivedQty: receivedBase, closed: l.closed, requestedDate: l.requestedDate, promisedDate: l.promisedDate };
    const balanceBase = roundQty(lineBalance(facts));
    return {
      id: l.id, lineNo: l.lineNo,
      name: sup?.name || sku?.name || item?.name || l.description || "(no description)",
      sku: sup?.code || sku?.code || null,
      orderUom: l.orderUom, packLevel: l.packLevel, unitsPerOrderUnit: per, baseUom: item?.baseUom ?? null,
      qty: Number(l.qty ?? 0), orderedBase, receivedBase, balanceBase,
      receivedOrder: roundQty(receivedBase / per), balanceOrder: roundQty(balanceBase / per),
      rate: Number(l.rate ?? 0), amount: Number(l.amount), billedBase: Number(l.billedQty),
      requestedDate: l.requestedDate, promisedDate: l.promisedDate,
      originalPromisedDate: l.originalPromisedDate, promiseRevisions: l.promiseRevisions,
      state: lineState(facts, today), closed: l.closed, closeCode: l.closeCode, closeNote: l.closeReason,
      closedAt: l.closedAt ? l.closedAt.toISOString() : null,
    };
  });
}

/** Stop expecting the rest of a line. A fixed reason code is required; the note is optional. */
export async function closePoLine(orgId: string, lineId: string, code: string, note: string | null, actorId: string | null) {
  if (!CLOSE_REASONS.some(r => r.code === code)) err("Choose a reason.");
  const [line] = await db.select().from(tradeDocumentLines).where(and(eq(tradeDocumentLines.id, lineId), eq(tradeDocumentLines.orgId, orgId))).limit(1);
  if (!line) err("Line not found.");
  if (line.closed) err("This line is already closed.");
  const [doc] = await db.select({ kind: tradeDocuments.kind, docNumber: tradeDocuments.docNumber }).from(tradeDocuments).where(eq(tradeDocuments.id, line.documentId)).limit(1);
  if (!doc || doc.kind !== "PurchaseOrder") err("Only purchase order lines can be closed this way.");
  await db.update(tradeDocumentLines).set({ closed: true, closeCode: code, closeReason: note?.trim() || null, closedAt: new Date(), closedBy: actorId })
    .where(eq(tradeDocumentLines.id, lineId));
  logEvent({ orgId, eventType: "document_edited", docType: "trade", docId: line.documentId, actorId, meta: { action: "po_line_closed", lineId, code } })
    .catch(e => console.error("[audit] po_line_closed failed:", e));
  return { closed: true };
}

export async function reopenPoLine(orgId: string, lineId: string, actorId: string | null) {
  const [line] = await db.select().from(tradeDocumentLines).where(and(eq(tradeDocumentLines.id, lineId), eq(tradeDocumentLines.orgId, orgId))).limit(1);
  if (!line) err("Line not found.");
  if (!line.closed) err("This line is not closed.");
  await db.update(tradeDocumentLines).set({ closed: false, closeCode: null, closeReason: null, closedAt: null, closedBy: null }).where(eq(tradeDocumentLines.id, lineId));
  logEvent({ orgId, eventType: "document_edited", docType: "trade", docId: line.documentId, actorId, meta: { action: "po_line_reopened", lineId } })
    .catch(e => console.error("[audit] po_line_reopened failed:", e));
  return { closed: false };
}

/** Ids of POs with an unanswered supplier proposal — drives the Revision proposed stage. */
export async function pendingResponseDocIds(orgId: string, docIds: string[]): Promise<Set<string>> {
  if (!docIds.length) return new Set();
  const rows = await db.select({ d: poSupplierResponses.documentId }).from(poSupplierResponses)
    .where(and(eq(poSupplierResponses.orgId, orgId), eq(poSupplierResponses.status, "pending"), inArray(poSupplierResponses.documentId, docIds)));
  return new Set(rows.map(r => r.d));
}
