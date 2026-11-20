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
 *    change is stored for a person, never applied). Anything else, or anything
 *    unclear, is "review" with the reason in words.
 *
 * Nothing here posts stock or ledger (tests/edi-x12.test.ts).
 */

import { createHash } from "node:crypto";
import { db } from "@/db";
import { ediPartners, ediMessages, tradeDocuments, tradeDocumentLines, apItems } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { readInterchange, X12ReadError } from "@/lib/edi/x12/read";
import { parse997, parse855 } from "@/lib/edi/x12/inbound";
import { ackToResponse } from "@/lib/edi/inbound";
import { x12UnitFor } from "@/lib/edi/validate";
import { recordSupplierResponse } from "@/lib/accounting/po-supplier-server";
import { LedgerValidationError } from "@/lib/ledger";
import { EdiError } from "@/lib/edi/edi-server";
import { logEvent } from "@/lib/audit";

const MAX_BYTES = 2_000_000;
const isUniqueViolation = (e: any) => e?.code === "23505" || /duplicate key|unique constraint/i.test(String(e?.message ?? ""));

type Partner = typeof ediPartners.$inferSelect;
export type TxnResult = { setId: string; controlNo: string; outcome: "applied" | "review" | "ignored"; summary: string; reasons: string[]; poId?: string | null };

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
  return { duplicate: false, ...(await processMessage(orgId, partner, row.id, ixn, actorId)) };
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
  let appDoc: { id: string; number: string | null } | null = null;
  try {
    if (ixn.test && partner.mode === "live") {
      status = "ignored";
      results.push({ setId: "*", controlNo: String(ixn.controlNo), outcome: "ignored", summary: "A test file (ISA15 = T) from a partner set to live: stored, not applied.", reasons: [] });
    } else {
      for (const g of ixn.groups) for (const t of g.txns) {
        const r = t.setId === "997" ? await apply997(orgId, partner, messageId, t.segments, t.controlNo)
          : t.setId === "855" ? await apply855(orgId, partner, t.segments, t.controlNo)
          : { setId: t.setId, controlNo: t.controlNo, outcome: "review" as const, summary: `${t.setId} files are not read yet.`, reasons: [] };
        results.push(r);
        if (r.poId && !appDoc) {
          const [d] = await db.select({ number: tradeDocuments.docNumber }).from(tradeDocuments).where(eq(tradeDocuments.id, r.poId)).limit(1);
          appDoc = { id: r.poId, number: d?.number ?? null };
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
    status, result: results, appDocType: appDoc ? "PurchaseOrder" : null, appDocId: appDoc?.id ?? null, appDocNumber: appDoc?.number ?? null,
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
