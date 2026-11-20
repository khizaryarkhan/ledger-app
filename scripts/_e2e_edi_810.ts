/**
 * Dev-database check of EDI 810 (supplier invoice → a bill a person creates).
 * Picks a PO whose oldest unbilled receipt is all PO lines, builds an 810 for
 * exactly what is waiting, and checks: the upload proposes that receipt and
 * posts nothing; a replay changes nothing; "Create bill" posts the bill and
 * bills the receipt; a second create is refused; the same invoice number sent
 * again is recognised as recorded; a quantity that matches nothing proposes no
 * bill. The bill is then deleted (which un-bills the receipt) and the partner
 * and files removed. Refuses to run against anything but the dev endpoint.
 *
 *   npx tsx scripts/_e2e_edi_810.ts
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
  const { eq, and, inArray, isNotNull, asc } = await import("drizzle-orm");
  const E = await import("../lib/edi/edi-server");
  const I = await import("../lib/edi/inbound-server");
  const B = await import("../lib/accounting/edi-bill-server");
  const { deleteDocument } = await import("../lib/accounting/documents");
  const { interchange, seg } = await import("../lib/edi/x12/envelope");
  const { x12UnitFor } = await import("../lib/edi/validate");

  // Oldest unbilled receipt of a PO, whose unbilled lines all belong to that PO and have a cost.
  const heads = await db.select().from(S.goodsReceipts).where(and(eq(S.goodsReceipts.status, "Posted"), isNotNull(S.goodsReceipts.supplierId))).orderBy(asc(S.goodsReceipts.receiptDate)).limit(200);
  type Pick = { orgId: string; supplierId: string; poId: string; poNumber: string; receiptId: string; lines: { poLineId: string; lineNo: number; qty: number; price: number; unit: string }[] };
  let pick: Pick | null = null;
  for (const h of heads) {
    const ls = (await db.select().from(S.goodsReceiptLines).where(eq(S.goodsReceiptLines.receiptId, h.id))).filter(l => Number(l.qtyBase) - Number(l.billedQty) > 1e-6);
    if (!ls.length || ls.some(l => !l.poId || !l.poLineId || Number(l.unitCost) <= 0) || new Set(ls.map(l => l.poId)).size !== 1) continue;
    const poId = ls[0].poId!;
    const [po] = await db.select().from(S.tradeDocuments).where(eq(S.tradeDocuments.id, poId));
    if (!po?.docNumber || po.partyId !== h.supplierId) continue;
    const [p] = await db.select({ id: S.ediPartners.id }).from(S.ediPartners).where(and(eq(S.ediPartners.orgId, h.orgId), eq(S.ediPartners.partyId, po.partyId!))).limit(1);
    if (p) continue;
    // Nothing else on this PO still waiting, so this receipt is the one the match should pick.
    const all = await db.select({ q: S.goodsReceiptLines.qtyBase, b: S.goodsReceiptLines.billedQty, rid: S.goodsReceiptLines.receiptId })
      .from(S.goodsReceiptLines).where(eq(S.goodsReceiptLines.poId, poId));
    if (all.some(o => o.rid !== h.id && Number(o.q) - Number(o.b) > 1e-6)) continue;
    const poLines = await db.select({ id: S.tradeDocumentLines.id, lineNo: S.tradeDocumentLines.lineNo, baseUom: S.apItems.baseUom })
      .from(S.tradeDocumentLines).leftJoin(S.apItems, eq(S.apItems.id, S.tradeDocumentLines.itemId)).where(inArray(S.tradeDocumentLines.id, ls.map(l => l.poLineId!)));
    const fx = Number(h.exchangeRate) || 1;
    const byLine = new Map<string, Pick["lines"][number]>();
    let ok = true;
    for (const l of ls) {
      const pl = poLines.find(x => x.id === l.poLineId);
      const u = x12UnitFor(pl?.baseUom ?? null, {});
      if (!pl || u.ok === false) { ok = false; break; }
      const cur = byLine.get(pl.id);
      const qty = Number(l.qtyBase) - Number(l.billedQty);
      if (cur) { if (Math.abs(cur.price - Number(l.unitCost) / fx) > 1e-9) { ok = false; break; } cur.qty += qty; }
      else byLine.set(pl.id, { poLineId: pl.id, lineNo: pl.lineNo, qty, price: Number(l.unitCost) / fx, unit: u.code });
    }
    if (!ok) continue;
    pick = { orgId: h.orgId, supplierId: po.partyId!, poId, poNumber: po.docNumber, receiptId: h.id, lines: [...byLine.values()] };
    break;
  }
  if (!pick) throw new Error("No suitable unbilled receipt on dev");
  const { orgId } = pick;
  const invNo = `E2E-INV-${Date.now().toString(36).toUpperCase()}`;
  const billedBefore = new Map((await db.select().from(S.goodsReceiptLines).where(eq(S.goodsReceiptLines.receiptId, pick.receiptId))).map(l => [l.id, Number(l.billedQty)]));
  const env = (ctl: number) => ({ version: "004010" as const, test: true, senderQualifier: "ZZ", senderId: "E2ETHEM", receiverQualifier: "ZZ",
    receiverId: "E2EUS", senderAppId: "E2ETHEM", receiverAppId: "E2EUS", controlNo: ctl, now: { date: "20261125", time: "0900" } });
  const f810 = (ctl: number, no: string, qtyFactor = 1) => interchange(env(ctl), "IN", "810", [
    seg("BIG", "20261125", no, "", pick!.poNumber), seg("ITD", "01", "3", "", "", "", "", "30"),
    ...pick!.lines.map(l => seg("IT1", l.lineNo, Math.round(l.qty * qtyFactor * 1e6) / 1e6, l.unit, Math.round(l.price * 1e6) / 1e6)), seg("CTT", pick!.lines.length)]);
  const billedNow = async () => (await db.select().from(S.goodsReceiptLines).where(eq(S.goodsReceiptLines.receiptId, pick!.receiptId))).map(l => Number(l.billedQty) - (billedBefore.get(l.id) ?? 0));

  let partnerId: string | null = null; let billId: string | null = null;
  try {
    const p = await E.createPartner(orgId, { partyId: pick.supplierId, senderQualifier: "ZZ", senderId: "E2EUS", receiverQualifier: "ZZ", receiverId: "E2ETHEM", requirePartNumber: false }, null);
    partnerId = p.id;

    const bad = await I.receiveEdiFile(orgId, f810(9200, `${invNo}-X`, 3), "810-bad.x12", null);
    check("an invoice that matches no receipts proposes no bill", !(bad.results[0] as any)?.proposal && bad.results[0]?.outcome === "review", bad.results[0]?.reasons.join(" "));

    const r1 = await I.receiveEdiFile(orgId, f810(9201, invNo), "810.x12", null);
    const res = r1.results[0] as any;
    check("810 proposes a bill from the receipt, and posts nothing", res?.outcome === "review" && res?.proposal?.receiptIds?.join() === pick.receiptId && (await billedNow()).every(x => Math.abs(x) < 1e-9), `${res?.summary} ${(res?.reasons ?? []).join(" ")}`);
    const r2 = await I.receiveEdiFile(orgId, f810(9201, invNo), "810-again.x12", null);
    check("uploading the same file again changes nothing", r2.duplicate === true);

    const made = await B.createBillFromEdiInvoice(orgId, (r1.message as any).id, 0, null, null);
    billId = made.bill.id;
    const [bridged] = await db.select().from(S.apBills).where(and(eq(S.apBills.orgId, orgId), eq(S.apBills.reference, invNo)));
    check("Create bill posts the bill with the invoice number and bills the receipt", !!bridged && (await billedNow()).some(x => x > 1e-9) && (made.message.result as any[])[0]?.bill?.entryId === billId, `${made.bill.docNumber}`);
    const again = await B.createBillFromEdiInvoice(orgId, (r1.message as any).id, 0, null, null).then(() => null, e => e);
    check("a second Create bill is refused", /already billed/.test(again?.message ?? ""), again?.message);

    const r3 = await I.receiveEdiFile(orgId, f810(9202, invNo), "810-resent.x12", null);
    check("the same invoice sent again is recognised as recorded", /already recorded as/.test((r3.results[0] as any)?.summary ?? ""), (r3.results[0] as any)?.summary);
  } finally {
    if (billId) await deleteDocument(orgId, billId, null).catch(e => { console.error("could not delete the test bill", billId, e); failed++; });
    const restored = (await billedNow()).every(x => Math.abs(x) < 1e-9);
    check("deleting the bill un-bills the receipt (cleanup)", restored);
    if (partnerId) {
      await db.delete(S.ediMessages).where(eq(S.ediMessages.partnerId, partnerId));
      await db.delete(S.ediPartners).where(eq(S.ediPartners.id, partnerId));
    }
    console.log("cleanup: test bill deleted, partner and its files removed");
  }
  if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
  console.log("all passed");
}
main().catch(e => { console.error(e); process.exit(1); });
