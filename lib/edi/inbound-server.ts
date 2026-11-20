/**
 * EDI Phase 2, inbound: a file the partner sent, uploaded by a person (manual
 * transport). Pure rules: lib/edi/x12/read.ts, x12/inbound.ts, inbound.ts.
 *
 * 1. Read it on its own separators; refuse a file whose envelope does not add up.
 * 2. Find the partner from the ISA IDs (their ID → our ID). No guessing.
 * 3. Store it FIRST: the unique (partner, direction, interchange_no) index makes
 *    a replayed file a no-op that returns the first upload's result.
 * 4. Act on each transaction set: 997 → the answered outbound file's
 *    acknowledgement; 855 → the supplier-response path the portal uses (a
 *    change is stored for a person, never applied); 856 → an expected delivery
 *    per order (source "asn"), which Receiving fills in from. Anything else, or
 *    anything unclear, is "review" with the reason in words.
 *
 * Nothing here posts stock or ledger (tests/edi-x12.test.ts).
 */

import { createHash } from "node:crypto";
import { db } from "@/db";
import { ediPartners, ediMessages, tradeDocuments, tradeDocumentLines, apItems, expectedDeliveries, goodsReceipts, goodsReceiptLines, apBills, organisations } from "@/db/schema";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { readInterchange, X12ReadError } from "@/lib/edi/x12/read";
import { parse997, parse855, parse856, parse810 } from "@/lib/edi/x12/inbound";
import { ackToResponse, asnOrderToDelivery, asnPurpose, asnReference, invoiceToBill, type BillProposal, type InvoiceMatchLine, type InvoiceReceipt, type InvoiceOutcome } from "@/lib/edi/inbound";
import { createExpectedDelivery, setDeliveryCancelled, deleteExpectedDelivery, expectedDeliveryErrorOf } from "@/lib/inventory/expected-delivery-server";
import { x12UnitFor } from "@/lib/edi/validate";
import { recordSupplierResponse } from "@/lib/accounting/po-supplier-server";
import { LedgerValidationError } from "@/lib/ledger";
import { EdiError, allocateControlNo, utcStamp } from "@/lib/edi/edi-server";
import { write997 } from "@/lib/edi/x12/997";
import { apply850 } from "@/lib/edi/inbound-order-server";
import { logEvent } from "@/lib/audit";

const MAX_BYTES = 2_000_000;
const isUniqueViolation = (e: any) => e?.code === "23505" || /duplicate key|unique constraint/i.test(String(e?.message ?? ""));

type Partner = typeof ediPartners.$inferSelect;
export type TxnResult = {
  setId: string; controlNo: string; outcome: "applied" | "review" | "ignored"; summary: string; reasons: string[]; poId?: string | null;
  /** 850 only: the Sales Order created from (or already standing for) the customer's order. */
  soId?: string | null;
  /** 810 only: the bill a person may create, the line-by-line match, and the bill once created. */
  proposal?: BillProposal | null; match?: InvoiceMatchLine[]; bill?: { entryId: string; docNumber: string | null } | null;
};

