/**
 * Dev-database check of EDI 856 (ship notice → expected delivery). Uploads the
 * supplier's 856 files for a dev PO and checks: an ASN delivery is recorded for
 * the PO line in base units; a replay changes nothing; the same shipment sent
 * again as an original goes to review; a replacement (05) replaces it; a cancel
 * (01) cancels it; an unknown PO goes to review. Everything created is removed.
 * Refuses to run against anything but the dev endpoint.
 *
 *   npx tsx scripts/_e2e_edi_856.ts
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
  const { eq, and, isNotNull, like } = await import("drizzle-orm");
  const E = await import("../lib/edi/edi-server");
  const I = await import("../lib/edi/inbound-server");
  const { interchange, seg } = await import("../lib/edi/x12/envelope");
  const { x12UnitFor } = await import("../lib/edi/validate");

  const candidates = await db.select({ id: S.tradeDocuments.id, orgId: S.tradeDocuments.orgId, partyId: S.tradeDocuments.partyId, docNumber: S.tradeDocuments.docNumber,
    lineId: S.tradeDocumentLines.id, lineNo: S.tradeDocumentLines.lineNo, orderUom: S.tradeDocumentLines.orderUom, per: S.tradeDocumentLines.unitsPerOrderUnit, baseUom: S.apItems.baseUom })
    .from(S.tradeDocuments).innerJoin(S.tradeDocumentLines, eq(S.tradeDocumentLines.documentId, S.tradeDocuments.id))
    .innerJoin(S.apItems, eq(S.apItems.id, S.tradeDocumentLines.itemId))
    .where(and(eq(S.tradeDocuments.kind, "PurchaseOrder"), isNotNull(S.tradeDocuments.partyId), isNotNull(S.tradeDocuments.docNumber))).limit(40);
  let po: (typeof candidates)[number] | undefined; let unitCode = "";
  for (const c of candidates) {
    const [p] = await db.select({ id: S.ediPartners.id }).from(S.ediPartners).where(and(eq(S.ediPartners.orgId, c.orgId), eq(S.ediPartners.partyId, c.partyId!))).limit(1);
    const u = x12UnitFor(c.orderUom || c.baseUom, {});
    if (!p && u.ok) { po = c; unitCode = u.code; break; }
  }
  if (!po) throw new Error("No suitable PO on dev");
  const orgId = po.orgId, per = Number(po.per || 1);
  const ref = `E2E-ASN-${Date.now().toString(36).toUpperCase()}`;
  let partnerId: string | null = null;
  try {
    const p = await E.createPartner(orgId, { partyId: po.partyId, senderQualifier: "ZZ", senderId: "E2EUS", receiverQualifier: "ZZ", receiverId: "E2ETHEM", requirePartNumber: false }, null);
    partnerId = p.id;
    const env = (ctl: number) => ({ version: "004010" as const, test: true, senderQualifier: "ZZ", senderId: "E2ETHEM", receiverQualifier: "ZZ",
      receiverId: "E2EUS", senderAppId: "E2ETHEM", receiverAppId: "E2EUS", controlNo: ctl, now: { date: "20261121", time: "0900" } });
    const asn = (ctl: number, purpose: string, qty: number, poNumber = po!.docNumber!) => interchange(env(ctl), "SH", "856", [
      seg("BSN", purpose, ref, "20261121", "0900"), seg("HL", "1", "", "S"), seg("TD5", "B", "2", "", "M", "E2E Freight"), seg("DTM", "011", "20261121"), seg("DTM", "017", "20261124"),
      seg("HL", "2", "1", "O"), seg("PRF", poNumber), seg("HL", "3", "2", "I"), seg("LIN", po!.lineNo, "LT", "E2E-B1"), seg("SN1", "", qty, unitCode), seg("CTT", "1")]);
    const active = () => db.select().from(S.expectedDeliveries).where(and(eq(S.expectedDeliveries.orgId, orgId), eq(S.expectedDeliveries.reference, ref)));

    const r1 = await I.receiveEdiFile(orgId, asn(9101, "00", 3), "856.x12", null);
    const [d1] = await active();
    const [l1] = d1 ? await db.select().from(S.expectedDeliveryLines).where(eq(S.expectedDeliveryLines.expectedDeliveryId, d1.id)) : [];
    check("856 recorded an ASN delivery for the PO", r1.results[0]?.outcome === "applied" && d1?.source === "asn" && d1?.poId === po.id && d1?.expectedDate === "2026-11-24", r1.results[0]?.summary);
    check("the line is the PO line, in base units, with the batch", l1?.poLineId === po.lineId && Number(l1?.qtyBase) === 3 * per && l1?.supplierBatchNo === "E2E-B1", `qty ${l1?.qtyBase}`);

    const r2 = await I.receiveEdiFile(orgId, asn(9101, "00", 3), "856-again.x12", null);
    check("uploading the same file again changes nothing", r2.duplicate === true && (await active()).length === 1);

    const r3 = await I.receiveEdiFile(orgId, asn(9102, "00", 3), "856-resent.x12", null);
    check("the same shipment sent again as an original goes to review", r3.results[0]?.outcome === "review" && /already recorded/.test(r3.results[0]?.summary ?? ""), r3.results[0]?.summary);

    const r4 = await I.receiveEdiFile(orgId, asn(9103, "05", 5), "856-replace.x12", null);
    const after = await active();
    const [l4] = after[0] ? await db.select().from(S.expectedDeliveryLines).where(eq(S.expectedDeliveryLines.expectedDeliveryId, after[0].id)) : [];
    check("a replacement replaces it: one delivery, the new quantity", r4.results[0]?.outcome === "applied" && after.length === 1 && after[0].id !== d1?.id && Number(l4?.qtyBase) === 5 * per, r4.results[0]?.summary);

    const r5 = await I.receiveEdiFile(orgId, asn(9104, "01", 5), "856-cancel.x12", null);
    const [c5] = await active();
    check("a cancel cancels it", r5.results[0]?.outcome === "applied" && c5?.status === "cancelled", r5.results[0]?.summary);

    const r6 = await I.receiveEdiFile(orgId, asn(9105, "00", 1, "NO-SUCH-PO"), "856-unknown.x12", null);
    check("an unknown PO goes to review", r6.results[0]?.outcome === "review" && (r6.message as any)?.status === "review", r6.results[0]?.summary);
  } finally {
    const gone = await db.delete(S.expectedDeliveries).where(and(eq(S.expectedDeliveries.orgId, orgId), like(S.expectedDeliveries.reference, "E2E-ASN-%"))).returning({ id: S.expectedDeliveries.id });
    if (partnerId) {
      await db.delete(S.ediMessages).where(eq(S.ediMessages.partnerId, partnerId));
      await db.delete(S.ediPartners).where(eq(S.ediPartners.id, partnerId));
    }
    console.log(`cleanup: ${gone.length} expected deliveries, the partner and its files removed`);
  }
  if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
  console.log("all passed");
}
main().catch(e => { console.error(e); process.exit(1); });
