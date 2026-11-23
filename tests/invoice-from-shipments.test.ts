import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Regression guard. After the sales-document refactor (Phase 2) an Invoice line with no item is refused, and
 * invoiceFromShipments was still sending item-less lines, so "Invoice from shipment" failed for every org. It must
 * name the item (so the income account resolves) AND say the goods were costed at shipment (so the invoice does not
 * issue the stock and book cost of sales a second time).
 */
describe("invoice from shipments", () => {
  const shipping = readFileSync("lib/inventory/shipping.ts", "utf8");
  const documents = readFileSync("lib/accounting/documents.ts", "utf8");
  const fn = shipping.slice(shipping.indexOf("export async function invoiceFromShipments"));

  it("names the item on every revenue line and marks it costed at shipment", () => {
    const push = fn.slice(fn.indexOf("invLines.push("), fn.indexOf("touched.push("));
    expect(push).toMatch(/itemId:\s*l\.itemId/);
    expect(push).toMatch(/costedAtShipment:\s*true/);
    expect(push).not.toMatch(/itemId:\s*null/);
  });

  it("the posting engine skips the stock issue for a line costed at shipment", () => {
    const plan = documents.slice(documents.indexOf("async function planDocumentInventory"));
    const stockLines = plan.slice(0, plan.indexOf("if (!stockLines.length)"));
    expect(stockLines).toMatch(/!l\.costedAtShipment/);
  });

  it("deleting such an invoice reverts what it advanced, from its own line links", () => {
    const del = documents.slice(documents.indexOf("export async function deleteDocument"), documents.indexOf("export async function onEntryReversed"));
    const block = del.slice(del.indexOf('entry.sourceType === "Invoice"'));
    expect(block).toMatch(/relation, "shipment_invoice"/);
    expect(block).toMatch(/shipmentLines\)\.set\(\{ invoicedQty: sql`greatest\(0,/);
    expect(block).toMatch(/tradeDocumentLines\)\.set\(\{ billedQty: sql`greatest\(0,/);
    expect(block).toMatch(/salesShipments\)\.set\(\{ invoicedAmount: sql`greatest\(0,/);
    // read the links BEFORE they are deleted
    expect(block.indexOf('"shipment_invoice"')).toBeLessThan(del.slice(del.indexOf('entry.sourceType === "Invoice"')).indexOf("db.delete(transactionLinks)"));
  });

  it("dates the invoice by the customer's payment terms, not the day it is issued", () => {
    // With no due date and no terms the engine sets due = invoice date, so every such invoice read Overdue at once.
    expect(fn).toMatch(/customersTable\.paymentTerms/);
    expect(fn).toMatch(/dueDate:\s*input\.dueDate\s*\?\?\s*null,\s*termsDays/);
  });

  it("keeps a line-level link per invoiced shipment line (what an EDI 810 traces to the order line)", () => {
    expect(fn).toMatch(/fromLineId:\s*t\.lineId/);
    expect(fn).toMatch(/relation:\s*"shipment_invoice"[^}]*qty:\s*t\.qty/);
  });
});