/** Upload one file. Returns the stored message and what was done with each transaction set. */
export async function receiveEdiFile(orgId: string, content: string, fileName: string, actorId: string | null) {
  if (!content?.trim()) throw new EdiError("The file is empty.");
  if (Buffer.byteLength(content, "utf8") > MAX_BYTES) throw new EdiError("The file is larger than 2 MB.");
  let ixn: ReturnType<typeof readInterchange>;
  try { ixn = readInterchange(content); }
  catch (e) { if (e instanceof X12ReadError) throw new EdiError(`This file could not be read: ${e.message}`); throw e; }

  const partners = await db.select().from(ediPartners).where(eq(ediPartners.orgId, orgId));
  const norm = (s: string) => s.trim().toUpperCase();
  const partner = partners.find(p => norm(p.receiverId) === norm(ixn.senderId) && norm(p.senderId) === norm(ixn.receiverId));
  if (!partner) throw new EdiError(`No EDI partner sends as ${ixn.senderQualifier}:${ixn.senderId} to ${ixn.receiverQualifier}:${ixn.receiverId}. Check the partner's interchange IDs in Partners.`, 404);

  const setIds = [...new Set(ixn.groups.flatMap(g => g.txns.map(t => t.setId)))];
  const firstGroup = ixn.groups[0];
  let row;
  try {
    [row] = await db.insert(ediMessages).values({
      orgId, partnerId: partner.id, partyId: partner.partyId, direction: "in",
      docType: (setIds.length === 1 ? setIds[0] : "mixed").slice(0, 8), standard: "x12",
      version: (firstGroup?.version || partner.version).slice(0, 8), test: ixn.test, status: "received",
      interchangeNo: ixn.controlNo, groupNo: firstGroup?.controlNo ?? 0, txnNo: (firstGroup?.txns[0]?.controlNo ?? "").slice(0, 9),
      fileName: (fileName || `inbound_${ixn.controlNo}.x12`).slice(0, 128), payload: content,
      payloadSha256: createHash("sha256").update(content).digest("hex"), createdBy: actorId,
    }).returning();
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    const [first] = await db.select().from(ediMessages).where(and(eq(ediMessages.partnerId, partner.id), eq(ediMessages.direction, "in"), eq(ediMessages.interchangeNo, ixn.controlNo))).limit(1);
    return { duplicate: true, message: first, results: (first?.result as TxnResult[] | null) ?? [] };
  }
  const processed = await processMessage(orgId, partner, row.id, ixn, actorId);
  // A partner that wants our 997 gets one ready to send for every file it sends (never for its own 997).
  let ack: { id: string; fileName: string } | null = null;
  if (partner.enabled && (partner.docsOut as string[]).includes("997") && ixn.groups.some(g => g.functionalId !== "FA")) {
    ack = await generateAck997(orgId, row.id, actorId).then(r => ({ id: r.id, fileName: r.fileName }))
      .catch(e => { console.error("[edi] the 997 for a received file could not be generated", { orgId, messageId: row.id, e }); return null; });
  }
  return { duplicate: false, ...processed, ack };
}

/**
 * Our 997 for a received file, kept like any outbound file: download it,
 * deliver it, mark it sent. One per received file (a second call returns the
 * first unless it was voided). It goes out in the same test/live mode as the
 * file it answers. Accepted throughout: see lib/edi/x12/997.ts.
 */
export async function generateAck997(orgId: string, inboundId: string, actorId: string | null) {
  const [m] = await db.select().from(ediMessages).where(and(eq(ediMessages.id, inboundId), eq(ediMessages.orgId, orgId))).limit(1);
  if (!m || m.direction !== "in") throw new EdiError("Inbound file not found.", 404);
  const [existing] = await db.select().from(ediMessages).where(and(eq(ediMessages.orgId, orgId), eq(ediMessages.direction, "out"),
    eq(ediMessages.appDocType, "EdiFile"), eq(ediMessages.appDocId, m.id), ne(ediMessages.status, "void"))).limit(1);
  if (existing) return { ...existing, already: true };
  const [partner] = await db.select().from(ediPartners).where(eq(ediPartners.id, m.partnerId)).limit(1);
  if (!partner) throw new EdiError("EDI partner not found.", 404);
  if (!partner.enabled) throw new EdiError("This partner's EDI profile is switched off.");
  const ixn = readInterchange(m.payload);
  const groups = ixn.groups.map(g => ({ functionalId: g.functionalId, controlNo: g.controlNo, txns: g.txns.map(t => ({ setId: t.setId, controlNo: t.controlNo })) }));
  if (!groups.some(g => g.functionalId !== "FA")) throw new EdiError("This file is itself an acknowledgement (997); it is never acknowledged.", 409);

  const controlNo = await allocateControlNo(orgId, partner.id);
  const payload = write997(groups, {
    version: partner.version as "004010" | "005010", test: ixn.test,
    senderQualifier: partner.senderQualifier, senderId: partner.senderId, receiverQualifier: partner.receiverQualifier, receiverId: partner.receiverId,
    senderAppId: partner.senderAppId || partner.senderId, receiverAppId: partner.receiverAppId || partner.receiverId,
    controlNo, now: utcStamp(),
  })!;
  const fileName = `997_for_${ixn.controlNo}_${String(controlNo).padStart(9, "0")}.x12`;
  const [row] = await db.insert(ediMessages).values({
    orgId, partnerId: partner.id, partyId: partner.partyId, direction: "out", docType: "997", standard: "x12",
    version: partner.version, test: ixn.test, status: "generated", interchangeNo: controlNo, groupNo: controlNo, txnNo: "0001",
    appDocType: "EdiFile", appDocId: m.id, appDocNumber: `${m.docType} ${m.interchangeNo}`.slice(0, 64),
    fileName, payload, payloadSha256: createHash("sha256").update(payload).digest("hex"), createdBy: actorId,
  }).returning();
  logEvent({ orgId, eventType: "edi_generated", docType: null, docId: null, actorId, meta: { messageId: row.id, docType: "997", controlNo, answers: m.id } })
    .catch(e => console.error("[audit] edi_generated failed:", e));
  return { ...row, already: false };
}

