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
import { ediMessages, ediPartners, tradeDocuments, tradeDocumentLines, apItems } from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";
import { readInterchange } from "@/lib/edi/x12/read";
import { parse850 } from "@/lib/edi/x12/inbound";
import { buildOrderAck, type SoAckFacts, type AckProblem } from "@/lib/edi/build/sales-order";
import { write855 } from "@/lib/edi/x12/855";
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
  logEvent({ orgId, eventType: "edi_generated", docType: "trade", docId: o.appDocId, actorId: o.actorId, meta: { messageId: row.id, docType: o.docType, controlNo: o.controlNo, test: row.test } })
    .catch(e => console.error("[audit] edi_generated failed:", e));
  return row;
}

const safe = (s: string | null, fallback: string) => (s || fallback).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);

/** The Sales Order's facts for an 855, with what the customer ordered read back from the 850 it was made from. */
async function loadSoAckFacts(orgId: string, soId: string): Promise<(SoAckFacts & { customerId: string | null; docNumber: string | null }) | null> {
  const [so] = await db.select().from(tradeDocuments).where(and(eq(tradeDocuments.id, soId), eq(tradeDocuments.orgId, orgId))).limit(1);
  if (!so || so.kind !== "SalesOrder") return null;
  const lines = await db.select({ l: tradeDocumentLines, baseUom: apItems.baseUom }).from(tradeDocumentLines)
    .leftJoin(apItems, eq(apItems.id, tradeDocumentLines.itemId))
    .where(and(eq(tradeDocumentLines.documentId, soId), eq(tradeDocumentLines.orgId, orgId))).orderBy(tradeDocumentLines.lineNo);

  let theirs: SoAckFacts["theirs"] = null;
  const [inbound] = await db.select({ payload: ediMessages.payload }).from(ediMessages)
    .where(and(eq(ediMessages.orgId, orgId), eq(ediMessages.direction, "in"), eq(ediMessages.appDocType, "SalesOrder"), eq(ediMessages.appDocId, soId), eq(ediMessages.docType, "850")))
    .orderBy(desc(ediMessages.createdAt)).limit(1);
  if (inbound) {
    const txn = readInterchange(inbound.payload).groups.flatMap(g => g.txns).find(t => t.setId === "850" && parse850(t.segments).poNumber.toUpperCase() === (so.partyRef ?? "").trim().toUpperCase());
    if (txn) {
      const o = parse850(txn.segments);
      theirs = o.lines.map(l => ({ lineNo: l.lineNo, qty: l.qty, unit: l.unit, price: l.price, requestedDate: o.requestedDate }));
    }
  }
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
