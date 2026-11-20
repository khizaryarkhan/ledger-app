/**
 * Expected deliveries (0144), the server half. Pure rules: expected-delivery.ts.
 *
 * Writes are validated in full first, then the header, packages and lines are
 * inserted; neon-http has no transactions, so a failed child insert deletes the
 * header (children cascade) and reports loudly. The unique index on
 * (org, supplier, upper(reference)) for active deliveries is the real guard
 * that one ASN number is recorded once; a 23505 becomes a readable 409.
 */

import { db } from "@/db";
import {
  expectedDeliveries, expectedDeliveryLines, expectedDeliveryPackages,
  tradeDocuments, tradeDocumentLines, parties, apItems, goodsReceipts,
} from "@/db/schema";
import { and, eq, inArray, desc, asc, isNull, isNotNull, ne } from "drizzle-orm";
import { prepareDelivery, deliveryState, type DeliveryInput, type DeliveryState, type PreparedDelivery } from "@/lib/inventory/expected-delivery";

export class ExpectedDeliveryError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const expectedDeliveryErrorOf = (e: unknown) => (e instanceof ExpectedDeliveryError ? e : null);
const fail = (m: string, status = 400): never => { throw new ExpectedDeliveryError(m, status); };
const isUniqueViolation = (e: any) => e?.code === "23505" || /duplicate key|unique constraint/i.test(String(e?.message ?? ""));

async function loadPo(orgId: string, poId: string) {
  const [po] = await db.select({ id: tradeDocuments.id, kind: tradeDocuments.kind, partyId: tradeDocuments.partyId, docNumber: tradeDocuments.docNumber })
    .from(tradeDocuments).where(and(eq(tradeDocuments.id, poId), eq(tradeDocuments.orgId, orgId))).limit(1);
  if (!po || po.kind !== "PurchaseOrder") fail("Purchase order not found.", 404);
  const lines = await db.select({ id: tradeDocumentLines.id, itemId: tradeDocumentLines.itemId }).from(tradeDocumentLines)
    .where(and(eq(tradeDocumentLines.documentId, poId), eq(tradeDocumentLines.orgId, orgId)));
  return { po: po!, lines: lines.filter(l => l.itemId).map(l => ({ id: l.id, itemId: l.itemId! })) };
}

/** Record what a supplier says is coming. A delivery that names a PO takes its supplier from that PO. */
export async function createExpectedDelivery(orgId: string, input: DeliveryInput, actorId: string | null) {
  const poId = input.poId ? String(input.poId) : null;
  let supplierId = input.supplierId ? String(input.supplierId) : null;
  let poLines: { id: string; itemId: string }[] | null = null;
  let knownItemIds: Set<string> | undefined;
  if (poId) {
    const p = await loadPo(orgId, poId);
    if (supplierId && p.po.partyId && supplierId !== p.po.partyId) fail("The supplier is not the one on that purchase order.");
    supplierId = p.po.partyId ?? supplierId;
    poLines = p.lines;
  } else {
    const ids = [...new Set((input.lines ?? []).map(l => (l?.itemId ? String(l.itemId) : "")).filter(Boolean))];
    knownItemIds = new Set(ids.length
      ? (await db.select({ id: apItems.id }).from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, ids)))).map(r => r.id)
      : []);
  }
  if (!supplierId) fail("Choose the supplier (or a purchase order).");
  const [sup] = await db.select({ id: parties.id }).from(parties)
    .where(and(eq(parties.id, supplierId!), eq(parties.orgId, orgId), eq(parties.partyType, "supplier"))).limit(1);
  if (!sup) fail("Supplier not found.", 404);

  const prep = prepareDelivery(input, { poLines, knownItemIds });
  if (prep.ok === false) fail(prep.error);
  const d = (prep as { ok: true; value: PreparedDelivery }).value;

  let header;
  try {
    [header] = await db.insert(expectedDeliveries).values({
      orgId, supplierId, poId, source: d.source, reference: d.reference, shipDate: d.shipDate, expectedDate: d.expectedDate,
      carrier: d.carrier, trackingNo: d.trackingNo, notes: d.notes, createdBy: actorId,
    }).returning();
  } catch (e) {
    if (isUniqueViolation(e)) fail(`Delivery ${d.reference} from this supplier is already recorded.`, 409);
    throw e;
  }
  try {
    if (d.packages.length) {
      await db.insert(expectedDeliveryPackages).values(d.packages.map(p => ({ orgId, expectedDeliveryId: header.id, sscc: p.sscc, packType: p.packType, parentSscc: p.parentSscc })));
    }
    await db.insert(expectedDeliveryLines).values(d.lines.map(l => ({
      orgId, expectedDeliveryId: header.id, lineNo: l.lineNo, poLineId: l.poLineId, itemId: l.itemId, qtyBase: l.qtyBase.toFixed(6),
      sscc: l.sscc, supplierBatchNo: l.supplierBatchNo, productionDate: l.productionDate, bestBeforeDate: l.bestBeforeDate, expiryDate: l.expiryDate,
    })));
  } catch (e) {
    await db.delete(expectedDeliveries).where(and(eq(expectedDeliveries.id, header.id), eq(expectedDeliveries.orgId, orgId)));
    console.error("[expected-delivery] lines or packages failed to save; delivery removed", { orgId, id: header.id, e });
    throw e;
  }
  return { ...header, state: "expected" as DeliveryState };
}

