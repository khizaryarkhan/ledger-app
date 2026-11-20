/**
 * Dev-database check of the OUTBOUND 810 (our invoice to a customer). Creates a
 * customer partner and part number, uploads their 850 (a Sales Order appears),
 * inserts a minimal POSTED shipment, runs the real invoiceFromShipments (this
 * DOES post a ledger entry on dev), then checks: the invoice carries line-level
 * links to its shipment lines; the 810 quotes THEIR PO and line number with the
 * quantity and price and the total in cents; an invoice without those links is
 * refused; marking it sent works. The invoice is then DELETED through
 * deleteDocument and everything else removed. Dev only.
 *
 *   npx tsx scripts/_e2e_edi_810_out.ts
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
  const { eq, and, inArray, isNotNull } = await import("drizzle-orm");
  const E = await import("../lib/edi/edi-server");
  const I = await import("../lib/edi/inbound-server");
  const O = await import("../lib/edi/outbound-server");
  const { setCustomerPartNumber, deleteCustomerPartNumber } = await import("../lib/inventory/part-numbers-server");
  const { deleteTradeDoc } = await import("../lib/accounting/trade-documents");
  const { invoiceFromShipments } = await import("../lib/inventory/shipping");
  const { deleteDocument } = await import("../lib/accounting/documents");
  const { interchange, seg } = await import("../lib/edi/x12/envelope");
  const { readInterchange } = await import("../lib/edi/x12/read");
  const { parse810 } = await import("../lib/edi/x12/inbound");
  const { x12UnitFor } = await import("../lib/edi/validate");

  const custs = await db.select({ id: S.parties.id, orgId: S.parties.orgId }).from(S.parties).where(eq(S.parties.partyType, "customer")).limit(60);
  let pick: { cust: (typeof custs)[number]; itemId: string; unit: string; incomeAccountId: string } | null = null;
  for (const c of custs) {
    const [p] = await db.select({ id: S.ediPartners.id }).from(S.ediPartners).where(and(eq(S.ediPartners.orgId, c.orgId), eq(S.ediPartners.partyId, c.id))).limit(1);
    if (p) continue;
    const [inc] = await db.select({ id: S.accounts.id }).from(S.accounts).where(and(eq(S.accounts.orgId, c.orgId), eq(S.accounts.type, "Income"))).limit(1);
    if (!inc) continue;
    const its = await db.select({ id: S.apItems.id, baseUom: S.apItems.baseUom, productType: S.apItems.productType, canBeSold: S.apItems.canBeSold }).from(S.apItems).where(eq(S.apItems.orgId, c.orgId)).limit(80);
    for (const it of its) {
      if (!["FinishedProduct", "StockItem", "Service", "NonInventory"].includes(String(it.productType)) || it.canBeSold === false) continue;   // invoicing posts revenue only (itemId is omitted), never stock
      const u = x12UnitFor(it.baseUom, {});
      if (u.ok) { pick = { cust: c, itemId: it.id, unit: u.code, incomeAccountId: inc.id }; break; }
    }
    if (pick) break;
  }
  if (!pick) throw new Error("No customer with a sellable item and an income account on dev");
  const orgId = pick.cust.orgId;
  const tag = Date.now().toString(36).toUpperCase();
  const poNo = `E2E-PO-${tag}`, theirPart = `E2E-BP-${tag}`;
  let partnerId: string | null = null; let partNoId: string | null = null; let soId: string | null = null; let shipId: string | null = null; let entryId: string | null = null;
  try {
    const p = await E.createPartner(orgId, { partyId: pick.cust.id, senderQualifier: "ZZ", senderId: "E2EUS", receiverQualifier: "ZZ", receiverId: "E2ECUST" }, null);
    partnerId = p.id;
    partNoId = (await setCustomerPartNumber(orgId, { customerId: pick.cust.id, itemId: pick.itemId, code: theirPart })).id;
    const f850 = interchange({ version: "004010", test: true, senderQualifier: "ZZ", senderId: "E2ECUST", receiverQualifier: "ZZ", receiverId: "E2EUS",
      senderAppId: "E2ECUST", receiverAppId: "E2EUS", controlNo: 9801, now: { date: "20261125", time: "0900" } }, "PO", "850", [
      seg("BEG", "00", "SA", poNo, "", "20261120"), seg("DTM", "002", "20261205"),
      seg("PO1", "10", 7, pick.unit, "12.5", "", "BP", theirPart), seg("CTT", 1)]);
    const r: any = await I.receiveEdiFile(orgId, f850, "850.x12", null);
    soId = r.results[0]?.soId ?? null;
    if (!soId) throw new Error(`no Sales Order: ${r.results[0]?.summary}`);
    const [soLine] = await db.select().from(S.tradeDocumentLines).where(eq(S.tradeDocumentLines.documentId, soId));

    const [sh] = await db.insert(S.salesShipments).values({ orgId, shipmentNo: `E2E-SHP-${tag}`, customerId: pick.cust.id, shipmentDate: "2026-11-26", status: "Posted" }).returning();
    shipId = sh.id;
    await db.insert(S.shipmentLines).values({ orgId, shipmentId: sh.id, itemId: pick.itemId, soId, soLineId: soLine.id, qtyBase: "7", saleRate: "12.5", incomeAccountId: pick.incomeAccountId, description: "E2E goods" });
    const made = await invoiceFromShipments(orgId, { shipmentIds: [sh.id], invoiceDate: "2026-11-27", dueDate: "2026-12-27" }, null);
    entryId = made.id;

    const links = await db.select().from(S.transactionLinks).where(and(eq(S.transactionLinks.orgId, orgId), eq(S.transactionLinks.toId, entryId), eq(S.transactionLinks.relation, "shipment_invoice"), isNotNull(S.transactionLinks.fromLineId)));
    check("the invoice carries a line-level link to its shipment line, with qty and amount", links.length === 1 && Number(links[0].qty) === 7 && Number(links[0].amount) === 87.5, JSON.stringify(links.map(l => [l.qty, l.amount])));

    const c0 = await O.checkInvoice810(orgId, entryId);
    check("a posted invoice from shipments can be sent by EDI", c0.problems.length === 0, c0.problems.map(x => x.message).join(" | "));
    const m1 = await O.generateInvoice810(orgId, entryId, null);
    const [row] = await db.select().from(S.ediMessages).where(eq(S.ediMessages.id, m1.id));
    const n = parse810(readInterchange(row.payload).groups[0].txns[0].segments);
    check("the 810 quotes the invoice number, THEIR PO number, due date and total", n.invoiceNo === made.docNumber && n.poNumber === poNo && n.dueDate === "2026-12-27" && n.invoiceDate === "2026-11-27" && n.total === 87.5, JSON.stringify({ no: n.invoiceNo, po: n.poNumber, total: n.total }));
    check("the line is in THEIR line number with their part number, quantity and price", n.lines.length === 1 && n.lines[0].lineNo === "10" && n.lines[0].qty === 7 && n.lines[0].price === 12.5 && n.lines[0].ids.BP === theirPart && n.lines[0].unit === pick!.unit, JSON.stringify(n.lines[0]));
    check("it is waiting to be sent, linked to the invoice", row.status === "generated" && row.docType === "810" && row.appDocType === "Invoice" && row.appDocId === entryId);
    await E.markMessageSent(orgId, m1.id, null);

    // Hide the line links for a moment (not delete: the invoice delete below must revert from them), then put them back.
    const mine = and(eq(S.transactionLinks.orgId, orgId), eq(S.transactionLinks.toId, entryId), eq(S.transactionLinks.relation, "shipment_invoice"), isNotNull(S.transactionLinks.fromLineId));
    await db.update(S.transactionLinks).set({ relation: "e2e_hidden" }).where(mine);
    const c1 = await O.checkInvoice810(orgId, entryId);
    await db.update(S.transactionLinks).set({ relation: "shipment_invoice" }).where(and(eq(S.transactionLinks.orgId, orgId), eq(S.transactionLinks.toId, entryId), eq(S.transactionLinks.relation, "e2e_hidden")));
    check("an invoice with no line-level links is refused", c1.problems.some(x => /no line-level link to its shipments/.test(x.message)), c1.problems.map(x => x.message).join(" | "));
  } finally {
    if (entryId) await deleteDocument(orgId, entryId, null).catch(e => { console.error("could not delete the test invoice", entryId, e); failed++; });
    // Deleting the invoice must have UN-invoiced what it advanced: the shipment line, the shipment and the order line.
    if (entryId && shipId && soId) {
      const [sl] = await db.select({ q: S.shipmentLines.invoicedQty }).from(S.shipmentLines).where(eq(S.shipmentLines.shipmentId, shipId));
      const [sh] = await db.select({ a: S.salesShipments.invoicedAmount }).from(S.salesShipments).where(eq(S.salesShipments.id, shipId));
      const [ol] = await db.select({ b: S.tradeDocumentLines.billedQty }).from(S.tradeDocumentLines).where(eq(S.tradeDocumentLines.documentId, soId));
      check("deleting the invoice un-invoices the shipment line, the shipment and the order line", Number(sl?.q) === 0 && Number(sh?.a) === 0 && Number(ol?.b) === 0, JSON.stringify({ shipLine: sl?.q, shipment: sh?.a, orderLine: ol?.b }));
    }
    if (shipId) await db.delete(S.salesShipments).where(eq(S.salesShipments.id, shipId));
    let removed = 0;
    if (soId) await deleteTradeDoc(orgId, soId, null).then(() => removed++, e => { console.error("could not delete SO (its billed quantity was not reverted?)", soId, e); failed++; });
    if (partNoId) await deleteCustomerPartNumber(orgId, partNoId);
    if (partnerId) {
      await db.delete(S.ediMessages).where(eq(S.ediMessages.partnerId, partnerId));
      await db.delete(S.ediPartners).where(eq(S.ediPartners.id, partnerId));
    }
    const left = entryId ? await db.select({ id: S.journalEntries.id }).from(S.journalEntries).where(inArray(S.journalEntries.id, [entryId])) : [];
    const leftInv = entryId ? await db.select({ id: S.invoices.id }).from(S.invoices).where(eq(S.invoices.journalEntryId, entryId)) : [];
    console.log(`cleanup: invoice deleted (${left.length} journal entry, ${leftInv.length} register row left), shipment, ${removed} Sales Order, the part number, partner and files removed`);
    if (left.length || leftInv.length) failed++;
  }
  if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
  console.log("all passed");
}
main().catch(e => { console.error(e); process.exit(1); });
