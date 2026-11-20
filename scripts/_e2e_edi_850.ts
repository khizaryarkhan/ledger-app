/**
 * Dev-database check of EDI Phase 1: a partner profile for an existing PO's supplier, the
 * pre-send check, generating the X12 850, control numbers, superseding, marking sent, the
 * void/delete refusals, then cleanup (partner + messages removed, the PO's sent_at restored).
 * Refuses to run against anything but the dev endpoint.
 *
 *   npx tsx scripts/_e2e_edi_850.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

let failed = 0;
const check = (name: string, pass: boolean, detail = "") => { console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`); if (!pass) failed++; };

async function main() {
  if (!process.env.DATABASE_URL?.includes("ep-ancient-math-ab44z2jn")) throw new Error("Refusing to run: not the dev endpoint");
  const { db } = await import("../db");
  const S = await import("../db/schema");
  const { eq, and, isNotNull, sql } = await import("drizzle-orm");
  const E = await import("../lib/edi/edi-server");
  const { segments } = await import("../lib/edi/x12/envelope");

  // A PO with at least one item line, whose supplier has no EDI profile yet.
  const candidates = await db.select({ poId: S.tradeDocuments.id, orgId: S.tradeDocuments.orgId, partyId: S.tradeDocuments.partyId, sentAt: S.tradeDocuments.sentAt })
    .from(S.tradeDocuments).innerJoin(S.tradeDocumentLines, eq(S.tradeDocumentLines.documentId, S.tradeDocuments.id))
    .where(and(eq(S.tradeDocuments.kind, "PurchaseOrder"), isNotNull(S.tradeDocuments.partyId), isNotNull(S.tradeDocumentLines.itemId))).limit(20);
  let po: (typeof candidates)[number] | undefined;
  for (const c of candidates) {
    const [p] = await db.select({ id: S.ediPartners.id }).from(S.ediPartners).where(and(eq(S.ediPartners.orgId, c.orgId), eq(S.ediPartners.partyId, c.partyId!))).limit(1);
    if (!p) { po = c; break; }
  }
  if (!po) throw new Error("No suitable PO on dev");
  const orgId = po.orgId;
  let partnerId: string | null = null;
  try {
    const before = await E.checkPurchaseOrder(orgId, po.poId);
    check("without a profile the check says so", before.partner === null && /no EDI profile/.test(before.problems[0]?.message ?? ""));

    const bad = await E.createPartner(orgId, { partyId: po.partyId, senderQualifier: "ZZ", senderId: "BAD*ID", receiverQualifier: "ZZ", receiverId: "X" }, null).then(() => null, e => e);
    check("an ID with a separator is refused", /plain letters/.test(bad?.message ?? ""));

    // Lenient rules so the existing dev data can produce a file: no part number required.
    const p = await E.createPartner(orgId, { partyId: po.partyId, senderQualifier: "ZZ", senderId: "E2ESENDER", receiverQualifier: "ZZ", receiverId: "E2ERECEIVER", requirePartNumber: false }, null);
    partnerId = p.id;
    check("profile created in test mode, control no. 1", p.mode === "test" && Number(p.nextControlNo) === 1);
    const dup = await E.createPartner(orgId, { partyId: po.partyId, senderQualifier: "ZZ", senderId: "A", receiverQualifier: "ZZ", receiverId: "B" }, null).then(() => null, e => e);
    check("a second profile for the same party is refused", E.ediErrorOf(dup)?.status === 409);

    const chk = await E.checkPurchaseOrder(orgId, po.poId);
    if (chk.problems.length) {
      check("check names what stops the file", chk.problems.every(x => typeof x.message === "string" && x.message.length > 0), JSON.stringify(chk.problems.slice(0, 3)));
      const gen = await E.generatePurchaseOrder850(orgId, po.poId, null).then(() => null, e => e);
      check("generation refused with the same problems, no control number taken", E.ediErrorOf(gen)?.status !== undefined &&
        Number((await db.select({ n: S.ediPartners.nextControlNo }).from(S.ediPartners).where(eq(S.ediPartners.id, p.id)))[0].n) === 1);
      console.log("NOTE  this PO's lines cannot be expressed in X12 on dev data; the file path was not exercised against it");
    } else {
      const m1 = await E.generatePurchaseOrder850(orgId, po.poId, null);
      check("first file takes control no. 1", m1.interchangeNo === 1 && m1.status === "generated" && m1.test === true);
      const full = await E.getMessage(orgId, m1.id);
      const segs = segments(full.payload);
      const ids = segs.map(s => s[0]);
      check("file is ISA … IEA with an 850 and a 106-character ISA", ids[0] === "ISA" && ids.at(-1) === "IEA" && segs[2][1] === "850" && full.payload.split("\n")[0].length === 106);
      check("SE01 counts ST through SE", Number(segs[ids.indexOf("SE")][1]) === ids.indexOf("SE") - ids.indexOf("ST") + 1);
      const m2 = await E.generatePurchaseOrder850(orgId, po.poId, null);
      const list = await E.listMessages(orgId, { appDocId: po.poId });
      check("regenerating takes control no. 2 and voids the unsent first file", m2.interchangeNo === 2 && list.find(x => x.id === m1.id)?.status === "void");
      await E.markMessageSent(orgId, m2.id, null);
      const [doc] = await db.select({ sentAt: S.tradeDocuments.sentAt }).from(S.tradeDocuments).where(eq(S.tradeDocuments.id, po.poId));
      check("marking sent stamps the PO as sent", !!doc.sentAt);
      const again = await E.markMessageSent(orgId, m2.id, null).then(() => null, e => e);
      check("a file cannot be marked sent twice", E.ediErrorOf(again)?.status === 409);
      const voidSent = await E.voidMessage(orgId, m2.id, "test", null).then(() => null, e => e);
      check("a sent file cannot be voided", E.ediErrorOf(voidSent)?.status === 409);
      const del = await E.deletePartner(orgId, p.id).then(() => null, e => e);
      check("a partner with files cannot be deleted", E.ediErrorOf(del)?.status === 409);
    }
  } finally {
    if (partnerId) {
      await db.delete(S.ediMessages).where(eq(S.ediMessages.partnerId, partnerId));
      await db.delete(S.ediPartners).where(eq(S.ediPartners.id, partnerId));
    }
    await db.update(S.tradeDocuments).set({ sentAt: po.sentAt }).where(eq(S.tradeDocuments.id, po.poId));
    const left = await db.select({ n: sql<number>`count(*)::int` }).from(S.ediPartners).where(eq(S.ediPartners.orgId, orgId));
    console.log(`cleanup: ${left[0].n} EDI partners left in that org; PO sent_at restored`);
  }
  if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
  console.log("all passed");
}
main().catch(e => { console.error(e); process.exit(1); });
