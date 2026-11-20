/**
 * Dev-database check of EDI Phase 2 (inbound): send an 850, then upload the partner's 997 and
 * 855 as files. Checks: partner found from the ISA IDs, the 997 marks our file accepted, a replay
 * changes nothing, an 855 with a change becomes a pending proposal (never applied), an 855 for
 * an unknown PO goes to review, a test file to a live partner is ignored. The PO's creator is
 * blanked for the run (the supplier-response path emails the creator) and every change is undone.
 * Refuses to run against anything but the dev endpoint.
 *
 *   npx tsx scripts/_e2e_edi_inbound.ts
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
  const { eq, and, isNotNull, inArray, like } = await import("drizzle-orm");
  const E = await import("../lib/edi/edi-server");
  const I = await import("../lib/edi/inbound-server");
  const { interchange, seg } = await import("../lib/edi/x12/envelope");

  const candidates = await db.select({ id: S.tradeDocuments.id, orgId: S.tradeDocuments.orgId, partyId: S.tradeDocuments.partyId })
    .from(S.tradeDocuments).innerJoin(S.tradeDocumentLines, eq(S.tradeDocumentLines.documentId, S.tradeDocuments.id))
    .where(and(eq(S.tradeDocuments.kind, "PurchaseOrder"), isNotNull(S.tradeDocuments.partyId), isNotNull(S.tradeDocumentLines.itemId), isNotNull(S.tradeDocuments.docNumber))).limit(20);
  let poRef: (typeof candidates)[number] | undefined;
  for (const c of candidates) {
    const [p] = await db.select({ id: S.ediPartners.id }).from(S.ediPartners).where(and(eq(S.ediPartners.orgId, c.orgId), eq(S.ediPartners.partyId, c.partyId!))).limit(1);
    const [doc] = await db.select({ rejectedAt: S.tradeDocuments.rejectedAt }).from(S.tradeDocuments).where(eq(S.tradeDocuments.id, c.id));
    if (!p && !doc.rejectedAt) { poRef = c; break; }
  }
  if (!poRef) throw new Error("No suitable PO on dev");
  const orgId = poRef.orgId;
  const [orig] = await db.select().from(S.tradeDocuments).where(eq(S.tradeDocuments.id, poRef.id));
  const lines = await db.select().from(S.tradeDocumentLines).where(eq(S.tradeDocumentLines.documentId, orig.id)).orderBy(S.tradeDocumentLines.lineNo);
  let partnerId: string | null = null;
  await db.update(S.tradeDocuments).set({ createdBy: null }).where(eq(S.tradeDocuments.id, orig.id));
  try {
    const p = await E.createPartner(orgId, { partyId: orig.partyId, senderQualifier: "ZZ", senderId: "E2EUS", receiverQualifier: "ZZ", receiverId: "E2ETHEM", requirePartNumber: false }, null);
    partnerId = p.id;
    const out = await E.generatePurchaseOrder850(orgId, orig.id, null);
    await E.markMessageSent(orgId, out.id, null);

    const theirEnv = (ctl: number, test = true) => ({ version: "004010" as const, test, senderQualifier: "ZZ", senderId: "E2ETHEM", receiverQualifier: "ZZ",
      receiverId: "E2EUS", senderAppId: "E2ETHEM", receiverAppId: "E2EUS", controlNo: ctl, now: { date: "20261121", time: "0900" } });

    const f997 = interchange(theirEnv(9001), "FA", "997", [seg("AK1", "PO", out.interchangeNo), seg("AK2", "850", "0001"), seg("AK5", "A"), seg("AK9", "A", "1", "1", "1")]);
    const r1 = await I.receiveEdiFile(orgId, f997, "997.x12", null);
    const [sent] = await db.select().from(S.ediMessages).where(eq(S.ediMessages.id, out.id));
    check("997 found the partner and marked our 850 accepted", !r1.duplicate && r1.results[0]?.outcome === "applied" && sent.ackStatus === "accepted", r1.results[0]?.summary);
    const r2 = await I.receiveEdiFile(orgId, f997, "997-again.x12", null);
    check("uploading the same file again changes nothing", r2.duplicate === true);

    const l1 = lines[0];
    const f855 = interchange(theirEnv(9002), "PR", "855", [seg("BAK", "00", "AC", orig.docNumber, "20261120"),
      seg("PO1", l1.lineNo, "1", ""), seg("ACK", "IQ", "1", "", "068", "20261231")]);
    const r3 = await I.receiveEdiFile(orgId, f855, "855.x12", null);
    const [pending] = await db.select().from(S.poSupplierResponses).where(and(eq(S.poSupplierResponses.documentId, orig.id), eq(S.poSupplierResponses.status, "pending"), like(S.poSupplierResponses.message, "EDI 855%")));
    const [after] = await db.select().from(S.tradeDocuments).where(eq(S.tradeDocuments.id, orig.id));
    const [l1After] = await db.select().from(S.tradeDocumentLines).where(eq(S.tradeDocumentLines.id, l1.id));
    check("855 with a change is stored as a pending proposal", !!pending && r3.results[0]?.outcome === "applied", r3.results[0]?.summary);
    check("the proposal changed nothing on the order", String(l1After.qty) === String(l1.qty) && String(after.promisedDate) === String(orig.promisedDate));
    check("the proposal did not reject the order", !after.rejectedAt);

    const fUnknown = interchange(theirEnv(9003), "PR", "855", [seg("BAK", "00", "AD", "NO-SUCH-PO", "20261120")]);
    const r4 = await I.receiveEdiFile(orgId, fUnknown, "855-unknown.x12", null);
    check("855 for an unknown PO goes to review", r4.results[0]?.outcome === "review" && (r4.message as any)?.status === "review", r4.results[0]?.summary);

    await E.updatePartner(orgId, p.id, { mode: "live" });
    const r5 = await I.receiveEdiFile(orgId, interchange(theirEnv(9004, true), "PR", "855", [seg("BAK", "00", "RJ", orig.docNumber, "20261120")]), "test-to-live.x12", null);
    const [stillOpen] = await db.select({ rejectedAt: S.tradeDocuments.rejectedAt }).from(S.tradeDocuments).where(eq(S.tradeDocuments.id, orig.id));
    check("a test file to a live partner is stored but not applied", (r5.message as any)?.status === "ignored" && !stillOpen.rejectedAt, JSON.stringify({ dup: r5.duplicate, status: (r5.message as any)?.status, results: r5.results, rejected: stillOpen.rejectedAt }));

    const nobody = await I.receiveEdiFile(orgId, f997.replace(/E2ETHEM/g, "XXXTHEM"), "x.x12", null).then(() => null, e => e);
    check("a file from IDs no partner uses is refused", /No EDI partner sends as/.test(nobody?.message ?? ""));
  } finally {
    const resp = await db.select({ id: S.poSupplierResponses.id }).from(S.poSupplierResponses).where(and(eq(S.poSupplierResponses.documentId, orig.id), like(S.poSupplierResponses.message, "EDI 855%")));
    if (resp.length) {
      await db.delete(S.poLineRevisions).where(inArray(S.poLineRevisions.responseId, resp.map(r => r.id)));
      await db.delete(S.poSupplierResponses).where(inArray(S.poSupplierResponses.id, resp.map(r => r.id)));
    }
    if (partnerId) {
      await db.delete(S.ediMessages).where(eq(S.ediMessages.partnerId, partnerId));
      await db.delete(S.ediPartners).where(eq(S.ediPartners.id, partnerId));
    }
    await db.update(S.tradeDocuments).set({ createdBy: orig.createdBy, sentAt: orig.sentAt, confirmedAt: orig.confirmedAt, rejectedAt: orig.rejectedAt, rejectReason: orig.rejectReason, updatedAt: orig.updatedAt })
      .where(eq(S.tradeDocuments.id, orig.id));
    console.log(`cleanup: ${resp.length} supplier response(s), the partner and its files removed; PO restored`);
  }
  if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
  console.log("all passed");
}
main().catch(e => { console.error(e); process.exit(1); });