/** Deliveries, newest first, optionally for one PO and/or in one state. */
export async function listExpectedDeliveries(orgId: string, opts: { poId?: string | null; state?: DeliveryState | null } = {}) {
  const where = [eq(expectedDeliveries.orgId, orgId)];
  if (opts.poId) where.push(eq(expectedDeliveries.poId, opts.poId));
  if (opts.state === "cancelled") where.push(eq(expectedDeliveries.status, "cancelled"));
  if (opts.state === "expected") where.push(ne(expectedDeliveries.status, "cancelled"), isNull(expectedDeliveries.goodsReceiptId));
  if (opts.state === "received") where.push(ne(expectedDeliveries.status, "cancelled"), isNotNull(expectedDeliveries.goodsReceiptId));
  const rows = await db.select({
    d: expectedDeliveries, supplierName: parties.name, poNumber: tradeDocuments.docNumber, receiptNo: goodsReceipts.receiptNo,
  }).from(expectedDeliveries)
    .leftJoin(parties, eq(parties.id, expectedDeliveries.supplierId))
    .leftJoin(tradeDocuments, eq(tradeDocuments.id, expectedDeliveries.poId))
    .leftJoin(goodsReceipts, eq(goodsReceipts.id, expectedDeliveries.goodsReceiptId))
    .where(and(...where)).orderBy(desc(expectedDeliveries.createdAt)).limit(200);
  if (!rows.length) return [];
  const ids = rows.map(r => r.d.id);
  const [lines, pkgs] = await Promise.all([
    db.select({ deliveryId: expectedDeliveryLines.expectedDeliveryId, poLineId: expectedDeliveryLines.poLineId, itemId: expectedDeliveryLines.itemId,
      itemName: apItems.name, baseUom: apItems.baseUom, qtyBase: expectedDeliveryLines.qtyBase, sscc: expectedDeliveryLines.sscc,
      supplierBatchNo: expectedDeliveryLines.supplierBatchNo, productionDate: expectedDeliveryLines.productionDate,
      bestBeforeDate: expectedDeliveryLines.bestBeforeDate, expiryDate: expectedDeliveryLines.expiryDate, lineNo: expectedDeliveryLines.lineNo })
      .from(expectedDeliveryLines).leftJoin(apItems, eq(apItems.id, expectedDeliveryLines.itemId))
      .where(and(eq(expectedDeliveryLines.orgId, orgId), inArray(expectedDeliveryLines.expectedDeliveryId, ids))).orderBy(asc(expectedDeliveryLines.lineNo)),
    db.select().from(expectedDeliveryPackages)
      .where(and(eq(expectedDeliveryPackages.orgId, orgId), inArray(expectedDeliveryPackages.expectedDeliveryId, ids))),
  ]);
  return rows.map(r => ({
    ...r.d, supplierName: r.supplierName, poNumber: r.poNumber, receiptNo: r.receiptNo, state: deliveryState(r.d),
    lines: lines.filter(l => l.deliveryId === r.d.id).map(({ deliveryId: _d, ...l }) => ({ ...l, qtyBase: Number(l.qtyBase) })),
    packages: pkgs.filter(p => p.expectedDeliveryId === r.d.id).map(p => ({ sscc: p.sscc, packType: p.packType, parentSscc: p.parentSscc })),
  }));
}