/** A file stuck in error (it failed part-way) may be processed again. Everything it does is safe to repeat. */
export async function reprocessMessage(orgId: string, id: string, actorId: string | null) {
  const [m] = await db.select().from(ediMessages).where(and(eq(ediMessages.id, id), eq(ediMessages.orgId, orgId))).limit(1);
  if (!m || m.direction !== "in") throw new EdiError("Inbound file not found.", 404);
  if (m.status !== "error") throw new EdiError("Only a file that failed can be processed again.", 409);
  const [partner] = await db.select().from(ediPartners).where(eq(ediPartners.id, m.partnerId)).limit(1);
  return processMessage(orgId, partner, m.id, readInterchange(m.payload), actorId);
}

async function processMessage(orgId: string, partner: Partner, messageId: string, ixn: ReturnType<typeof readInterchange>, actorId: string | null) {
  const results: TxnResult[] = [];
  let status: "processed" | "review" | "ignored" | "error" = "processed";
  let appDoc: { id: string; number: string | null; type: "PurchaseOrder" | "SalesOrder" } | null = null;
  try {
    if (ixn.test && partner.mode === "live") {
      status = "ignored";
      results.push({ setId: "*", controlNo: String(ixn.controlNo), outcome: "ignored", summary: "A test file (ISA15 = T) from a partner set to live: stored, not applied.", reasons: [] });
    } else {
      for (const g of ixn.groups) for (const t of g.txns) {
        const rs: TxnResult[] = t.setId === "997" ? [await apply997(orgId, partner, messageId, t.segments, t.controlNo)]
          : t.setId === "855" ? [await apply855(orgId, partner, t.segments, t.controlNo)]
          : t.setId === "856" ? await apply856(orgId, partner, t.segments, t.controlNo, actorId)
          : t.setId === "810" ? [await apply810(orgId, partner, t.segments, t.controlNo)]
          : t.setId === "850" ? [await apply850(orgId, partner, t.segments, t.controlNo, actorId)]
          : [{ setId: t.setId, controlNo: t.controlNo, outcome: "review" as const, summary: `${t.setId} files are not read yet.`, reasons: [] }];
        results.push(...rs);
        for (const r of rs) {
          const docId = r.soId ?? r.poId;
          if (!docId || appDoc) continue;
          const [d] = await db.select({ number: tradeDocuments.docNumber }).from(tradeDocuments).where(eq(tradeDocuments.id, docId)).limit(1);
          appDoc = { id: docId, number: d?.number ?? null, type: r.soId ? "SalesOrder" : "PurchaseOrder" };
        }
      }
      if (results.some(r => r.outcome === "review")) status = "review";
    }
  } catch (e: any) {
    console.error("[edi] inbound processing failed", { orgId, messageId, e });
    status = "error";
    results.push({ setId: "*", controlNo: String(ixn.controlNo), outcome: "review", summary: "Processing stopped with an error. Process it again, or contact support if it keeps failing.", reasons: [String(e?.message ?? e).slice(0, 300)] });
  }
  const [message] = await db.update(ediMessages).set({
    status, result: results, appDocType: appDoc?.type ?? null, appDocId: appDoc?.id ?? null, appDocNumber: appDoc?.number ?? null,
    error: status === "error" ? results.at(-1)?.reasons[0] ?? null : null,
  }).where(eq(ediMessages.id, messageId)).returning();
  logEvent({ orgId, eventType: "edi_received", docType: appDoc ? "trade" : null, docId: appDoc?.id ?? null, actorId,
    meta: { messageId, controlNo: ixn.controlNo, status, sets: results.map(r => `${r.setId}:${r.outcome}`) } })
    .catch(e => console.error("[audit] edi_received failed:", e));
  return { message, results };
}

