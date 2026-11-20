/**
 * Dev-database check of the OUTBOUND 855 (our acknowledgement of a customer's
 * order). Creates a customer partner and part number, uploads their 850 (a
 * Sales Order appears), then checks: an unconfirmed order is refused; once
 * confirmed an 855 is generated that quotes THEIR PO number and line numbers
 * and accepts it as ordered (AD/IA); marking it sent stamps the order sent;
 * after the quantity on the order is changed a new 855 says IQ and the unsent
 * earlier one is voided as superseded; an order with no PO number is refused.
 * Everything created is removed. Dev only.
 *
 *   npx tsx scripts/_e2e_edi_855_out.ts
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
  const O = await import("../lib/edi/outbound-server");
  const { setCustomerPartNumber, deleteCustomerPartNumber } = await import("../lib/inventory/part-numbers-server");
  const { deleteTradeDoc, confirmTradeDoc } = await import("../lib/accounting/trade-documents");
  const { interchange, seg } = await import("../lib/edi/x12/envelope");
  const { readInterchange } = await import("../lib/edi/x12/read");
  const { parse855 } = await import("../lib/edi/x12/inbound");
  const { x12UnitFor } = await import("../lib/edi/validate");

  const custs = await db.select({ id: S.parties.id, orgId: S.parties.orgId }).from(S.parties).where(eq(S.parties.partyType, "customer")).limit(60);
  let pick: { cust: (typeof custs)[number]; itemId: string; unit: string } | null = null;
  for (const c of custs) {
    const [p] = await db.select({ id: S.ediPartners.id }).from(S.ediPartners).where(and(eq(S.ediPartners.orgId, c.orgId), eq(S.ediPartners.partyId, c.id))).limit(1);
    if (p) continue;
    const its = await db.select({ id: S.apItems.id, baseUom: S.apItems.baseUom, productType: S.apItems.productType, canBeSold: S.apItems.canBeSold }).from(S.apItems).where(eq(S.apItems.orgId, c.orgId)).limit(80);
    for (const it of its) {
      if (!["FinishedProduct", "StockItem", "Service", "NonInventory"].includes(String(it.productType)) || it.canBeSold === false) continue;
      const u = x12UnitFor(it.baseUom, {});
      if (u.ok) { pick = { cust: c, itemId: it.id, unit: u.code }; break; }
    }
    if (pick) break;
  }
  if (!pick) throw new Error("No customer with a sellable item on dev");
  const orgId = pick.cust.orgId;
  const tag = Date.now().toString(36).toUpperCase();
  const poNo = `E2E-PO-${tag}`, theirPart = `E2E-BP-${tag}`;
  let partnerId: string | null = null; let partNoId: string | null = null; let soId: string | null = null;
  try {
    const p = await E.createPartner(orgId, { partyId: pick.cust.id, senderQualifier: "ZZ", senderId: "E2EUS", receiverQualifier: "ZZ", receiverId: "E2ECUST" }, null);
    partnerId = p.id;
    partNoId = (await setCustomerPartNumber(orgId, { customerId: pick.cust.id, itemId: pick.itemId, code: theirPart })).id;
    const f850 = interchange({ version: "004010", test: true, senderQualifier: "ZZ", senderId: "E2ECUST", receiverQualifier: "ZZ", receiverId: "E2EUS",
      senderAppId: "E2ECUST", receiverAppId: "E2EUS", controlNo: 9601, now: { date: "20261125", time: "0900" } }, "PO", "850", [
      seg("BEG", "00", "SA", poNo, "", "20261120"), seg("DTM", "002", "20261205"),
      seg("PO1", "10", 7, pick.unit, "12.5", "", "BP", theirPart), seg("CTT", 1)]);
    const r: any = await I.receiveEdiFile(orgId, f850, "850.x12", null);
    soId = r.results[0]?.soId ?? null;
    check("their 850 made a Sales Order", !!soId, r.results[0]?.summary);
    if (!soId) throw new Error("no Sales Order, cannot continue");

    const c0 = await O.checkSalesOrderAck(orgId, soId);
    check("an unconfirmed order is refused, naming why", c0.problems.some(x => /Confirm the order first/.test(x.message)), c0.problems.map(x => x.message).join(" | "));
    const refused: any = await O.generateSalesOrderAck855(orgId, soId, null).then(() => null, e => e);
    check("generating is refused with 422", refused?.status === 422, refused?.message);

    await confirmTradeDoc(orgId, soId, { confirmed: true, promisedDate: "2026-12-05" }, null);
    const m1 = await O.generateSalesOrderAck855(orgId, soId, null);
    const [row] = await db.select().from(S.ediMessages).where(eq(S.ediMessages.id, m1.id));
    const back = parse855(readInterchange(row.payload).groups[0].txns[0].segments);
    check("once confirmed, an 855 quotes THEIR PO number and line number and accepts as ordered",
      back.poNumber === poNo && back.ackType === "AD" && back.lines[0]?.lineNo === "10" && back.lines[0].acks[0]?.status === "IA" && back.lines[0].qty === 7, JSON.stringify(back.lines[0]));
    check("it is waiting to be sent, in test mode, linked to the order", row.status === "generated" && row.docType === "855" && row.test === true && row.appDocType === "SalesOrder" && row.appDocId === soId);

    await db.update(S.tradeDocumentLines).set({ qty: "5" }).where(eq(S.tradeDocumentLines.documentId, soId));
    const m2 = await O.generateSalesOrderAck855(orgId, soId, null);
    const [old] = await db.select().from(S.ediMessages).where(eq(S.ediMessages.id, m1.id));
    const [row2] = await db.select().from(S.ediMessages).where(eq(S.ediMessages.id, m2.id));
    const back2 = parse855(readInterchange(row2.payload).groups[0].txns[0].segments);
    check("after the quantity changes, a new 855 says IQ and the unsent one is voided as superseded",
      back2.ackType === "AC" && back2.lines[0].acks[0]?.status === "IQ" && back2.lines[0].acks[0]?.qty === 5 && old.status === "void" && /Superseded/.test(old.voidReason ?? ""), `${old.status} ${old.voidReason}`);

    await E.markMessageSent(orgId, m2.id, null);
    const [sent] = await db.select({ sentAt: S.tradeDocuments.sentAt }).from(S.tradeDocuments).where(eq(S.tradeDocuments.id, soId));
    check("marking it sent stamps the order sent", !!sent.sentAt);

    await db.update(S.tradeDocuments).set({ partyRef: null }).where(eq(S.tradeDocuments.id, soId));
    const c3 = await O.checkSalesOrderAck(orgId, soId);
    check("an order with no customer PO number is refused", c3.problems.some(x => /no customer PO number/.test(x.message)));
  } finally {
    let removed = 0;
    if (soId) await deleteTradeDoc(orgId, soId, null).then(() => removed++, e => { console.error("could not delete SO", soId, e); failed++; });
    if (partNoId) await deleteCustomerPartNumber(orgId, partNoId);
    if (partnerId) {
      await db.delete(S.ediMessages).where(eq(S.ediMessages.partnerId, partnerId));
      await db.delete(S.ediPartners).where(eq(S.ediPartners.id, partnerId));
    }
    console.log(`cleanup: ${removed} Sales Order, the part number, partner and files removed`);
  }
  if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
  console.log("all passed");
}
main().catch(e => { console.error(e); process.exit(1); });
