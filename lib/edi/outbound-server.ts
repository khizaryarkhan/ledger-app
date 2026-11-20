/**
 * EDI Phase 3, the outbound half for the sales cycle: our 855 (order
 * acknowledgement) from a confirmed Sales Order. Kept like every outbound file:
 * validated in full BEFORE a control number is taken, the payload and its
 * sha256 stored, delivered by a person (download, deliver, mark sent). An
 * earlier file for the same document that was never sent is voided as
 * superseded. Nothing here posts stock or ledger. Pure rules: build/sales-order.ts,
 * x12/855.ts.
 */

import { createHash } from "node:crypto";
import { db } from "@/db";
import { ediMessages, ediPartners, tradeDocuments, tradeDocumentLines, apItems, organisations, salesShipments, shipmentLines, shipmentPackages, shipmentPackageLines, partyShipTo, itemPartNumbers, itemIdentifiers } from "@/db/schema";
import { and, eq, desc, inArray, isNull } from "drizzle-orm";
import { readInterchange } from "@/lib/edi/x12/read";
import { parse850 } from "@/lib/edi/x12/inbound";
import { buildOrderAck, type SoAckFacts, type AckProblem } from "@/lib/edi/build/sales-order";
import { write855 } from "@/lib/edi/x12/855";
import { write856 } from "@/lib/edi/x12/856";
import { buildShipNotice, type ShipFacts } from "@/lib/edi/build/shipment";
import { partNumberForLevel, partNumbersByLevel } from "@/lib/inventory/part-numbers";
import { EdiError, allocateControlNo, utcStamp, partnerForParty, listMessages } from "@/lib/edi/edi-server";
import { logEvent } from "@/lib/audit";
import type { Envelope } from "@/lib/edi/x12/envelope";

type Partner = typeof ediPartners.$inferSelect;
const fail = (m: string, status = 400, problems?: AckProblem[]): never => { throw new EdiError(m, status, problems); };

/** The envelope for a file to this partner: its IDs and version, test unless it is set to live. */
export function envelopeFor(partner: Partner, controlNo: number): Envelope {
  return {
    version: partner.version as "004010" | "005010", test: partner.mode !== "live",
    senderQualifier: partner.senderQualifier, senderId: partner.senderId, receiverQualifier: partner.receiverQualifier, receiverId: partner.receiverId,
    senderAppId: partner.senderAppId || partner.senderId, receiverAppId: partner.receiverAppId || partner.receiverId,
    controlNo, now: utcStamp(),
  };
}

/** Store one generated outbound file. An unsent earlier file for the same document and type is voided as superseded. */
export async function keepOutbound(orgId: string, partner: Partner, o: {
  docType: string; appDocType: string; appDocId: string; appDocNumber: string | null; fileName: string; payload: string; controlNo: number; actorId: string | null;
}) {
  await db.update(ediMessages).set({ status: "void", voidReason: `Superseded by interchange ${o.controlNo}` })
    .where(and(eq(ediMessages.orgId, orgId), eq(ediMessages.appDocId, o.appDocId), eq(ediMessages.partnerId, partner.id),
      eq(ediMessages.direction, "out"), eq(ediMessages.docType, o.docType), eq(ediMessages.status, "generated")));
  const [row] = await db.insert(ediMessages).values({
    orgId, partnerId: partner.id, partyId: partner.partyId, direction: "out", docType: o.docType, standard: "x12",
    version: partner.version, test: partner.mode !== "live", status: "generated",
    interchangeNo: o.controlNo, groupNo: o.controlNo, txnNo: "0001",
    appDocType: o.appDocType, appDocId: o.appDocId, appDocNumber: o.appDocNumber,
    fileName: o.fileName, payload: o.payload, payloadSha256: createHash("sha256").update(o.payload).digest("hex"), createdBy: o.actorId,
  }).returning({ id: ediMessages.id, fileName: ediMessages.fileName, interchangeNo: ediMessages.interchangeNo, status: ediMessages.status, test: ediMessages.test });
  const isTrade = o.appDocType === "SalesOrder" || o.appDocType === "PurchaseOrder";
  logEvent({ orgId, eventType: "edi_generated", docType: isTrade ? "trade" : null, docId: isTrade ? o.appDocId : null, actorId: o.actorId, meta: { messageId: row.id, docType: o.docType, appDocType: o.appDocType, appDocId: o.appDocId, controlNo: o.controlNo, test: row.test } })
    .catch(e => console.error("[audit] edi_generated failed:", e));
  return row;
}

const safe = (s: string | null, fallback: string) => (s || fallback).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);

