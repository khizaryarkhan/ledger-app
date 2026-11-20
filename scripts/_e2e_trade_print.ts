/**
 * Dev-database check of the printed Sales Order: the terms copied onto the order, its Incoterm, the delivery address it
 * names, and the customer's own part number on each line. Creates a customer ship-to address, a customer part number and
 * a Sales Order (the real createTradeDoc), sets its terms, loads it for print and renders the sheet to HTML. Everything
 * created is removed. Dev only.
 *
 *   npx tsx scripts/_e2e_trade_print.ts
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
  const { eq } = await import("drizzle-orm");
  const React = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { createTradeDoc, deleteTradeDoc } = await import("../lib/accounting/trade-documents");
  const { createShipTo, deleteShipTo } = await import("../lib/customer-ship-to-server");
  const { setCustomerPartNumber, deleteCustomerPartNumber } = await import("../lib/inventory/part-numbers-server");
  const { loadTradeDocumentForPrint } = await import("../lib/accounting/document-print");
  const { PrintSheetBody } = await import("../components/print-document-sheet");

  const custs = await db.select({ id: S.parties.id, orgId: S.parties.orgId, name: S.parties.name }).from(S.parties).where(eq(S.parties.partyType, "customer")).limit(40);
  let pick: { cust: (typeof custs)[number]; itemId: string; uom: string | null } | null = null;
  for (const c of custs) {
    const its = await db.select({ id: S.apItems.id, baseUom: S.apItems.baseUom, productType: S.apItems.productType, canBeSold: S.apItems.canBeSold }).from(S.apItems).where(eq(S.apItems.orgId, c.orgId)).limit(60);
    const it = its.find(i => ["FinishedProduct", "StockItem", "Service", "NonInventory"].includes(String(i.productType)) && i.canBeSold !== false && i.baseUom);
    if (it) { pick = { cust: c, itemId: it.id, uom: it.baseUom }; break; }
  }
  if (!pick) throw new Error("No customer with a sellable item on dev");
  const orgId = pick.cust.orgId;
  const tag = Date.now().toString(36).toUpperCase();
  let shipToId: string | null = null, partId: string | null = null, soId: string | null = null;
  try {
    const st: any = await createShipTo(orgId, pick.cust.id, { name: `E2E DC ${tag}`, addressStreet: "1 Test Lane", addressCity: "Dublin", addressPostcode: "D02 X285", countryCode: "IE", gln: "5412345000020" });
    shipToId = st.id;
    partId = (await setCustomerPartNumber(orgId, { customerId: pick.cust.id, itemId: pick.itemId, code: `E2E-BP-${tag}` })).id;
    const so = await createTradeDoc(orgId, "SalesOrder", {
      partyType: "Customer", partyId: pick.cust.id, partyLabel: pick.cust.name, issueDate: "2026-11-20", partyRef: `E2E-PO-${tag}`, customerShipToId: shipToId,
      incoterm: "FCA", incotermPlace: "Rotterdam",
      lines: [{ itemId: pick.itemId, qty: 2, rate: 10, amount: 20, orderUom: pick.uom, packLevel: "base", unitsPerOrderUnit: 1 }],
    }, null);
    soId = so.id;
    await db.update(S.tradeDocuments).set({ paymentTermsDays: 30, discountPercent: "2", discountDays: 10 }).where(eq(S.tradeDocuments.id, soId));

    const doc = await loadTradeDocumentForPrint(orgId, soId);
    check("the sales order carries its terms and Incoterm", doc?.doc.paymentTerms === "2% 10, net 30" && doc?.doc.incoterm === "FCA Rotterdam", `${doc?.doc.paymentTerms} | ${doc?.doc.incoterm}`);
    check("it names the customer's delivery address, not ours", doc?.doc.shipTo?.heading === "Deliver to" && doc?.doc.shipTo?.name === `E2E DC ${tag}` && !!doc?.doc.shipTo?.lines.some(l => /1 Test Lane/.test(l)), JSON.stringify(doc?.doc.shipTo));
    check("each line carries the customer's own part number", doc?.lines[0]?.partNumber === `E2E-BP-${tag}`, String(doc?.lines[0]?.partNumber));
    check("their PO number prints as the reference", doc?.doc.reference === `E2E-PO-${tag}`);
    const html = renderToStaticMarkup(React.createElement(PrintSheetBody, { data: doc! }));
    check("the printed sheet shows all of it", html.includes("2% 10, net 30") && html.includes("FCA Rotterdam") && html.includes("Deliver to") && html.includes("1 Test Lane") && html.includes(`Customer part no. E2E-BP-${tag}`) && html.includes("Your PO no."), "");
  } finally {
    let removed = 0;
    if (soId) await deleteTradeDoc(orgId, soId, null).then(() => removed++, e => { console.error("could not delete SO", e); failed++; });
    if (partId) await deleteCustomerPartNumber(orgId, partId);
    if (shipToId) await deleteShipTo(orgId, pick!.cust.id, shipToId).catch(e => { console.error("could not delete ship-to", e); failed++; });
    console.log(`cleanup: ${removed} Sales Order, the part number and the delivery address removed`);
  }
  if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
  console.log("all passed");
}
main().catch(e => { console.error(e); process.exit(1); });
