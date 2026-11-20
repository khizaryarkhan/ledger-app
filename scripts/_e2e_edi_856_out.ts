/**
 * Dev-database check of the OUTBOUND 856 (our ship notice for a shipment with
 * SSCC packing). Creates a customer partner and part number, uploads their 850
 * (a Sales Order appears), inserts a minimal POSTED shipment with a pallet and
 * a carton directly (no stock or ledger is posted), then checks: the 856
 * quotes THEIR PO number and line number, nests the carton under the pallet
 * with their SSCCs and lists the unpacked rest under the order; once marked
 * sent a regenerated file replaces it (BSN01 05); a shipment line with no
 * Sales Order is refused. Everything created is removed. Dev only.
 *
 *   npx tsx scripts/_e2e_edi_856_out.ts
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
  const { eq, and, inArray } = await import("drizzle-orm");
  const E = await import("../lib/edi/edi-server");
  const I = await import("../lib/edi/inbound-server");
  const O = await import("../lib/edi/outbound-server");
  const { setCustomerPartNumber, deleteCustomerPartNumber } = await import("../lib/inventory/part-numbers-server");
  const { deleteTradeDoc } = await import("../lib/accounting/trade-documents");
  const { interchange, seg } = await import("../lib/edi/x12/envelope");
  const { readInterchange } = await import("../lib/edi/x12/read");
  const { parse856 } = await import("../lib/edi/x12/inbound");
  const { x12UnitFor } = await import("../lib/edi/validate");
  const { gs1CheckDigit } = await import("../lib/gs1");

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
  const sscc = (n: number) => { const body = `35412345${String(Date.now() % 1e8).padStart(8, "0")}${n}`; return body + gs1CheckDigit(body); };
  let partnerId: string | null = null; let partNoId: string | null = null; let soId: string | null = null; let lotId: string | null = null; const shipIds: string[] = [];
  try {
    const p = await E.createPartner(orgId, { partyId: pick.cust.id, senderQualifier: "ZZ", senderId: "E2EUS", receiverQualifier: "ZZ", receiverId: "E2ECUST" }, null);
    partnerId = p.id;
    partNoId = (await setCustomerPartNumber(orgId, { customerId: pick.cust.id, itemId: pick.itemId, code: theirPart })).id;
    const f850 = interchange({ version: "004010", test: true, senderQualifier: "ZZ", senderId: "E2ECUST", receiverQualifier: "ZZ", receiverId: "E2EUS",
      senderAppId: "E2ECUST", receiverAppId: "E2EUS", controlNo: 9701, now: { date: "20261125", time: "0900" } }, "PO", "850", [
      seg("BEG", "00", "SA", poNo, "", "20261120"), seg("DTM", "002", "20261205"),
      seg("PO1", "10", 7, pick.unit, "12.5", "", "BP", theirPart), seg("CTT", 1)]);
    const r: any = await I.receiveEdiFile(orgId, f850, "850.x12", null);
    soId = r.results[0]?.soId ?? null;
    if (!soId) throw new Error(`no Sales Order: ${r.results[0]?.summary}`);
    const [soLine] = await db.select().from(S.tradeDocumentLines).where(eq(S.tradeDocumentLines.documentId, soId));

    const [sh] = await db.insert(S.salesShipments).values({ orgId, shipmentNo: `E2E-SHP-${tag}`, customerId: pick.cust.id, shipmentDate: "2026-11-26", status: "Posted", carrier: "E2E Freight", trackingNo: "E2E-TRK" }).returning();
    shipIds.push(sh.id);
    const [sl] = await db.insert(S.shipmentLines).values({ orgId, shipmentId: sh.id, itemId: pick.itemId, soId, soLineId: soLine.id, qtyBase: "7" }).returning();
    const PALLET = sscc(0), CARTON = sscc(1);
    const [pp] = await db.insert(S.shipmentPackages).values({ orgId, shipmentId: sh.id, sscc: PALLET, packType: "pallet" }).returning();
    const [cp] = await db.insert(S.shipmentPackages).values({ orgId, shipmentId: sh.id, parentId: pp.id, sscc: CARTON, packType: "carton" }).returning();
    await db.insert(S.shipmentPackageLines).values({ orgId, packageId: cp.id, shipmentLineId: sl.id, qtyBase: "5" });

    // The one lot the shipment issued (a lot row and the issue movement; no stock or ledger posting).
    const [lot] = await db.insert(S.inventoryLots).values({ orgId, itemId: pick.itemId, lotNo: `E2E-LOT-${tag}`, supplierBatchNo: `E2E-SB-${tag}`, origQty: "10", remainingQty: "3",
      unitCost: "1", expiryDate: "2027-11-01", productionDate: "2026-11-01" } as any).returning();
    lotId = lot.id;
    await db.insert(S.inventoryMovements).values({ orgId, itemId: pick.itemId, lotId: lot.id, movementType: "issue_sale", qty: "-7", refType: "Shipment", refId: sh.id } as any);

    const c0 = await O.checkShipmentAsn(orgId, sh.id);
    check("a posted shipment against their order can be advised", c0.problems.length === 0 && c0.partner?.receiverId === "E2ECUST", c0.problems.map(x => x.message).join(" | "));
    const m1 = await O.generateShipmentAsn856(orgId, sh.id, null);
    const [row] = await db.select().from(S.ediMessages).where(eq(S.ediMessages.id, m1.id));
    const n = parse856(readInterchange(row.payload).groups[0].txns[0].segments);
    check("the 856 quotes THEIR PO number, the shipment id, carrier and tracking", n.purpose === "00" && n.shipmentId === `E2E-SHP-${tag}` && n.carrier === "E2E Freight" && n.trackingNo === "E2E-TRK" && n.orders[0]?.poNumber === poNo, JSON.stringify({ p: n.purpose, id: n.shipmentId, po: n.orders[0]?.poNumber }));
    check("the carton is nested under the pallet with their SSCCs", n.orders[0].packages.some(x => x.sscc === CARTON && x.level === "pack" && x.parentSscc === PALLET) && n.orders[0].packages.some(x => x.sscc === PALLET && x.level === "tare"));
    const packed = n.orders[0].items.find(i => i.sscc === CARTON), loose = n.orders[0].items.find(i => i.sscc === null);
    check("the packed goods are in the carton and the rest is listed under the order, in THEIR line number", packed?.qty === 5 && packed?.lineNo === "10" && packed?.ids.BP === theirPart && loose?.qty === 2 && loose?.lineNo === "10", JSON.stringify({ packed: packed?.qty, loose: loose?.qty }));
    check("the goods from the one lot carry its batch (the supplier's printed one) and dates, packed and loose", n.orders[0].items.length === 2 && n.orders[0].items.every(i => i.batch === `E2E-SB-${tag}` && i.productionDate === "2026-11-01" && i.expiryDate === "2027-11-01"), JSON.stringify(n.orders[0].items.map(i => [i.batch, i.expiryDate])));
    check("it is waiting to be sent, linked to the shipment", row.status === "generated" && row.docType === "856" && row.appDocType === "Shipment" && row.appDocId === sh.id);

    await E.markMessageSent(orgId, m1.id, null);
    const m2 = await O.generateShipmentAsn856(orgId, sh.id, null);
    const [row2] = await db.select().from(S.ediMessages).where(eq(S.ediMessages.id, m2.id));
    check("after it was sent, a regenerated file replaces it (BSN01 05)", parse856(readInterchange(row2.payload).groups[0].txns[0].segments).purpose === "05");

    const [sh2] = await db.insert(S.salesShipments).values({ orgId, shipmentNo: `E2E-SHP2-${tag}`, customerId: pick.cust.id, shipmentDate: "2026-11-26", status: "Posted" }).returning();
    shipIds.push(sh2.id);
    await db.insert(S.shipmentLines).values({ orgId, shipmentId: sh2.id, itemId: pick.itemId, qtyBase: "1" });
    const c2 = await O.checkShipmentAsn(orgId, sh2.id);
    check("a shipment line with no Sales Order is refused", c2.problems.some(x => /has no Sales Order/.test(x.message)), c2.problems.map(x => x.message).join(" | "));
  } finally {
    if (shipIds.length) await db.delete(S.inventoryMovements).where(and(eq(S.inventoryMovements.orgId, orgId), eq(S.inventoryMovements.refType, "Shipment"), inArray(S.inventoryMovements.refId, shipIds)));
    if (lotId) await db.delete(S.inventoryLots).where(eq(S.inventoryLots.id, lotId));
    if (shipIds.length) await db.delete(S.salesShipments).where(inArray(S.salesShipments.id, shipIds));
    let removed = 0;
    if (soId) await deleteTradeDoc(orgId, soId, null).then(() => removed++, e => { console.error("could not delete SO", soId, e); failed++; });
    if (partNoId) await deleteCustomerPartNumber(orgId, partNoId);
    if (partnerId) {
      await db.delete(S.ediMessages).where(eq(S.ediMessages.partnerId, partnerId));
      await db.delete(S.ediPartners).where(eq(S.ediPartners.id, partnerId));
    }
    console.log(`cleanup: ${shipIds.length} shipment(s), ${removed} Sales Order, the part number, partner and files removed`);
  }
  if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
  console.log("all passed");
}
main().catch(e => { console.error(e); process.exit(1); });