/** What the customer ordered, read back from the stored 850 this Sales Order was created from; null for an order keyed by hand. */
async function theirOrder(orgId: string, soId: string, partyRef: string | null) {
  const [inbound] = await db.select({ payload: ediMessages.payload }).from(ediMessages)
    .where(and(eq(ediMessages.orgId, orgId), eq(ediMessages.direction, "in"), eq(ediMessages.appDocType, "SalesOrder"), eq(ediMessages.appDocId, soId), eq(ediMessages.docType, "850")))
    .orderBy(desc(ediMessages.createdAt)).limit(1);
  if (!inbound) return null;
  const want = (partyRef ?? "").trim().toUpperCase();
  const txn = readInterchange(inbound.payload).groups.flatMap(g => g.txns).find(t => t.setId === "850" && parse850(t.segments).poNumber.toUpperCase() === want);
  return txn ? parse850(txn.segments) : null;
}

/** The Sales Order's facts for an 855, with what the customer ordered read back from the 850 it was made from. */
async function loadSoAckFacts(orgId: string, soId: string): Promise<(SoAckFacts & { customerId: string | null; docNumber: string | null }) | null> {
  const [so] = await db.select().from(tradeDocuments).where(and(eq(tradeDocuments.id, soId), eq(tradeDocuments.orgId, orgId))).limit(1);
  if (!so || so.kind !== "SalesOrder") return null;
  const lines = await db.select({ l: tradeDocumentLines, baseUom: apItems.baseUom }).from(tradeDocumentLines)
    .leftJoin(apItems, eq(apItems.id, tradeDocumentLines.itemId))
    .where(and(eq(tradeDocumentLines.documentId, soId), eq(tradeDocumentLines.orgId, orgId))).orderBy(tradeDocumentLines.lineNo);

  const their = await theirOrder(orgId, soId, so.partyRef);
  const theirs: SoAckFacts["theirs"] = their ? their.lines.map(l => ({ lineNo: l.lineNo, qty: l.qty, unit: l.unit, price: l.price, requestedDate: their.requestedDate })) : null;
  return {
    customerId: so.partyId, docNumber: so.docNumber,
    so: { docNumber: so.docNumber, partyRef: so.partyRef, issueDate: so.issueDate, currency: so.currency, confirmed: !!so.confirmedAt, promisedDate: so.promisedDate ?? null },
    lines: lines.map(({ l, baseUom }) => ({ lineNo: l.lineNo, orderUom: l.orderUom, baseUom, qty: Number(l.qty ?? 0), rate: Number(l.rate ?? 0),
      promisedDate: l.promisedDate ?? null, requestedDate: l.requestedDate ?? null, closed: !!l.closed })),
    theirs,
  };
}

/** Can this Sales Order be acknowledged by EDI, and what has been sent. */
export async function checkSalesOrderAck(orgId: string, soId: string) {
  const facts = await loadSoAckFacts(orgId, soId);
  if (!facts) fail("Sales order not found.", 404);
  const partner = await partnerForParty(orgId, facts!.customerId);
  const messages = (await listMessages(orgId, { appDocId: soId })).filter(m => m.direction === "out");
  if (!partner) return { partner: null, problems: [{ lineNo: null, message: "This customer has no EDI profile. Set one up in Supply Chain → EDI." }] as AckProblem[], messages };
  const built = buildOrderAck(facts!, partner.unitOverrides as Record<string, string>);
  const problems: AckProblem[] = built.ok === false ? [...built.problems] : [];
  if (!partner.enabled) problems.unshift({ lineNo: null, message: "This partner's EDI profile is switched off." });
  if (!(partner.docsOut as string[]).includes("855")) problems.unshift({ lineNo: null, message: "Order acknowledgements (855) are not switched on for this partner." });
  return { partner: { id: partner.id, mode: partner.mode, version: partner.version, receiverId: partner.receiverId, transport: partner.transport }, problems, messages };
}

export async function generateSalesOrderAck855(orgId: string, soId: string, actorId: string | null) {
  const facts = await loadSoAckFacts(orgId, soId);
  if (!facts) fail("Sales order not found.", 404);
  const partner = await partnerForParty(orgId, facts!.customerId);
  if (!partner) fail("This customer has no EDI profile. Set one up in Supply Chain → EDI.");
  if (!partner!.enabled) fail("This partner's EDI profile is switched off.");
  if (!(partner!.docsOut as string[]).includes("855")) fail("Order acknowledgements (855) are not switched on for this partner.");
  const built = buildOrderAck(facts!, partner!.unitOverrides as Record<string, string>);
  if (built.ok === false) fail("The order cannot be acknowledged by EDI yet.", 422, built.problems as any);
  const controlNo = await allocateControlNo(orgId, partner!.id);
  const payload = write855((built as { ok: true; ack: any }).ack, envelopeFor(partner!, controlNo));
  return keepOutbound(orgId, partner!, {
    docType: "855", appDocType: "SalesOrder", appDocId: soId, appDocNumber: facts!.docNumber,
    fileName: `855_${safe(facts!.docNumber, soId.slice(0, 8))}_${String(controlNo).padStart(9, "0")}.x12`, payload, controlNo, actorId,
  });
}