/** 997: mark the outbound file it answers. */
async function apply997(orgId: string, partner: Partner, messageId: string, segments: string[][], controlNo: string): Promise<TxnResult> {
  const ack = parse997(segments);
  const [target] = await db.select().from(ediMessages).where(and(eq(ediMessages.orgId, orgId), eq(ediMessages.partnerId, partner.id),
    eq(ediMessages.direction, "out"), eq(ediMessages.groupNo, ack.groupControlNo))).limit(1);
  if (!target) return { setId: "997", controlNo, outcome: "review", summary: `Acknowledges group ${ack.groupControlNo}, which we have no record of sending to this partner.`, reasons: [] };
  await db.update(ediMessages).set({ ackStatus: ack.groupStatus, ackedAt: new Date(), ackMessageId: messageId,
    error: ack.groupStatus === "accepted" ? null : [...ack.codes, ...ack.txns.flatMap(t => t.codes)].join(" ").slice(0, 500) || null })
    .where(eq(ediMessages.id, target.id));
  const words = { accepted: "accepted", accepted_with_errors: "accepted with errors", partially_accepted: "partly accepted", rejected: "rejected" }[ack.groupStatus];
  return {
    setId: "997", controlNo, outcome: ack.groupStatus === "accepted" ? "applied" : "review",
    summary: `${target.fileName} was ${words} by the partner.`,
    reasons: ack.groupStatus === "accepted" ? [] : ["Their translator did not accept the file cleanly. Fix the cause and send a new file."],
    poId: target.appDocType === "PurchaseOrder" ? target.appDocId : null,
  };
}

/** 855: the supplier's answer to one of our purchase orders, through the same path as the portal. */
async function apply855(orgId: string, partner: Partner, segments: string[][], controlNo: string): Promise<TxnResult> {
  const ack = parse855(segments);
  if (!ack.poNumber) return { setId: "855", controlNo, outcome: "review", summary: "The acknowledgement names no purchase order (BAK03).", reasons: [] };
  const [po] = await db.select().from(tradeDocuments).where(and(eq(tradeDocuments.orgId, orgId), eq(tradeDocuments.kind, "PurchaseOrder"),
    eq(tradeDocuments.partyId, partner.partyId), eq(tradeDocuments.docNumber, ack.poNumber))).limit(1);
  if (!po) return { setId: "855", controlNo, outcome: "review", summary: `No purchase order ${ack.poNumber} to this supplier.`, reasons: [] };

  const lines = await db.select().from(tradeDocumentLines).where(and(eq(tradeDocumentLines.documentId, po.id), eq(tradeDocumentLines.orgId, orgId)));
  const itemIds = [...new Set(lines.map(l => l.itemId).filter(Boolean) as string[])];
  const items = itemIds.length ? await db.select({ id: apItems.id, baseUom: apItems.baseUom }).from(apItems).where(inArray(apItems.id, itemIds)) : [];
  const baseOf = new Map(items.map(i => [i.id, i.baseUom]));
  const overrides = partner.unitOverrides as Record<string, string>;
  const out = ackToResponse(ack, lines.map(l => {
    const u = x12UnitFor(l.orderUom || (l.itemId ? baseOf.get(l.itemId) ?? null : null), overrides);
    return { id: l.id, lineNo: l.lineNo, qty: Number(l.qty ?? 0), unitCode: u.ok ? u.code : null, closed: l.closed };
  }));
  if (out.ok === false) return { setId: "855", controlNo, outcome: "review", summary: `${po.docNumber}: the acknowledgement could not be applied.`, reasons: out.problems, poId: po.id };

  try {
    await recordSupplierResponse(orgId, po.id, { kind: out.kind, message: [`EDI 855 (${ack.ackType}).`, ...out.notes].join(" ").slice(0, 2000), lines: out.lines },
      { tokenId: null, actorName: "Supplier (EDI 855)", channel: "by EDI (855)" });
  } catch (e) {
    if (e instanceof LedgerValidationError) return { setId: "855", controlNo, outcome: "review", summary: `${po.docNumber}: ${e.message}`, reasons: [], poId: po.id };
    throw e;
  }
  const what = out.kind === "confirm" ? "confirmed" : out.kind === "decline" ? "declined" : `proposed changes to ${out.lines.length} line(s), waiting for your decision in Purchase Orders`;
  return { setId: "855", controlNo, outcome: out.needsReview ? "review" : "applied", summary: `${po.docNumber}: the supplier ${what}.`, reasons: out.notes, poId: po.id };
}

