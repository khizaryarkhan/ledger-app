/**
 * GET /api/inventory/delivery-performance?side=supplier|customer&from=&to=
 *
 * On time / in full per supplier (PO lines vs goods receipts) or per customer
 * (SO lines vs shipments), for orders issued in [from, to]. Each line is
 * measured against its promised date, else its requested date (0114), by the
 * rules in lib/inventory/delivery-performance.ts. Read-only.
 */

import { db } from "@/db";
import { tradeDocuments, tradeDocumentLines, goodsReceipts, goodsReceiptLines, salesShipments, shipmentLines, apItems } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, gte, lte, inArray, sql } from "drizzle-orm";
import { localToday } from "@/lib/format";
import { classifyLineDelivery, lineDueDate, scoreParty, daysBetween, isIsoDate, confirmationStatus } from "@/lib/inventory/delivery-performance";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const q = new URL(req.url).searchParams;
  const side = q.get("side") === "customer" ? "customer" : "supplier";
  const from = q.get("from"), to = q.get("to");
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) return bad("from/to must be YYYY-MM-DD");
  const asOf = isIsoDate(q.get("asOf")) ? q.get("asOf")! : localToday();

  const kind = side === "customer" ? "SalesOrder" : "PurchaseOrder";
  const docs = await db.select().from(tradeDocuments).where(and(
    eq(tradeDocuments.orgId, orgId!), eq(tradeDocuments.kind, kind),
    ...(from ? [gte(tradeDocuments.issueDate, from)] : []), ...(to ? [lte(tradeDocuments.issueDate, to)] : []),
  ));
  if (!docs.length) return ok({ side, asOf, parties: [], lines: [] });
  const docById = new Map(docs.map(d => [d.id, d]));
  const lines = await db.select().from(tradeDocumentLines)
    .where(and(eq(tradeDocumentLines.orgId, orgId!), inArray(tradeDocumentLines.documentId, docs.map(d => d.id))));
  const stocked = lines.filter(l => l.itemId && Number(l.orderedBaseQty) > 0);
  if (!stocked.length) return ok({ side, asOf, parties: [], lines: [] });
  const lineIds = stocked.map(l => l.id);

  // Delivered qty and dates per order line, from POSTED receipts / shipments only.
  const deliveries = side === "customer"
    ? await db.select({ lineId: shipmentLines.soLineId, qty: sql<string>`sum(${shipmentLines.qtyBase})`, first: sql<string>`min(${salesShipments.shipmentDate})::text`, last: sql<string>`max(${salesShipments.shipmentDate})::text` })
        .from(shipmentLines).innerJoin(salesShipments, eq(salesShipments.id, shipmentLines.shipmentId))
        .where(and(eq(shipmentLines.orgId, orgId!), eq(salesShipments.status, "Posted"), inArray(shipmentLines.soLineId, lineIds)))
        .groupBy(shipmentLines.soLineId)
    : await db.select({ lineId: goodsReceiptLines.poLineId, qty: sql<string>`sum(${goodsReceiptLines.qtyBase})`, first: sql<string>`min(${goodsReceipts.receiptDate})::text`, last: sql<string>`max(${goodsReceipts.receiptDate})::text` })
        .from(goodsReceiptLines).innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.receiptId))
        .where(and(eq(goodsReceiptLines.orgId, orgId!), eq(goodsReceipts.status, "Posted"), inArray(goodsReceiptLines.poLineId, lineIds)))
        .groupBy(goodsReceiptLines.poLineId);
  const delBy = new Map(deliveries.map(d => [d.lineId, d]));
  const items = await db.select({ id: apItems.id, name: apItems.name }).from(apItems)
    .where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, [...new Set(stocked.map(l => l.itemId!))])));
  const itemName = new Map(items.map(i => [i.id, i.name]));

  const detail = stocked.map(l => {
    const doc = docById.get(l.documentId)!;
    const d = delBy.get(l.id);
    const due = lineDueDate(l) ?? (isIsoDate(doc.promisedDate) ? doc.promisedDate : isIsoDate(doc.expiryDate) ? doc.expiryDate : null);
    const originalDue = l.originalPromisedDate ?? l.requestedDate ?? due;
    const r = classifyLineDelivery({
      orderedQty: Number(l.orderedBaseQty), deliveredQty: Number(d?.qty ?? 0),
      lastDeliveryDate: d?.last ?? null, dueDate: due, originalDueDate: originalDue,
      closed: l.closed, asOf,
    });
    const leadTimeActual = r.complete && d?.last ? daysBetween(doc.issueDate, d.last) : null;
    return {
      lineId: l.id, docId: doc.id, docNumber: doc.docNumber, partyId: doc.partyId, partyLabel: doc.partyLabel ?? "—",
      partyRef: doc.partyRef, confirmation: confirmationStatus(doc),
      item: itemName.get(l.itemId!) ?? l.description ?? "—",
      orderDate: doc.issueDate, requestedDate: l.requestedDate, promisedDate: l.promisedDate,
      originalPromisedDate: l.originalPromisedDate, promiseRevisions: l.promiseRevisions,
      orderedQty: Number(l.orderedBaseQty), deliveredQty: Number(d?.qty ?? 0),
      firstDelivery: d?.first ?? null, lastDelivery: d?.last ?? null,
      ...r, leadTimeActual,
    };
  });

  const byParty = new Map<string, typeof detail>();
  for (const x of detail) {
    const k = x.partyId ?? x.partyLabel;
    byParty.set(k, [...(byParty.get(k) ?? []), x]);
  }
  const partyRows = [...byParty.values()].map(rows => ({
    partyId: rows[0].partyId, partyLabel: rows[0].partyLabel,
    unconfirmedOrders: new Set(rows.filter(x => x.confirmation !== "Confirmed" && !x.complete).map(x => x.docId)).size,
    ...scoreParty(rows.map(x => ({ r: x, leadTimeActual: x.leadTimeActual, revisions: x.promiseRevisions }))),
  })).sort((a, b) => (a.otifPct ?? 101) - (b.otifPct ?? 101) || a.partyLabel.localeCompare(b.partyLabel));

  const overall = scoreParty(detail.map(x => ({ r: x, leadTimeActual: x.leadTimeActual, revisions: x.promiseRevisions })));
  return ok({ side, asOf, overall, parties: partyRows, lines: detail });
}
