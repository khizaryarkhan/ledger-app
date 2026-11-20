/**
 * Dev-database check of the INBOUND 850 (a customer's order → a Sales Order).
 * Finds a customer and a sellable item, registers the customer's part number
 * for it, then uploads 850 files and checks: a Sales Order is created with the
 * customer's PO number in party_ref and the line in OUR unit; a replay changes
 * nothing; the same PO number sent in a new file is not created twice; an
 * unknown part number creates nothing; a ship-to we do not know creates
 * nothing; a change (BEG01 05) is not applied. Everything created is removed.
 * Refuses to run against anything but the dev endpoint.
 *
 *   npx tsx scripts/_e2e_edi_850_in.ts
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
  const { eq, and, like, inArray } = await import("drizzle-orm");
  const E = await import("../lib/edi/edi-server");
  const I = await import("../lib/edi/inbound-server");
  const { setCustomerPartNumber, deleteCustomerPartNumber } = await import("../lib/inventory/part-numbers-server");
  const { deleteTradeDoc } = await import("../lib/accounting/trade-documents");
  const { interchange, seg } = await import("../lib/edi/x12/envelope");
  const { x12UnitFor } = await import("../lib/edi/validate");

  const custs = await db.select({ id: S.parties.id, orgId: S.parties.orgId, name: S.parties.name }).from(S.parties).where(eq(S.parties.partyType, "customer")).limit(60);
  let pick: { cust: (typeof custs)[number]; item: { id: string; baseUom: string | null; name: string }; unit: string } | null = null;
  for (const c of custs) {
    const [p] = await db.select({ id: S.ediPartners.id }).from(S.ediPartners).where(and(eq(S.ediPartners.orgId, c.orgId), eq(S.ediPartners.partyId, c.id))).limit(1);
    if (p) continue;
    const its = await db.select({ id: S.apItems.id, baseUom: S.apItems.baseUom, name: S.apItems.name, productType: S.apItems.productType, canBeSold: S.apItems.canBeSold })
      .from(S.apItems).where(eq(S.apItems.orgId, c.orgId)).limit(80);
    for (const it of its) {
      if (!["FinishedProduct", "StockItem", "Service", "NonInventory"].includes(String(it.productType)) || it.canBeSold === false) continue;
      const u = x12UnitFor(it.baseUom, {});
      if (u.ok) { pick = { cust: c, item: it, unit: u.code }; break; }
    }
    if (pick) break;
  }
  if (!pick) throw new Error("No customer with a sellable item on dev");
  const orgId = pick.cust.orgId;
  const tag = Date.now().toString(36).toUpperCase();
  const theirPart = `E2E-BP-${tag}`;
  const poNo = `E2E-PO-${tag}`;
  let partnerId: string | null = null; let partNoId: string | null = null;
  const env = (ctl: number) => ({ version: "004010" as const, test: true, senderQualifier: "ZZ", senderId: "E2ECUST", receiverQualifier: "ZZ",
    receiverId: "E2EUS", senderAppId: "E2ECUST", receiverAppId: "E2EUS", controlNo: ctl, now: { date: "20261125", time: "0900" } });
  const f850 = (ctl: number, o: { po?: string; bp?: string; purpose?: string; shipTo?: string; unit?: string } = {}) => interchange(env(ctl), "PO", "850", [
    seg("BEG", o.purpose ?? "00", "SA", o.po ?? poNo, "", "20261120"), seg("DTM", "002", "20261205"),
    ...(o.shipTo ? [seg("N1", "ST", "Nowhere DC", "UL", o.shipTo)] : []),
    seg("PO1", 1, 7, o.unit ?? pick!.unit, "12.5", "", "BP", o.bp ?? theirPart), seg("CTT", 1)]);
  const soFor = (ref: string) => db.select().from(S.tradeDocuments).where(and(eq(S.tradeDocuments.orgId, orgId), eq(S.tradeDocuments.kind, "SalesOrder"), eq(S.tradeDocuments.partyRef, ref)));
  try {
    const p = await E.createPartner(orgId, { partyId: pick.cust.id, senderQualifier: "ZZ", senderId: "E2EUS", receiverQualifier: "ZZ", receiverId: "E2ECUST" }, null);
    partnerId = p.id;
    check("a customer partner defaults to 855, 856 and 810 out", JSON.stringify(p.docsOut) === JSON.stringify(["855", "856", "810"]), JSON.stringify(p.docsOut));
    const pn = await setCustomerPartNumber(orgId, { customerId: pick.cust.id, itemId: pick.item.id, code: theirPart });
    partNoId = pn.id;

    const r1: any = await I.receiveEdiFile(orgId, f850(9501), "850.x12", null);
    const [so] = await soFor(poNo);
    const lines = so ? await db.select().from(S.tradeDocumentLines).where(eq(S.tradeDocumentLines.documentId, so.id)) : [];
    check("a Sales Order is created with their PO number, in our unit", !!so && so.partyId === pick!.cust.id && lines.length === 1 && lines[0].itemId === pick!.item.id
      && Number(lines[0].qty) === 7 && Number(lines[0].rate) === 12.5 && so.expiryDate === "2026-12-05" && r1.results[0]?.soId === so.id, `${r1.results[0]?.summary} ${(r1.results[0]?.reasons ?? []).join(" ")}`);
    check("the file is linked to the Sales Order and nothing posted", r1.message?.appDocType === "SalesOrder" && r1.message?.appDocId === so?.id && !so?.convertedEntryId);

    const r2: any = await I.receiveEdiFile(orgId, f850(9501), "850-again.x12", null);
    check("uploading the same file again changes nothing", r2.duplicate === true);

    const r3: any = await I.receiveEdiFile(orgId, f850(9502), "850-resent.x12", null);
    check("the same PO number in a new file is not created twice", (await soFor(poNo)).length === 1 && r3.results[0]?.outcome === "review" && /already/.test(r3.results[0]?.summary ?? ""), r3.results[0]?.summary);

    const r4: any = await I.receiveEdiFile(orgId, f850(9503, { po: `${poNo}-B`, bp: "NO-SUCH-PART" }), "850-unknown.x12", null);
    check("an unknown part number creates nothing and goes to review", (await soFor(`${poNo}-B`)).length === 0 && r4.results[0]?.outcome === "review" && /none of BP NO-SUCH-PART is known/.test(r4.results[0]?.reasons.join(" ")), r4.results[0]?.reasons.join(" "));

    const r5: any = await I.receiveEdiFile(orgId, f850(9504, { po: `${poNo}-C`, shipTo: "0000000000000" }), "850-shipto.x12", null);
    check("a ship-to we do not know creates nothing", (await soFor(`${poNo}-C`)).length === 0 && /is not one of .* delivery addresses/.test(r5.results[0]?.summary ?? ""), r5.results[0]?.summary);

    const r6: any = await I.receiveEdiFile(orgId, f850(9505, { po: `${poNo}-D`, purpose: "05" }), "850-change.x12", null);
    check("a change (BEG01 05) is not applied", (await soFor(`${poNo}-D`)).length === 0 && /not read yet/.test(r6.results[0]?.summary ?? ""), r6.results[0]?.summary);

    const r7: any = await I.receiveEdiFile(orgId, f850(9506, { po: `${poNo}-E`, unit: "ZZ" }), "850-unit.x12", null);
    check("a quantity in a unit that is not ours creates nothing", (await soFor(`${poNo}-E`)).length === 0 && /ordered in ZZ/.test(r7.results[0]?.reasons.join(" ") ?? ""), r7.results[0]?.reasons.join(" "));
  } finally {
    const sos = await db.select({ id: S.tradeDocuments.id }).from(S.tradeDocuments).where(and(eq(S.tradeDocuments.orgId, orgId), like(S.tradeDocuments.partyRef, "E2E-PO-%")));
    for (const s of sos) await deleteTradeDoc(orgId, s.id, null).catch(e => { console.error("could not delete SO", s.id, e); failed++; });
    if (partNoId) await deleteCustomerPartNumber(orgId, partNoId);
    if (partnerId) {
      await db.delete(S.ediMessages).where(eq(S.ediMessages.partnerId, partnerId));
      await db.delete(S.ediPartners).where(eq(S.ediPartners.id, partnerId));
    }
    const left = sos.length ? await db.select({ id: S.tradeDocuments.id }).from(S.tradeDocuments).where(inArray(S.tradeDocuments.id, sos.map(s => s.id))) : [];
    console.log(`cleanup: ${sos.length} Sales Order(s) removed (${left.length} left), the part number, partner and files removed`);
    if (left.length) failed++;
  }
  if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
  console.log("all passed");
}
main().catch(e => { console.error(e); process.exit(1); });
