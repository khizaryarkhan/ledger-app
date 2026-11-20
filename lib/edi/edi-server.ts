/**
 * EDI Phase 1, the server half: partner profiles, the message log, and
 * generating an outbound 850 for a native purchase order. Pure rules:
 * lib/edi/partner.ts, validate.ts, build/*, x12/*.
 *
 * Transport is "manual" (docs/prd-edi.md D1, least-cost start): the file is
 * generated and KEPT here; a person downloads it, delivers it through the
 * partner's own channel, and marks it sent. Nothing in lib/edi posts stock or
 * ledger (tests/architecture.test.ts).
 *
 * Control numbers come from ONE UPDATE … RETURNING on the partner row, so two
 * generations can never share one (neon-http has no transactions), and the
 * unique (partner, direction, interchange_no) index stands behind it. A number
 * taken by a file that is then voided is never reused.
 */

import { createHash } from "node:crypto";
import { db } from "@/db";
import { ediPartners, ediMessages, parties, tradeDocuments } from "@/db/schema";
import { and, eq, desc, sql, inArray } from "drizzle-orm";
import { partnerValues, type PartnerInput } from "@/lib/edi/partner";
import { loadPoFacts } from "@/lib/edi/build/purchase-order-server";
import { buildEdiOrderFromPo } from "@/lib/edi/build/purchase-order";
import { prepareOrderForX12, type Problem } from "@/lib/edi/validate";
import { write850 } from "@/lib/edi/x12/850";
import { logEvent } from "@/lib/audit";

export class EdiError extends Error {
  constructor(message: string, public status = 400, public problems?: Problem[]) { super(message); }
}
export const ediErrorOf = (e: unknown) => (e instanceof EdiError ? e : null);
const fail = (m: string, status = 400, problems?: Problem[]): never => { throw new EdiError(m, status, problems); };
const isUniqueViolation = (e: any) => e?.code === "23505" || /duplicate key|unique constraint/i.test(String(e?.message ?? ""));

/* ------------------------------- Partners ------------------------------- */

export async function listPartners(orgId: string) {
  const rows = await db.select({ p: ediPartners, partyName: parties.name, partyType: parties.partyType })
    .from(ediPartners).leftJoin(parties, eq(parties.id, ediPartners.partyId))
    .where(eq(ediPartners.orgId, orgId)).orderBy(parties.name);
  return rows.map(r => ({ ...r.p, partyName: r.partyName, partyType: r.partyType }));
}

async function loadPartner(orgId: string, id: string) {
  const [p] = await db.select().from(ediPartners).where(and(eq(ediPartners.id, id), eq(ediPartners.orgId, orgId))).limit(1);
  if (!p) fail("EDI partner not found.", 404);
  return p!;
}

export async function createPartner(orgId: string, input: PartnerInput, actorId: string | null) {
  const partyId = input.partyId ? String(input.partyId) : "";
  if (!partyId) fail("Choose the supplier or customer this profile is for.");
  const [party] = await db.select({ id: parties.id }).from(parties).where(and(eq(parties.id, partyId), eq(parties.orgId, orgId))).limit(1);
  if (!party) fail("Supplier or customer not found.", 404);
  const v = partnerValues(input);
  if (v.ok === false) fail(v.error);
  try {
    const [row] = await db.insert(ediPartners).values({ orgId, partyId, ...(v as any).value, createdBy: actorId }).returning();
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) fail("This party already has an EDI profile.", 409);
    throw e;
  }
}

/** Fields not sent keep their stored value; the whole result is validated again. */
export async function updatePartner(orgId: string, id: string, input: PartnerInput) {
  const cur = await loadPartner(orgId, id);
  const merged: PartnerInput = { ...cur, ...Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined)) };
  const v = partnerValues(merged);
  if (v.ok === false) fail(v.error);
  const [row] = await db.update(ediPartners).set({ ...(v as any).value, updatedAt: new Date() })
    .where(and(eq(ediPartners.id, id), eq(ediPartners.orgId, orgId))).returning();
  return row;
}

/** A profile that has exchanged files stays, for the record: disable it instead. */
export async function deletePartner(orgId: string, id: string) {
  await loadPartner(orgId, id);
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(ediMessages).where(and(eq(ediMessages.partnerId, id), eq(ediMessages.orgId, orgId)));
  if (Number(n?.n ?? 0) > 0) fail("Files have been exchanged with this partner, so the profile is kept for the record. Switch it off instead.", 409);
  await db.delete(ediPartners).where(and(eq(ediPartners.id, id), eq(ediPartners.orgId, orgId)));
}

async function partnerForParty(orgId: string, partyId: string | null) {
  if (!partyId) return null;
  const [p] = await db.select().from(ediPartners).where(and(eq(ediPartners.orgId, orgId), eq(ediPartners.partyId, partyId))).limit(1);
  return p ?? null;
}

