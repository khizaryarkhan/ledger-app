/**
 * Dev-database check of our 999 and TA1, and of reading theirs. A partner set to receive them gets each ready to send for every
 * file it sends; each answers exactly what it should; asking again returns the same one, even for two simultaneous requests
 * (the unique indexes of 0150); an acknowledgement is never acknowledged; their TA1 and 999 mark the outbound file they
 * answer, a worse answer is never overwritten by a better one, and one about a file we never sent goes to review. Nothing posts.
 * Everything created is removed. Refuses to run against anything but dev.
 *
 *   npx tsx scripts/_e2e_edi_acks.ts
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
  const { interchange, interchangeBare, seg } = await import("../lib/edi/x12/envelope");
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
  const anInvoice = (ctl: number) => interchange(env(ctl), "IN", "810", [seg("BIG", "20261125", "E2E-ACK", "", "NO-SUCH-PO"), seg("CTT", "0")]);
  const theirTa1 = (ctl: number, about: number, status: string, note: string) => interchangeBare(env(ctl), [seg("TA1", String(about).padStart(9, "0"), "261125", "0900", status, note)]);
  const their999 = (ctl: number, about: number, status: string) => interchange(env(ctl), "FA", "999", [seg("AK1", "IN", about, "004010"), seg("AK2", "810", "0001"), seg("IK5", status), seg("AK9", status, 1, 1, status === "A" ? 1 : 0)]);
  let partnerId: string | null = null;
  try {
    const p = await E.createPartner(orgId, { partyId: sup.id, senderQualifier: "ZZ", senderId: "E2EUS", receiverQualifier: "ZZ", receiverId: "E2ETHEM", docsOut: ["850", "997", "999", "TA1"] }, null);
    partnerId = p.id;

    const r1: any = await I.receiveEdiFile(orgId, anInvoice(9501), "810.x12", null);
    const made = await Promise.all((r1.acks as any[]).map(a => db.select().from(S.ediMessages).where(eq(S.ediMessages.id, a.id)).then(x => x[0])));
    const by = (t: string) => made.find(m => m?.docType === t);
    check("a received file gets our 997, 999 and TA1, each waiting to be sent", made.length === 3 && ["997", "999", "TA1"].every(t => by(t)?.status === "generated" && by(t)?.direction === "out" && by(t)?.appDocId === r1.message.id), made.map(m => m?.fileName).join(", "));

    const ta1 = readInterchange(by("TA1").payload);
    check("our TA1 has no group and echoes their interchange control number, accepted", ta1.groups.length === 0 && ta1.interchangeAcks[0]?.controlNo === 9501 && ta1.interchangeAcks[0]?.status === "A", JSON.stringify(ta1.interchangeAcks));
    const n999 = parse997(readInterchange(by("999").payload).groups[0].txns[0].segments);
    check("our 999 acknowledges exactly the received group, accepted", n999.functionalId === "IN" && n999.groupControlNo === 9501 && n999.groupStatus === "accepted", JSON.stringify(n999));

    const again: any = await I.generateAck(orgId, r1.message.id, null, "TA1");
    check("asking again for the TA1 returns the same one", again.already === true && again.id === by("TA1").id);

    // Two simultaneous requests, for a file that has neither yet: the 0150 unique indexes make it exactly one each.
    await E.updatePartner(orgId, p.id, { docsOut: ["850"] });
    const r2: any = await I.receiveEdiFile(orgId, anInvoice(9502), "810-b.x12", null);
    check("a partner with none switched on gets none until a person asks", (r2.acks ?? []).length === 0);
    const [t1, t2, n1, n2] = await Promise.all(["TA1", "TA1", "999", "999"].map(t => I.generateAck(orgId, r2.message.id, null, t as any)));
    const live = await db.select({ id: S.ediMessages.id, docType: S.ediMessages.docType }).from(S.ediMessages).where(and(eq(S.ediMessages.partnerId, p.id), eq(S.ediMessages.appDocId, r2.message.id)));
    check("two simultaneous requests make exactly one TA1 and one 999, and both callers get it", live.filter(l => l.docType === "TA1").length === 1 && live.filter(l => l.docType === "999").length === 1 && t1.id === t2.id && n1.id === n2.id, live.map(l => l.docType).join("/"));

    // Their acknowledgements of OUR files. Our TA1 and 999 files stand in as the outbound files they answer.
    const ours = by("TA1");
    const rej: any = await I.receiveEdiFile(orgId, theirTa1(9503, ours.interchangeNo, "R", "025"), "ta1-r.x12", null);
    let [mark] = await db.select().from(S.ediMessages).where(eq(S.ediMessages.id, ours.id));
    check("their TA1 marks the outbound file rejected, naming the reason in words", mark.ackStatus === "rejected" && /duplicates an earlier one/.test(mark.error ?? "") && rej.message.docType === "TA1" && rej.message.status === "review", `${mark.ackStatus}: ${mark.error}`);

    await I.receiveEdiFile(orgId, theirTa1(9504, ours.interchangeNo, "A", "000"), "ta1-a.x12", null);
    [mark] = await db.select().from(S.ediMessages).where(eq(S.ediMessages.id, ours.id));
    check("a later 'accepted' TA1 does not hide the rejection", mark.ackStatus === "rejected");

    const unknown: any = await I.receiveEdiFile(orgId, theirTa1(9505, 424242, "A", "000"), "ta1-x.x12", null);
    check("a TA1 about an interchange we never sent goes to review", unknown.results?.[0]?.outcome === "review" && /no record of sending/.test(unknown.results?.[0]?.summary ?? ""));

    const mine999 = by("999");
    await I.receiveEdiFile(orgId, their999(9506, mine999.groupNo, "R"), "999-r.x12", null);
    const [m999] = await db.select().from(S.ediMessages).where(eq(S.ediMessages.id, mine999.id));
    check("their 999 marks the outbound file it answers", m999.ackStatus === "rejected", String(m999.ackStatus));

    const refused = await I.generateAck(orgId, rej.message.id, null, "TA1").then(() => null, e => e);
    check("their TA1 is never acknowledged", /never acknowledged/.test(refused?.message ?? ""), refused?.message);
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