/** The PO's lines as an 856 is matched against them, with X12 unit codes resolved the way our 850 wrote them. */
async function asnPoLines(orgId: string, poId: string, overrides: Record<string, string>) {
  const lines = await db.select({ id: tradeDocumentLines.id, lineNo: tradeDocumentLines.lineNo, closed: tradeDocumentLines.closed,
    orderUom: tradeDocumentLines.orderUom, unitsPerOrderUnit: tradeDocumentLines.unitsPerOrderUnit, itemId: tradeDocumentLines.itemId,
    itemCode: apItems.code, baseUom: apItems.baseUom })
    .from(tradeDocumentLines).leftJoin(apItems, eq(apItems.id, tradeDocumentLines.itemId))
    .where(and(eq(tradeDocumentLines.documentId, poId), eq(tradeDocumentLines.orgId, orgId)));
  const code = (u: string | null) => { const r = x12UnitFor(u, overrides); return r.ok ? r.code : null; };
  return lines.filter(l => l.itemId).map(l => ({
    id: l.id, lineNo: l.lineNo, itemCode: l.itemCode, closed: !!l.closed,
    orderUnitCode: code(l.orderUom || l.baseUom), baseUnitCode: code(l.baseUom), unitsPerOrderUnit: Number(l.unitsPerOrderUnit || 1),
  }));
}

/**
 * 856: what the supplier says is on its way, one expected delivery per order.
 * BSN01 00 records it; 05 replaces one not yet received; 01 cancels one not
 * yet received. A delivery already received is never changed from a file.
 */