/* --------------------------- Purchase order 850 --------------------------- */

/** What "Send by EDI" shows before anything is generated: the partner, and what (if anything) stops the file. */
export async function checkPurchaseOrder(orgId: string, poId: string) {
  const facts = await loadPoFacts(orgId, poId);
  if (!facts) fail("Purchase order not found.", 404);
  const partner = await partnerForParty(orgId, facts!.supplierId);
  const messages = await listMessages(orgId, { appDocId: poId });
  if (!partner) return { partner: null, problems: [{ lineNo: null, message: "This supplier has no EDI profile. Set one up in Supply Chain → EDI." }], messages };
  const order = buildEdiOrderFromPo(facts!);
  const prep = prepareOrderForX12(order, { requirePartNumber: partner.requirePartNumber, requireGtin: partner.requireGtin, unitOverrides: partner.unitOverrides as Record<string, string> });
  const problems: Problem[] = prep.ok === false ? [...prep.problems] : [];
  if (!partner.enabled) problems.unshift({ lineNo: null, message: "This partner's EDI profile is switched off." });
  if (!(partner.docsOut as string[]).includes("850")) problems.unshift({ lineNo: null, message: "Purchase orders (850) are not switched on for this partner." });
  return {
    partner: { id: partner.id, mode: partner.mode, version: partner.version, receiverId: partner.receiverId, transport: partner.transport },
    problems, messages,
  };
}

/** Take the next control number for this partner. Never reused, even if the file is voided. */
export async function allocateControlNo(orgId: string, partnerId: string): Promise<number> {
  const r: any = await db.execute(sql`
    update edi_partners set next_control_no = next_control_no + 1, updated_at = now()
    where id = ${partnerId} and org_id = ${orgId}
    returning next_control_no - 1 as ctl`);
  const ctl = Number((r.rows ?? r)[0]?.ctl);
  if (!(ctl >= 1)) fail("EDI partner not found.", 404);
  if (ctl > 999_999_999) fail("This partner's control numbers are used up (999,999,999). Contact support.", 409);
  return ctl;
}

export function utcStamp(d = new Date()) {
  const iso = d.toISOString();
  return { date: iso.slice(0, 10).replace(/-/g, ""), time: iso.slice(11, 16).replace(":", "") };
}

/**
 * Generate the 850 for a PO and keep it. Validated in full before a control
 * number is taken. An earlier file for the same PO that was never sent is
 * voided as superseded, so only one file is ever waiting to go.
 */
export async function generatePurchaseOrder850(orgId: string, poId: string, actorId: string | null) {
  const facts = await loadPoFacts(orgId, poId);
  if (!facts) fail("Purchase order not found.", 404);
  const partner = await partnerForParty(orgId, facts!.supplierId);
  if (!partner) fail("This supplier has no EDI profile. Set one up in Supply Chain → EDI.");
  if (!partner!.enabled) fail("This partner's EDI profile is switched off.");
  if (!(partner!.docsOut as string[]).includes("850")) fail("Purchase orders (850) are not switched on for this partner.");
  const order = buildEdiOrderFromPo(facts!);
  const prep = prepareOrderForX12(order, { requirePartNumber: partner!.requirePartNumber, requireGtin: partner!.requireGtin, unitOverrides: partner!.unitOverrides as Record<string, string> });
  if (prep.ok === false) fail("The order cannot be sent by EDI yet.", 422, prep.problems);

  const controlNo = await allocateControlNo(orgId, partner!.id);
  const payload = write850(order, (prep as { ok: true; lines: any[] }).lines, {
    version: partner!.version as "004010" | "005010", test: partner!.mode !== "live",
    senderQualifier: partner!.senderQualifier, senderId: partner!.senderId,
    receiverQualifier: partner!.receiverQualifier, receiverId: partner!.receiverId,
    senderAppId: partner!.senderAppId || partner!.senderId, receiverAppId: partner!.receiverAppId || partner!.receiverId,
    controlNo, now: utcStamp(),
  });
  const safeNo = (order.orderNumber || poId.slice(0, 8)).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 40);
  const fileName = `850_${safeNo}_${String(controlNo).padStart(9, "0")}.x12`;

  await db.update(ediMessages).set({ status: "void", voidReason: `Superseded by interchange ${controlNo}` })
    .where(and(eq(ediMessages.orgId, orgId), eq(ediMessages.appDocId, poId), eq(ediMessages.partnerId, partner!.id), eq(ediMessages.status, "generated")));
  const [row] = await db.insert(ediMessages).values({
    orgId, partnerId: partner!.id, partyId: partner!.partyId, direction: "out", docType: "850", standard: "x12",
    version: partner!.version, test: partner!.mode !== "live", status: "generated",
    interchangeNo: controlNo, groupNo: controlNo, txnNo: "0001",
    appDocType: "PurchaseOrder", appDocId: poId, appDocNumber: order.orderNumber || null,
    fileName, payload, payloadSha256: createHash("sha256").update(payload).digest("hex"), createdBy: actorId,
  }).returning({ id: ediMessages.id, fileName: ediMessages.fileName, interchangeNo: ediMessages.interchangeNo, status: ediMessages.status, test: ediMessages.test });
  logEvent({ orgId, eventType: "edi_generated", docType: "trade", docId: poId, actorId, meta: { messageId: row.id, docType: "850", controlNo, test: row.test } })
    .catch(e => console.error("[audit] edi_generated failed:", e));
  return row;
}