/* ----------------------------- 856: shipments ----------------------------- */

/** A posted shipment's facts for an 856: its orders (with THEIR line numbers), packing, and the part numbers and GTINs to print. */
async function loadShipmentFacts(orgId: string, shipmentId: string): Promise<(ShipFacts & { customerId: string | null; orderCustomers: (string | null)[] }) | null> {
  const [sh] = await db.select().from(salesShipments).where(and(eq(salesShipments.id, shipmentId), eq(salesShipments.orgId, orgId))).limit(1);
  if (!sh) return null;
  const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName, gln: organisations.gln }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const lines = await db.select().from(shipmentLines).where(and(eq(shipmentLines.shipmentId, shipmentId), eq(shipmentLines.orgId, orgId))).orderBy(shipmentLines.createdAt);
  const pkgs = await db.select().from(shipmentPackages).where(and(eq(shipmentPackages.shipmentId, shipmentId), eq(shipmentPackages.orgId, orgId))).orderBy(shipmentPackages.createdAt);
  const contents = pkgs.length ? await db.select().from(shipmentPackageLines).where(and(eq(shipmentPackageLines.orgId, orgId), inArray(shipmentPackageLines.packageId, pkgs.map(p => p.id)))) : [];

  const soIds = [...new Set(lines.map(l => l.soId).filter(Boolean) as string[])];
  const sos = soIds.length ? await db.select().from(tradeDocuments).where(and(eq(tradeDocuments.orgId, orgId), eq(tradeDocuments.kind, "SalesOrder"), inArray(tradeDocuments.id, soIds))) : [];
  const soLines = soIds.length ? await db.select({ l: tradeDocumentLines, baseUom: apItems.baseUom, code: apItems.code }).from(tradeDocumentLines)
    .leftJoin(apItems, eq(apItems.id, tradeDocumentLines.itemId)).where(and(eq(tradeDocumentLines.orgId, orgId), inArray(tradeDocumentLines.documentId, soIds))) : [];
  const shipToIds = sos.map(s => s.customerShipToId).filter(Boolean) as string[];
  const shipTos = shipToIds.length ? await db.select().from(partyShipTo).where(and(eq(partyShipTo.orgId, orgId), inArray(partyShipTo.id, shipToIds))) : [];

  const orders: ShipFacts["orders"] = [];
  for (const so of sos) {
    const their = await theirOrder(orgId, so.id, so.partyRef);
    const st = shipTos.find(x => x.id === so.customerShipToId);
    orders.push({
      soId: so.id, poNumber: so.partyRef, poDate: so.issueDate,
      shipTo: st ? { name: st.name, gln: st.gln ?? null, code: st.code ?? null } : null,
      soLines: soLines.filter(x => x.l.documentId === so.id).map(x => ({ id: x.l.id, lineNo: x.l.lineNo, orderUom: x.l.orderUom, baseUom: x.baseUom, unitsPerOrderUnit: Number(x.l.unitsPerOrderUnit || 1), itemCode: x.code })),
      theirs: their ? their.lines.map(l => ({ lineNo: l.lineNo, unit: l.unit })) : null,
    });
  }

  // THEIR part number and a GTIN for the pack level each line was ordered at (exact level only: never the unit code for a carton).
  const customerId = sh.customerId;
  const itemIds = [...new Set(soLines.map(x => x.l.itemId).filter(Boolean) as string[])];
  const partRows = itemIds.length && customerId ? await db.select().from(itemPartNumbers).where(and(eq(itemPartNumbers.orgId, orgId), eq(itemPartNumbers.partyId, customerId), eq(itemPartNumbers.side, "customer"), inArray(itemPartNumbers.itemId, itemIds))) : [];
  const idRows = itemIds.length ? await db.select().from(itemIdentifiers).where(and(eq(itemIdentifiers.orgId, orgId), eq(itemIdentifiers.scheme, "GTIN"), isNull(itemIdentifiers.supplierSkuId), inArray(itemIdentifiers.itemId, itemIds))) : [];
  const parts: ShipFacts["parts"] = {};
  for (const l of lines) {
    const ol = soLines.find(x => x.l.id === l.soLineId)?.l;
    if (!ol?.itemId) continue;
    const sku = ol.skuId ?? null;
    const bp = partNumberForLevel(partNumbersByLevel(partRows.filter(r => r.itemId === ol.itemId && (r.itemSkuId ?? null) === sku)), ol.packLevel);
    const gtin = partNumberForLevel(partNumbersByLevel(idRows.filter(r => r.itemId === ol.itemId && (r.itemSkuId ?? null) === sku)), ol.packLevel);
    parts[l.id] = { bp, gtin };
  }

  const [sent] = await db.select({ id: ediMessages.id }).from(ediMessages)
    .where(and(eq(ediMessages.orgId, orgId), eq(ediMessages.direction, "out"), eq(ediMessages.docType, "856"), eq(ediMessages.appDocId, shipmentId), eq(ediMessages.status, "sent"))).limit(1);
  return {
    customerId, orderCustomers: sos.map(s => s.partyId),
    shipment: { shipmentNo: sh.shipmentNo, shipDate: sh.shipmentDate, carrier: sh.carrier, trackingNo: sh.trackingNo, posted: sh.status === "Posted" },
    shipFrom: { name: org?.displayName || org?.name || "", gln: org?.gln ?? null },
    lines: lines.map(l => ({ id: l.id, soId: l.soId, soLineId: l.soLineId, qtyBase: Number(l.qtyBase) })),
    orders, parts,
    packages: pkgs.map(p => ({ id: p.id, sscc: p.sscc, parentId: p.parentId, packType: p.packType, lines: contents.filter(c => c.packageId === p.id).map(c => ({ shipmentLineId: c.shipmentLineId, qtyBase: Number(c.qtyBase) })) })),
    replaces: !!sent,
  };
}

