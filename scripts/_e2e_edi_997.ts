/**
 * Dev-database check of our outbound 997. A partner set to receive 997s gets
 * one ready to send for each file it sends; it acknowledges exactly the
 * received group; asking again returns the same one; after voiding, a new one
 * takes a new control number; their own 997 is never acknowledged; a partner
 * without 997 switched on gets none until a person asks. Nothing posts.
 * Everything created is removed. Refuses to run against anything but dev.
 *
 *   npx tsx scripts/_e2e_edi_997.ts
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
  const { eq, and } = await import("drizzle-orm");
  const E = await import("../lib/edi/edi-server");
  const I = await import("../lib/edi/inbound-server");
  const { interchange, seg } = await import("../lib/edi/x12/envelope");
  const { readInterchange } = await import("../lib/edi/x12/read");
  const { parse997 } = await import("../lib/edi/x12/inbound");

  const sups = await db.select({ id: S.parties.id, orgId: S.parties.orgId }).from(S.parties).where(eq(S.parties.partyType, "supplier")).limit(50);
  let sup: (typeof sups)[number] | undefined;
  for (const s of sups) {
    const [p] = await db.select({ id: S.ediPartners.id }).from(S.ediPartners).where(and(eq(S.ediPartners.orgId, s.orgId), eq(S.ediPartners.partyId, s.id))).limit(1);
    if (!p) { sup = s; break; }
  }
  if (!sup) throw new Error("No supplier without an EDI partner on dev");
  const orgId = sup.orgId;
  const env = (ctl: number) => ({ version: "004010" as const, test: true, senderQualifier: "ZZ", senderId: "E2ETHEM", receiverQualifier: "ZZ",
    receiverId: "E2EUS", senderAppId: "E2ETHEM", receiverAppId: "E2EUS", controlNo: ctl, now: { date: "20261125", time: "0900" } });
  const anInvoice = (ctl: number) => interchange(env(ctl), "IN", "810", [seg("BIG", "20261125", "E2E-997", "", "NO-SUCH-PO"), seg("CTT", "0")]);
  let partnerId: string | null = null;
  try {
    const p = await E.createPartner(orgId, { partyId: sup.id, senderQualifier: "ZZ", senderId: "E2EUS", receiverQualifier: "ZZ", receiverId: "E2ETHEM", docsOut: ["850", "997"] }, null);
    partnerId = p.id;

    const r1: any = await I.receiveEdiFile(orgId, anInvoice(9401), "810.x12", null);
    const [ack] = r1.ack ? await db.select().from(S.ediMessages).where(eq(S.ediMessages.id, r1.ack.id)) : [];
    const read = ack ? readInterchange(ack.payload) : null;
    const parsed = read ? parse997(read.groups[0].txns[0].segments) : null;
    check("a received file gets our 997, waiting to be sent", ack?.direction === "out" && ack?.docType === "997" && ack?.status === "generated" && ack?.appDocId === r1.message.id, ack?.fileName);
    check("it acknowledges exactly the received group, accepted, addressed back to them", parsed?.functionalId === "IN" && parsed?.groupControlNo === 9401 && parsed?.groupStatus === "accepted" && read?.receiverId === "E2ETHEM" && read?.test === true, JSON.stringify(parsed));

    const again: any = await I.generateAck997(orgId, r1.message.id, null);
    check("asking again returns the same 997", again.already === true && again.id === ack?.id);

    await E.voidMessage(orgId, ack!.id, "E2E: superseded", null);
    const fresh: any = await I.generateAck997(orgId, r1.message.id, null);
    check("after voiding, a new 997 takes a new control number", fresh.already === false && fresh.id !== ack?.id && fresh.interchangeNo !== ack?.interchangeNo, `${ack?.interchangeNo} → ${fresh.interchangeNo}`);

    const their997: any = await I.receiveEdiFile(orgId, interchange(env(9402), "FA", "997", [seg("AK1", "PO", "1"), seg("AK9", "A", "1", "1", "1")]), "997.x12", null);
    const refused = await I.generateAck997(orgId, their997.message.id, null).then(() => null, e => e);
    check("their 997 is never acknowledged", !their997.ack && /never acknowledged/.test(refused?.message ?? ""), refused?.message);

    await E.updatePartner(orgId, p.id, { docsOut: ["850"] });
    const r3: any = await I.receiveEdiFile(orgId, anInvoice(9403), "810-b.x12", null);
    const manual: any = await I.generateAck997(orgId, r3.message.id, null);
    check("without 997 switched on, none is made until a person asks", !r3.ack && manual.docType === "997" && manual.already === false);
  } finally {
    if (partnerId) {
      await db.delete(S.ediMessages).where(eq(S.ediMessages.partnerId, partnerId));
      await db.delete(S.ediPartners).where(eq(S.ediPartners.id, partnerId));
    }
    console.log("cleanup: the partner and its files removed");
  }
  if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
  console.log("all passed");
}
main().catch(e => { console.error(e); process.exit(1); });