async function apply856(orgId: string, partner: Partner, segments: string[][], controlNo: string, actorId: string | null): Promise<TxnResult[]> {
  const notice = parse856(segments);
  const review = (summary: string, reasons: string[] = [], poId: string | null = null): TxnResult => ({ setId: "856", controlNo, outcome: "review", summary, reasons, poId });
  const purpose = asnPurpose(notice.purpose);
  if (!purpose) return [review(`Unknown ship notice purpose "${notice.purpose}" (BSN01).`)];
  if (!notice.orders.length) return [review(`Ship notice ${notice.shipmentId || "(no ID)"} names no order.`, notice.problems)];
  const out: TxnResult[] = notice.problems.length ? [review(`Ship notice ${notice.shipmentId}: parts of it could not be read.`, notice.problems)] : [];
  const overrides = partner.unitOverrides as Record<string, string>;

  for (const order of notice.orders) {
    const [po] = await db.select({ id: tradeDocuments.id, docNumber: tradeDocuments.docNumber }).from(tradeDocuments)
      .where(and(eq(tradeDocuments.orgId, orgId), eq(tradeDocuments.kind, "PurchaseOrder"), eq(tradeDocuments.partyId, partner.partyId), eq(tradeDocuments.docNumber, order.poNumber))).limit(1);
    if (!po) { out.push(review(`No purchase order ${order.poNumber} to this supplier.`)); continue; }
    const reference = asnReference(notice, order.poNumber);
    const [existing] = await db.select({ id: expectedDeliveries.id, goodsReceiptId: expectedDeliveries.goodsReceiptId }).from(expectedDeliveries)
      .where(and(eq(expectedDeliveries.orgId, orgId), eq(expectedDeliveries.supplierId, partner.partyId), ne(expectedDeliveries.status, "cancelled"),
        sql`upper(${expectedDeliveries.reference}) = upper(${reference})`)).limit(1);
    const tag = `${po.docNumber}, delivery ${reference}`;
    try {
      if (purpose === "cancel") {
        if (!existing) { out.push(review(`${tag}: the supplier cancelled a delivery we have no open record of.`, [], po.id)); continue; }
        if (existing.goodsReceiptId) { out.push(review(`${tag}: the supplier cancelled it, but it has already been received. Nothing changed.`, [], po.id)); continue; }
        await setDeliveryCancelled(orgId, existing.id, true);
        out.push({ setId: "856", controlNo, outcome: "applied", summary: `${tag}: cancelled by the supplier.`, reasons: [], poId: po.id });
        continue;
      }
      if (existing && (purpose === "create" || existing.goodsReceiptId)) {
        out.push(review(existing.goodsReceiptId ? `${tag}: already received, so the supplier's change was not applied.`
          : `${tag} is already recorded. The supplier must send a replacement (BSN01 05) to change it.`, [], po.id));
        continue;
      }
      const mapped = asnOrderToDelivery(notice, order, await asnPoLines(orgId, po.id, overrides));
      if (mapped.ok === false) { out.push(review(`${tag}: the ship notice could not be recorded.`, mapped.problems, po.id)); continue; }
      // Replace: free the reference by cancelling the old one, record the new one, then remove the old; reopen it if the new one fails.
      if (existing) await setDeliveryCancelled(orgId, existing.id, true);
      try { await createExpectedDelivery(orgId, { ...mapped.input, poId: po.id }, actorId); }
      catch (e) { if (existing) await setDeliveryCancelled(orgId, existing.id, false); throw e; }
      if (existing) await deleteExpectedDelivery(orgId, existing.id);
      const n = mapped.input.lines?.length ?? 0;
      out.push({ setId: "856", controlNo, outcome: "applied", reasons: mapped.notes, poId: po.id,
        summary: `${tag}: ${existing ? "replaced" : "recorded"} as an expected delivery (${n} line${n === 1 ? "" : "s"}). Receiving can fill in from it.` });
    } catch (e) {
      const ed = expectedDeliveryErrorOf(e);
      if (ed) { out.push(review(`${tag}: ${ed.message}`, [], po.id)); continue; }
      throw e;
    }
  }
  return out;
}

/**
 * An 810 matched against our records as they stand now: the PO it names, its
 * receipts not yet billed, and any bill already recorded under the invoice
 * number. Used on upload and again just before a person creates the bill.
 */