/* -------------------------------- Messages -------------------------------- */

/** The log without payloads; ask for one message to read its file. */
export async function listMessages(orgId: string, opts: { appDocId?: string | null; limit?: number } = {}) {
  const where = [eq(ediMessages.orgId, orgId)];
  if (opts.appDocId) where.push(eq(ediMessages.appDocId, opts.appDocId));
  return db.select({
    id: ediMessages.id, partnerId: ediMessages.partnerId, partyName: parties.name, direction: ediMessages.direction,
    docType: ediMessages.docType, version: ediMessages.version, test: ediMessages.test, status: ediMessages.status,
    interchangeNo: ediMessages.interchangeNo, appDocType: ediMessages.appDocType, appDocId: ediMessages.appDocId,
    appDocNumber: ediMessages.appDocNumber, fileName: ediMessages.fileName, voidReason: ediMessages.voidReason,
    createdAt: ediMessages.createdAt, sentAt: ediMessages.sentAt,
    ackStatus: ediMessages.ackStatus, ackedAt: ediMessages.ackedAt, error: ediMessages.error, result: ediMessages.result,
  }).from(ediMessages).leftJoin(parties, eq(parties.id, ediMessages.partyId))
    .where(and(...where)).orderBy(desc(ediMessages.createdAt)).limit(Math.min(opts.limit ?? 200, 500));
}

export async function getMessage(orgId: string, id: string) {
  const [m] = await db.select().from(ediMessages).where(and(eq(ediMessages.id, id), eq(ediMessages.orgId, orgId))).limit(1);
  if (!m) fail("EDI file not found.", 404);
  return m!;
}

/**
 * The person delivered the file through the partner's channel. The PO becomes
 * Sent exactly as the email path stamps it (first send only).
 */
export async function markMessageSent(orgId: string, id: string, actorId: string | null) {
  const m = await getMessage(orgId, id);
  if (m.status !== "generated") fail(m.status === "sent" ? "This file is already marked sent." : "This file was voided and must not be sent.", 409);
  const now = new Date();
  const r = await db.update(ediMessages).set({ status: "sent", sentAt: now, sentBy: actorId })
    .where(and(eq(ediMessages.id, id), eq(ediMessages.orgId, orgId), eq(ediMessages.status, "generated"))).returning({ id: ediMessages.id });
  if (!r.length) fail("This file changed meanwhile. Reload and try again.", 409);
  if (m.appDocType === "PurchaseOrder" && m.appDocId) {
    await db.update(tradeDocuments).set({ sentAt: now, updatedAt: now })
      .where(and(eq(tradeDocuments.id, m.appDocId), eq(tradeDocuments.orgId, orgId), sql`${tradeDocuments.sentAt} is null`));
  }
  logEvent({ orgId, eventType: "edi_sent", docType: m.appDocType === "PurchaseOrder" ? "trade" : null, docId: m.appDocType === "PurchaseOrder" ? m.appDocId : null, actorId, meta: { messageId: id, controlNo: m.interchangeNo } })
    .catch(e => console.error("[audit] edi_sent failed:", e));
  return { id, status: "sent" as const };
}

/** A file that has not gone may be voided. One already sent cannot be: it has left the building. */
export async function voidMessage(orgId: string, id: string, reason: string, actorId: string | null) {
  const m = await getMessage(orgId, id);
  if (m.status === "sent") fail("This file has been sent, so it stays on record. Send a change or cancellation instead.", 409);
  if (m.status === "void") return { id, status: "void" as const };
  const why = reason.trim().slice(0, 500) || "Voided";
  await db.update(ediMessages).set({ status: "void", voidReason: why })
    .where(and(eq(ediMessages.id, id), eq(ediMessages.orgId, orgId), inArray(ediMessages.status, ["generated"])));
  logEvent({ orgId, eventType: "edi_voided", docType: m.appDocType === "PurchaseOrder" ? "trade" : null, docId: m.appDocType === "PurchaseOrder" ? m.appDocId : null, actorId, meta: { messageId: id, controlNo: m.interchangeNo, reason: why } })
    .catch(e => console.error("[audit] edi_voided failed:", e));
  return { id, status: "void" as const };
}
