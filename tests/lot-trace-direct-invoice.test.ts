import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

/**
 * A lot sold on a direct Invoice (no shipment) is recorded against that invoice's journal entry. The trace only
 * resolved shipments, so such a sale read "Shipment - sold to customer / Not yet invoiced / 0.00" even though it
 * had been invoiced to a named customer (Test Organization, INV-0005: 100 x 4.50 to Sweet Street Cafe).
 */
describe("lot traceability resolves a direct invoice sale", () => {
  const src = readFileSync("lib/inventory/genealogy.ts", "utf8");
  it("looks the movement's reference up as an Invoice / Sales Receipt entry when there is no shipment", () => {
    const sale = src.slice(src.indexOf('movementType === "issue_sale"'));
    expect(sale).toMatch(/if \(!shipment\)/);
    expect(sale).toMatch(/entry\.sourceType === "Invoice" \|\| entry\.sourceType === "SalesReceipt"/);
    expect(sale).toMatch(/invoiceNo = entry\.docNumber/);
  });
  it("prices the distribution row from the invoice's own stored line", () => {
    const report = src.slice(src.indexOf("const distribution: DistributionRow[] = []"));
    expect(report).toMatch(/!d\.shipmentNo && d\.invoiceEntryId/);
    expect(report).toMatch(/line\.rate/);
  });
});
