import { describe, it, expect } from "vitest";
import { planLineLinks } from "@/lib/inventory/invoice-link-backfill";

const line = (id: string, qty: number, inv: number, rate: number) => ({ id, shipmentId: "S1", qtyBase: qty, invoicedQty: inv, saleRate: rate });

describe("rebuilding an old invoice's line links", () => {
  it("rebuilds when the only invoice billed every line and the money adds up", () => {
    const p = planLineLinks({ invoiceNet: 70, otherInvoices: 0, lines: [line("a", 10, 10, 5), line("b", 4, 4, 5)] });
    expect(p).toEqual({ ok: true, links: [{ lineId: "a", shipmentId: "S1", qty: 10, amount: 50 }, { lineId: "b", shipmentId: "S1", qty: 4, amount: 20 }] });
  });
  it("refuses when another invoice also billed these shipments", () => {
    const p = planLineLinks({ invoiceNet: 50, otherInvoices: 1, lines: [line("a", 10, 10, 5)] });
    expect(p.ok).toBe(false);
  });
  it("refuses when a line is only part invoiced, since the split would be a guess", () => {
    const p = planLineLinks({ invoiceNet: 25, otherInvoices: 0, lines: [line("a", 10, 5, 5)] });
    expect(p.ok).toBe(false);
  });
  it("refuses when the lines no longer add up to the invoice (edited afterwards)", () => {
    const p = planLineLinks({ invoiceNet: 60, otherInvoices: 0, lines: [line("a", 10, 10, 5)] });
    expect(p.ok === false && p.reason).toMatch(/edited afterwards/);
  });
  it("refuses a shipment with nothing shipped", () => {
    expect(planLineLinks({ invoiceNet: 0, otherInvoices: 0, lines: [] }).ok).toBe(false);
  });
});