async function loadDelivery(orgId: string, id: string) {
  const [d] = await db.select().from(expectedDeliveries).where(and(eq(expectedDeliveries.id, id), eq(expectedDeliveries.orgId, orgId))).limit(1);
  if (!d) fail("Expected delivery not found.", 404);
  return d!;
}

/** Cancel (the supplier withdrew it) or reopen. A received delivery is neither: it already became a receipt. */
export async function setDeliveryCancelled(orgId: string, id: string, cancelled: boolean) {
  const d = await loadDelivery(orgId, id);
  if (d.goodsReceiptId) fail("This delivery has been received. Void the receipt first to change it.", 409);
  try {
    const [row] = await db.update(expectedDeliveries).set({ status: cancelled ? "cancelled" : "open", updatedAt: new Date() })
      .where(and(eq(expectedDeliveries.id, id), eq(expectedDeliveries.orgId, orgId))).returning();
    return { ...row, state: deliveryState(row) };
  } catch (e) {
    if (isUniqueViolation(e)) fail(`Another delivery from this supplier is already open under ${d.reference}.`, 409);
    throw e;
  }
}

/** Delete one that was recorded by mistake. A received delivery stays: it is what the receipt was counted from. */
export async function deleteExpectedDelivery(orgId: string, id: string) {
  const d = await loadDelivery(orgId, id);
  if (d.goodsReceiptId) fail("This delivery has been received and is kept with its receipt. Void the receipt first.", 409);
  await db.delete(expectedDeliveries).where(and(eq(expectedDeliveries.id, id), eq(expectedDeliveries.orgId, orgId)));
}

/**
 * Before a receipt posts against a delivery: it must still be expected and,
 * when it names a PO, the receipt must receive against that PO. Checked first
 * so a receipt never posts with a link that is then refused.
 */
export async function checkDeliveryForReceipt(orgId: string, id: string, receiptPoIds: string[]) {
  const d = await loadDelivery(orgId, id);
  const state = deliveryState(d);
  if (state !== "expected") fail(state === "received" ? "That delivery has already been received." : "That delivery was cancelled.", 409);
  if (d.poId && !receiptPoIds.includes(d.poId)) fail("That delivery is for a different purchase order.");
  return d;
}

/**
 * Mark the delivery received by this receipt. Only an open, unreceived
 * delivery is changed (the WHERE makes a second receipt a no-op); a miss is
 * logged, never allowed to fail a receipt that has already posted.
 */
export async function attachReceipt(orgId: string, id: string, receiptId: string) {
  const r = await db.update(expectedDeliveries).set({ goodsReceiptId: receiptId, updatedAt: new Date() })
    .where(and(eq(expectedDeliveries.id, id), eq(expectedDeliveries.orgId, orgId), ne(expectedDeliveries.status, "cancelled"), isNull(expectedDeliveries.goodsReceiptId)))
    .returning({ id: expectedDeliveries.id });
  if (!r.length) console.error("[expected-delivery] receipt posted but the delivery could not be marked received", { orgId, id, receiptId });
  return r.length > 0;
}

/** The SSCCs announced by the delivery (or deliveries) this receipt was counted from. */
export async function expectedSsccsForReceipt(orgId: string, receiptId: string): Promise<{ deliveries: { id: string; reference: string | null }[]; ssccs: string[] }> {
  const ds = await db.select({ id: expectedDeliveries.id, reference: expectedDeliveries.reference }).from(expectedDeliveries)
    .where(and(eq(expectedDeliveries.orgId, orgId), eq(expectedDeliveries.goodsReceiptId, receiptId)));
  if (!ds.length) return { deliveries: [], ssccs: [] };
  const pkgs = await db.select({ sscc: expectedDeliveryPackages.sscc }).from(expectedDeliveryPackages)
    .where(and(eq(expectedDeliveryPackages.orgId, orgId), inArray(expectedDeliveryPackages.expectedDeliveryId, ds.map(d => d.id))));
  return { deliveries: ds, ssccs: [...new Set(pkgs.map(p => p.sscc))] };
}