/** Can this shipment be advised by EDI (856), and what has been sent. */
export async function checkShipmentAsn(orgId: string, shipmentId: string) {
  const facts = await loadShipmentFacts(orgId, shipmentId);
  if (!facts) fail("Shipment not found.", 404);
  const partner = await partnerForParty(orgId, facts!.customerId);
  const messages = (await listMessages(orgId, { appDocId: shipmentId })).filter(m => m.direction === "out");
  if (!partner) return { partner: null, problems: [{ lineNo: null, message: "This customer has no EDI profile. Set one up in Supply Chain → EDI." }] as AckProblem[], messages };
  const built = buildShipNotice(facts!, partner.unitOverrides as Record<string, string>);
  const problems: AckProblem[] = built.ok === false ? [...built.problems] : [];
  if (facts!.orderCustomers.some(c => c !== partner.partyId)) problems.unshift({ lineNo: null, message: "A line is for another customer's order." });
  if (!partner.enabled) problems.unshift({ lineNo: null, message: "This partner's EDI profile is switched off." });
  if (!(partner.docsOut as string[]).includes("856")) problems.unshift({ lineNo: null, message: "Ship notices (856) are not switched on for this partner." });
  return { partner: { id: partner.id, mode: partner.mode, version: partner.version, receiverId: partner.receiverId, transport: partner.transport }, problems, messages };
}

export async function generateShipmentAsn856(orgId: string, shipmentId: string, actorId: string | null) {
  const facts = await loadShipmentFacts(orgId, shipmentId);
  if (!facts) fail("Shipment not found.", 404);
  const partner = await partnerForParty(orgId, facts!.customerId);
  if (!partner) fail("This customer has no EDI profile. Set one up in Supply Chain → EDI.");
  if (!partner!.enabled) fail("This partner's EDI profile is switched off.");
  if (!(partner!.docsOut as string[]).includes("856")) fail("Ship notices (856) are not switched on for this partner.");
  if (facts!.orderCustomers.some(c => c !== partner!.partyId)) fail("A line is for another customer's order.", 422);
  const built = buildShipNotice(facts!, partner!.unitOverrides as Record<string, string>);
  if (built.ok === false) fail("The shipment cannot be advised by EDI yet.", 422, built.problems as any);
  const controlNo = await allocateControlNo(orgId, partner!.id);
  const payload = write856((built as { ok: true; asn: any }).asn, envelopeFor(partner!, controlNo));
  return keepOutbound(orgId, partner!, {
    docType: "856", appDocType: "Shipment", appDocId: shipmentId, appDocNumber: facts!.shipment.shipmentNo,
    fileName: `856_${safe(facts!.shipment.shipmentNo, shipmentId.slice(0, 8))}_${String(controlNo).padStart(9, "0")}.x12`, payload, controlNo, actorId,
  });
}