export async function matchInvoice(orgId: string, partner: Partner, segments: string[][]): Promise<{ poId: string | null; poNumber: string; invoiceNo: string; outcome: InvoiceOutcome; existingBill: string | null }> {
  const inv = parse810(segments);
  const none = (problems: string[]) => ({ poId: null, poNumber: inv.poNumber, invoiceNo: inv.invoiceNo, existingBill: null, outcome: { ok: false as const, problems, lines: [] } });
  if (!inv.poNumber) return none(["The invoice names no purchase order (BIG04). Bill it by hand."]);
  const [po] = await db.select({ id: tradeDocuments.id, currency: tradeDocuments.currency }).from(tradeDocuments)
    .where(and(eq(tradeDocuments.orgId, orgId), eq(tradeDocuments.kind, "PurchaseOrder"), eq(tradeDocuments.partyId, partner.partyId), eq(tradeDocuments.docNumber, inv.poNumber))).limit(1);
  if (!po) return none([`No purchase order ${inv.poNumber} to this supplier.`]);

  const [org] = await db.select({ home: organisations.currency }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const home = (org?.home ?? "PKR").toUpperCase();
  const billCurrency = (inv.currency || po.currency || home).toUpperCase();
  const receiptIds = [...new Set((await db.select({ id: goodsReceiptLines.receiptId }).from(goodsReceiptLines)
    .where(and(eq(goodsReceiptLines.orgId, orgId), eq(goodsReceiptLines.poId, po.id)))).map(r => r.id))];
  const heads = receiptIds.length ? await db.select().from(goodsReceipts)
    .where(and(eq(goodsReceipts.orgId, orgId), inArray(goodsReceipts.id, receiptIds), eq(goodsReceipts.supplierId, partner.partyId), eq(goodsReceipts.status, "Posted"))) : [];
  const inCurrency = heads.filter(h => (h.currency || home).toUpperCase() === billCurrency);
  const lines = inCurrency.length ? await db.select().from(goodsReceiptLines)
    .where(and(eq(goodsReceiptLines.orgId, orgId), inArray(goodsReceiptLines.receiptId, inCurrency.map(h => h.id)))) : [];
  const receipts: InvoiceReceipt[] = inCurrency.map(h => {
    const fx = billCurrency === home ? 1 : Number(h.exchangeRate) || 1;
    return { id: h.id, receiptNo: h.receiptNo, receiptDate: String(h.receiptDate), currency: billCurrency,
      lines: lines.filter(l => l.receiptId === h.id).map(l => ({ id: l.id, poLineId: l.poLineId,
        unbilledQty: Math.max(0, Number(l.qtyBase) - Number(l.billedQty)), price: Number(l.unitCost) / fx })) };
  });
  const outcome = invoiceToBill(inv, await asnPoLines(orgId, po.id, partner.unitOverrides as Record<string, string>), receipts, billCurrency);
  const [dup] = inv.invoiceNo ? await db.select({ billNumber: apBills.billNumber }).from(apBills)
    .where(and(eq(apBills.orgId, orgId), eq(apBills.supplierId, partner.partyId), sql`upper(${apBills.reference}) = upper(${inv.invoiceNo.trim()})`)).limit(1) : [];
  return { poId: po.id, poNumber: inv.poNumber, invoiceNo: inv.invoiceNo, outcome, existingBill: dup ? (dup.billNumber || "a bill") : null };
}

/** The segments of one 810 inside a stored file, found by its ST control number. */
export function invoiceSegmentsIn(payload: string, controlNo: string): string[][] | null {
  return readInterchange(payload).groups.flatMap(g => g.txns).find(t => t.setId === "810" && t.controlNo === controlNo)?.segments ?? null;
}

/** 810: the supplier's invoice. Matched and proposed as a bill; a person creates it. Nothing posts from the file. */
async function apply810(orgId: string, partner: Partner, segments: string[][], controlNo: string): Promise<TxnResult> {
  const m = await matchInvoice(orgId, partner, segments);
  const tag = `Invoice ${m.invoiceNo || "(no number)"} for ${m.poNumber || "no PO"}`;
  if (m.existingBill) return { setId: "810", controlNo, outcome: "review", poId: m.poId, summary: `${tag} is already recorded as ${m.existingBill}. Nothing to do.`, reasons: [] };
  if (m.outcome.ok === false) return { setId: "810", controlNo, outcome: "review", poId: m.poId, summary: `${tag}: bill it by hand.`, reasons: m.outcome.problems, match: m.outcome.lines };
  const p = m.outcome.proposal;
  return { setId: "810", controlNo, outcome: "review", poId: m.poId, proposal: p, match: m.outcome.lines, reasons: m.outcome.notes,
    summary: `${tag} matches ${p.receiptNos.join(", ")} (goods ${p.goods} ${p.currency}). Check it and create the bill.` };
}
