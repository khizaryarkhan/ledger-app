import { describe, it, expect } from "vitest";
import { readInterchange } from "@/lib/edi/x12/read";
import { parse810 } from "@/lib/edi/x12/inbound";
import { interchange, seg, type Envelope } from "@/lib/edi/x12/envelope";
import { invoiceToBillMulti, type AsnPoLine, type InvoiceReceipt, type InvoicePoGroup } from "@/lib/edi/inbound";

const env: Envelope = { version: "004010", test: true, senderQualifier: "ZZ", senderId: "SUPPLIER", receiverQualifier: "ZZ",
  receiverId: "PRIMEFOODS", senderAppId: "SUPPLIER", receiverAppId: "PRIMEFOODS", controlNo: 9, now: { date: "20261126", time: "1000" } };

// One invoice, no BIG04: each line names its own PO (IT1 qualifier PO).
const inv = (it1: string[][], big4 = "") => parse810(readInterchange(interchange(env, "IN", "810", [
  seg("BIG", "20261125", "INV-9", "", big4), seg("CUR", "SE", "EUR"), ...it1.map(a => seg("IT1", ...a)), seg("CTT", String(it1.length)),
])).groups[0].txns[0].segments);
const line = (po: string, no = "1", qty = "10", price = "2") => [no, qty, "KG", price, "", "PO", po];

const group = (po: string, lineId: string, receiptId: string, qty = 10): InvoicePoGroup => ({
  poNumber: po,
  poLines: [{ id: lineId, lineNo: 1, itemCode: "RM", closed: false, orderUnitCode: "KG", baseUnitCode: "KG", unitsPerOrderUnit: 1 } as AsnPoLine],
  receipts: [{ id: receiptId, receiptNo: "GRN-" + receiptId, receiptDate: "2026-11-20", currency: "EUR", lines: [{ id: "g" + receiptId, poLineId: lineId, unbilledQty: qty, price: 2 }] } as InvoiceReceipt],
});

describe("an invoice that names several purchase orders", () => {
  it("matches each PO to its own receipts and proposes one bill for all of them", () => {
    const r = invoiceToBillMulti(inv([line("PO-1"), line("PO-2")]), [group("PO-1", "L1", "R1"), group("PO-2", "L2", "R2")], "EUR");
    expect(r).toMatchObject({ ok: true, proposal: { receiptIds: ["R1", "R2"], goods: 40 }, notes: [expect.stringMatching(/covers 2 purchase orders \(PO-1, PO-2\)/)] });
    expect(r.lines.map(l => [l.poNumber, l.poLineId])).toEqual([["PO-1", "L1"], ["PO-2", "L2"]]);
  });

  it("keeps each PO's own line numbers (line 1 of PO-1 is not line 1 of PO-2)", () => {
    const r = invoiceToBillMulti(inv([line("PO-1", "1", "10"), line("PO-2", "1", "5")]), [group("PO-1", "L1", "R1", 10), group("PO-2", "L2", "R2", 5)], "EUR");
    expect(r).toMatchObject({ ok: true, proposal: { goods: 30 } });
  });

  it("never guesses: a line with no PO, a PO we do not hold, a PO with no line, quantities that do not match", () => {
    const msgs = (r: ReturnType<typeof invoiceToBillMulti>) => (r.ok === false ? r.problems.join(" | ") : "OK");
    const g = [group("PO-1", "L1", "R1"), group("PO-2", "L2", "R2")];
    expect(msgs(invoiceToBillMulti(inv([line("PO-1"), ["1", "10", "KG", "2"]]), g, "EUR"))).toMatch(/names no purchase order, and the invoice names several/);
    expect(msgs(invoiceToBillMulti(inv([line("PO-1"), line("PO-3")]), g, "EUR"))).toMatch(/No purchase order PO-3 to this supplier/);
    expect(msgs(invoiceToBillMulti(inv([line("PO-1")]), g, "EUR"))).toMatch(/No line of the invoice is for PO-2/);
    expect(msgs(invoiceToBillMulti(inv([line("PO-1", "1", "10"), line("PO-2", "1", "9")]), g, "EUR"))).toMatch(/do not match what has been received/);
  });

  it("one wrong PO stops the whole invoice: nothing is proposed for the other", () => {
    const r = invoiceToBillMulti(inv([line("PO-1", "1", "10"), line("PO-2", "1", "9")]), [group("PO-1", "L1", "R1"), group("PO-2", "L2", "R2")], "EUR");
    expect(r.ok).toBe(false);
  });

  it("a single PO named only in BIG04 still works, whatever the lines say", () => {
    const r = invoiceToBillMulti(inv([["1", "10", "KG", "2"]], "PO-1"), [group("PO-1", "L1", "R1")], "EUR");
    expect(r).toMatchObject({ ok: true, proposal: { receiptIds: ["R1"], goods: 20 } });
  });
});
