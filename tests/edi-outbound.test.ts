import { describe, it, expect } from "vitest";
import { readInterchange } from "@/lib/edi/x12/read";
import { parse855, parse856, parse810 } from "@/lib/edi/x12/inbound";
import { write810 } from "@/lib/edi/x12/810";
import { buildInvoice, type InvFacts } from "@/lib/edi/build/invoice";
import { write856 } from "@/lib/edi/x12/856";
import { buildShipNotice, type ShipFacts } from "@/lib/edi/build/shipment";
import { write855 } from "@/lib/edi/x12/855";
import { buildOrderAck, type SoAckFacts } from "@/lib/edi/build/sales-order";
import type { Envelope } from "@/lib/edi/x12/envelope";

// We are the SELLER: our ID is the sender, the customer's the receiver.
const env: Envelope = { version: "004010", test: true, senderQualifier: "ZZ", senderId: "PRIMEFOODS", receiverQualifier: "ZZ",
  receiverId: "CUSTOMER", senderAppId: "PRIMEFOODS", receiverAppId: "CUSTOMER", controlNo: 31, now: { date: "20261126", time: "1000" } };

const facts = (over: Partial<SoAckFacts> = {}): SoAckFacts => ({
  so: { docNumber: "SO-0007", partyRef: "CUST-PO-77", issueDate: "2026-11-20", currency: "EUR", confirmed: true, promisedDate: null },
  lines: [
    { lineNo: 1, orderUom: "kg", baseUom: "kg", qty: 40, rate: 0.5, promisedDate: "2026-12-05", requestedDate: "2026-12-05", closed: false },
    { lineNo: 2, orderUom: "carton", baseUom: "kg", qty: 3, rate: 100, promisedDate: "2026-12-05", requestedDate: "2026-12-05", closed: false },
  ],
  theirs: [
    { lineNo: "10", qty: 40, unit: "KG", price: 0.5, requestedDate: "2026-12-05" },
    { lineNo: "20", qty: 3, unit: "CT", price: 100, requestedDate: "2026-12-05" },
  ],
  ...over,
});
const build = (f: SoAckFacts) => buildOrderAck(f, {});
const ack = (f: SoAckFacts) => { const r = build(f); if (r.ok === false) throw new Error(JSON.stringify(r.problems)); return r.ack; };

describe("855 builder", () => {
  it("accepts a line exactly as ordered (IA), echoes THEIR line numbers, and the whole order is accepted with detail (AD)", () => {
    const a = ack(facts());
    expect(a).toMatchObject({ poNumber: "CUST-PO-77", poDate: "2026-11-20", currency: "EUR", type: "AD" });
    expect(a.lines.map(l => l.lineNo)).toEqual(["10", "20"]);
    expect(a.lines[0]).toEqual({ lineNo: "10", qty: 40, unit: "KG", price: 0.5, acks: [{ status: "IA", qty: 40, unit: "KG", date: "2026-12-05" }] });
  });

  it("a different quantity is IQ, a different price IP, a moved date DR, a closed line IR; the order is then AC", () => {
    const f = facts();
    f.lines[0].qty = 30;                       // short
    f.lines[1].rate = 110;                     // dearer
    const a = ack(f);
    expect(a.type).toBe("AC");
    expect(a.lines[0].acks).toEqual([{ status: "IQ", qty: 30, unit: "KG", date: "2026-12-05" }]);
    expect(a.lines[1].acks).toEqual([{ status: "IP", qty: 3, unit: "CT", date: "2026-12-05" }]);
    const moved = facts(); moved.lines[0].promisedDate = "2026-12-12";
    expect(ack(moved).lines[0].acks).toEqual([{ status: "DR", qty: 40, unit: "KG", date: "2026-12-12" }]);
    const closed = facts(); closed.lines[1].closed = true;
    expect(ack(closed).lines[1].acks).toEqual([{ status: "IR", qty: 0, unit: "CT", date: null }]);
  });

  it("an order keyed by hand (no 850) uses its own line numbers and values", () => {
    const a = ack(facts({ theirs: null }));
    expect(a.lines.map(l => l.lineNo)).toEqual(["1", "2"]);
    expect(a.type).toBe("AD");
  });

  it("never guesses: no customer PO number, not confirmed, lines that no longer match their order, a unit they did not use", () => {
    const fail = (f: SoAckFacts) => { const r = build(f); return r.ok === false ? r.problems.map(p => p.message).join(" | ") : "OK"; };
    expect(fail(facts({ so: { ...facts().so, partyRef: null } }))).toMatch(/no customer PO number/);
    expect(fail(facts({ so: { ...facts().so, confirmed: false } }))).toMatch(/Confirm the order first/);
    expect(fail(facts({ theirs: facts().theirs!.slice(0, 1) }))).toMatch(/2 line\(s\), their order had 1/);
    const unit = facts(); unit.theirs![0].unit = "LB";
    expect(fail(unit)).toMatch(/They ordered in LB, the line is in KG now/);
    const nounit = facts(); nounit.lines[0].orderUom = "wibble"; nounit.lines[0].baseUom = null;
    expect(fail(nounit)).toMatch(/Unit:/);
  });
});

describe("855 writer", () => {
  it("is a valid one-set file our own reader and parse855 agree with: BAK, PO1 echo, ACK per status", () => {
    const f = facts(); f.lines[0].qty = 30;
    const file = write855(ack(f), env);
    const ixn = readInterchange(file);
    expect(ixn).toMatchObject({ senderId: "PRIMEFOODS", receiverId: "CUSTOMER", controlNo: 31, test: true });
    expect(ixn.groups[0]).toMatchObject({ functionalId: "PR", version: "004010" });
    const back = parse855(ixn.groups[0].txns[0].segments);
    expect(back).toMatchObject({ ackType: "AC", poNumber: "CUST-PO-77", poDate: "2026-11-20" });
    expect(back.lines[0]).toMatchObject({ lineNo: "10", qty: 40, unit: "KG", price: 0.5 });
    expect(back.lines[0].acks).toEqual([{ status: "IQ", qty: 30, unit: "KG", dateQualifier: "067", date: "2026-12-05", rawDate: "20261205" }]);
    expect(back.lines[1].acks[0]).toMatchObject({ status: "IA", qty: 3, unit: "CT" });
  });

  it("states the currency and ends with the line count", () => {
    const segs = readInterchange(write855(ack(facts()), env)).groups[0].txns[0].segments;
    expect(segs.find(s => s[0] === "CUR")).toEqual(["CUR", "SE", "EUR"]);
    expect(segs.find(s => s[0] === "CTT")).toEqual(["CTT", "2"]);
    expect(segs.find(s => s[0] === "BAK")).toEqual(["BAK", "00", "AD", "CUST-PO-77", "20261120"]);
  });
});

describe("856 builder and writer", () => {
  const PALLET = "354123450000000014", CARTON = "354123450000000021";
  const ship = (over: Partial<ShipFacts> = {}): ShipFacts => ({
    shipment: { shipmentNo: "SHP-0009", shipDate: "2026-11-26", carrier: "DHL Freight", trackingNo: "TRK-55", posted: true },
    shipFrom: { name: "Prime Foods Ltd", gln: "5412345000013" },
    lines: [{ id: "SL1", soId: "S1", soLineId: "OL1", qtyBase: 600 }],
    orders: [{ soId: "S1", poNumber: "CUST-PO-77", poDate: "2026-11-20", shipTo: { name: "Dublin DC", gln: "5412345000020", code: null },
      soLines: [{ id: "OL1", lineNo: 1, orderUom: "carton", baseUom: "kg", unitsPerOrderUnit: 200, itemCode: "RM-RICE" }],
      theirs: [{ lineNo: "10", unit: "CT" }] }],
    parts: { SL1: { bp: "THEIR-9", gtin: "00012345678905" } },
    // 400 kg (2 cartons) packed in one carton on a pallet; the other 200 kg (1 carton) is loose.
    packages: [{ id: "P1", sscc: PALLET, parentId: null, packType: "pallet", lines: [] }, { id: "P2", sscc: CARTON, parentId: "P1", packType: "carton", lines: [{ shipmentLineId: "SL1", qtyBase: 400 }] }],
    replaces: false,
    ...over,
  });
  const asnOf = (f: ShipFacts) => { const r = buildShipNotice(f, {}); if (r.ok === false) throw new Error(JSON.stringify(r.problems)); return r.asn; };
  const failOf = (f: ShipFacts) => { const r = buildShipNotice(f, {}); return r.ok === false ? r.problems.map(p => p.message).join(" | ") : "OK"; };
  const sellerEnv: Envelope = { ...env, controlNo: 52 };

  it("builds the packing tree in THEIR line numbers and unit, quantities in order units, the rest loose under the order", () => {
    const a = asnOf(ship());
    expect(a).toMatchObject({ shipmentId: "SHP-0009", purpose: "00", shipDate: "2026-11-26", carrier: "DHL Freight", trackingNo: "TRK-55" });
    expect(a.orders[0].packages).toEqual([
      { sscc: PALLET, level: "tare", parentSscc: null, items: [] },
      { sscc: CARTON, level: "pack", parentSscc: PALLET, items: [{ lineNo: "10", partNumber: "THEIR-9", gtin: "00012345678905", itemCode: "RM-RICE", qty: 2, unit: "CT" }] },
    ]);
    expect(a.orders[0].loose).toEqual([{ lineNo: "10", partNumber: "THEIR-9", gtin: "00012345678905", itemCode: "RM-RICE", qty: 1, unit: "CT" }]);
  });

  it("is a one-set file our own parse856 reads back: shipment, order, pallet, carton with SSCC, items", () => {
    const file = write856(asnOf(ship()), sellerEnv);
    const ixn = readInterchange(file);
    expect(ixn.groups[0]).toMatchObject({ functionalId: "SH" });
    const n = parse856(ixn.groups[0].txns[0].segments);
    expect(n).toMatchObject({ purpose: "00", shipmentId: "SHP-0009", shipDate: "2026-11-26", carrier: "DHL Freight", trackingNo: "TRK-55", problems: [] });
    expect(n.orders[0].poNumber).toBe("CUST-PO-77");
    expect(n.orders[0].packages).toEqual([{ sscc: CARTON, level: "pack", parentSscc: PALLET }, { sscc: PALLET, level: "tare", parentSscc: null }]);
    expect(n.orders[0].items).toEqual([
      { lineNo: "10", ids: { BP: "THEIR-9", UP: "012345678905", VP: "RM-RICE" }, qty: 2, unit: "CT", batch: null, productionDate: null, bestBeforeDate: null, expiryDate: null, badDates: [], sscc: CARTON },
      { lineNo: "10", ids: { BP: "THEIR-9", UP: "012345678905", VP: "RM-RICE" }, qty: 1, unit: "CT", batch: null, productionDate: null, bestBeforeDate: null, expiryDate: null, badDates: [], sscc: null },
    ]);
  });

  it("a notice that replaces one already sent says so (BSN01 05)", () => {
    const n = parse856(readInterchange(write856(asnOf(ship({ replaces: true })), sellerEnv)).groups[0].txns[0].segments);
    expect(n.purpose).toBe("05");
  });

  it("with no packing at all, everything is listed under the order", () => {
    const a = asnOf(ship({ packages: [] }));
    expect(a.orders[0].packages).toEqual([]);
    expect(a.orders[0].loose).toEqual([{ lineNo: "10", partNumber: "THEIR-9", gtin: "00012345678905", itemCode: "RM-RICE", qty: 3, unit: "CT" }]);
  });

  it("never guesses: no order, no PO number, lines that no longer match, a reversed shipment, one package for two orders", () => {
    expect(failOf(ship({ lines: [{ id: "SL1", soId: null, soLineId: null, qtyBase: 600 }] }))).toMatch(/has no Sales Order/);
    const noPo = ship(); noPo.orders[0].poNumber = null;
    expect(failOf(noPo)).toMatch(/no customer PO number/);
    const moved = ship(); moved.orders[0].theirs = [{ lineNo: "10", unit: "CT" }, { lineNo: "20", unit: "CT" }];
    expect(failOf(moved)).toMatch(/1 line\(s\), their order had 2/);
    expect(failOf(ship({ shipment: { ...ship().shipment, posted: false } }))).toMatch(/not posted/);
    const two = ship({
      lines: [{ id: "SL1", soId: "S1", soLineId: "OL1", qtyBase: 400 }, { id: "SL2", soId: "S2", soLineId: "OL2", qtyBase: 200 }],
      orders: [...ship().orders, { soId: "S2", poNumber: "CUST-PO-78", poDate: "2026-11-21", shipTo: null,
        soLines: [{ id: "OL2", lineNo: 1, orderUom: "carton", baseUom: "kg", unitsPerOrderUnit: 200, itemCode: "RM-OATS" }], theirs: null }],
      packages: [{ id: "P1", sscc: PALLET, parentId: null, packType: "pallet", lines: [{ shipmentLineId: "SL1", qtyBase: 400 }, { shipmentLineId: "SL2", qtyBase: 200 }] }],
    });
    expect(failOf(two)).toMatch(/holds goods of more than one order/);
  });
});

describe("810 builder and writer", () => {
  const inv = (over: Partial<InvFacts> = {}): InvFacts => ({
    invoice: { docNumber: "INV-0042", date: "2026-11-27", dueDate: "2026-12-27", currency: "EUR", net: 700, tax: 161, total: 861, posted: true },
    customer: { name: "Customer Ltd", gln: "5412345000020" }, us: { name: "Prime Foods Ltd", gln: "5412345000013" },
    // 3 cartons of 200 kg at 0.5/kg = 100 per carton = 300; plus 40 kg at 10/kg = 400.
    lines: [{ shipLineId: "SL1", soId: "S1", soLineId: "OL1", qtyBase: 600, amount: 300, ratePerBase: 0.5 }, { shipLineId: "SL2", soId: "S1", soLineId: "OL2", qtyBase: 40, amount: 400, ratePerBase: 10 }],
    orders: [{ soId: "S1", poNumber: "CUST-PO-77", poDate: "2026-11-20",
      soLines: [{ id: "OL1", lineNo: 1, orderUom: "carton", baseUom: "kg", unitsPerOrderUnit: 200, itemCode: "RM-RICE" }, { id: "OL2", lineNo: 2, orderUom: "kg", baseUom: "kg", unitsPerOrderUnit: 1, itemCode: "RM-OATS" }],
      theirs: [{ lineNo: "10", unit: "CT" }, { lineNo: "20", unit: "KG" }] }],
    parts: { SL1: { bp: "THEIR-9", gtin: "00012345678905" }, SL2: { bp: null, gtin: null } },
    ...over,
  });
  const out = (f: InvFacts) => { const r = buildInvoice(f, {}); if (r.ok === false) throw new Error(JSON.stringify(r.problems)); return r.invoice; };
  const failOf = (f: InvFacts) => { const r = buildInvoice(f, {}); return r.ok === false ? r.problems.map(p => p.message).join(" | ") : "OK"; };
  const sellerEnv: Envelope = { ...env, controlNo: 73 };

  it("builds lines in THEIR numbers, the quantity in the order unit and the price per that unit", () => {
    const i = out(inv());
    expect(i).toMatchObject({ invoiceNo: "INV-0042", date: "2026-11-27", dueDate: "2026-12-27", poNumber: "CUST-PO-77", poDate: "2026-11-20", net: 700, tax: 161, total: 861 });
    expect(i.items).toEqual([
      { lineNo: "10", partNumber: "THEIR-9", gtin: "00012345678905", itemCode: "RM-RICE", qty: 3, unit: "CT", price: 100, poNumber: "CUST-PO-77" },
      { lineNo: "20", partNumber: null, gtin: null, itemCode: "RM-OATS", qty: 40, unit: "KG", price: 10, poNumber: "CUST-PO-77" },
    ]);
  });

  it("is a file our own parse810 reads back: number, date, PO, due date, lines, total in cents, tax", () => {
    const ixn = readInterchange(write810(out(inv()), sellerEnv));
    expect(ixn.groups[0]).toMatchObject({ functionalId: "IN" });
    const n = parse810(ixn.groups[0].txns[0].segments);
    expect(n).toMatchObject({ invoiceNo: "INV-0042", invoiceDate: "2026-11-27", poNumber: "CUST-PO-77", currency: "EUR", dueDate: "2026-12-27", total: 861, tax: 161, problems: [] });
    expect(n.lines).toEqual([
      { lineNo: "10", qty: 3, unit: "CT", price: 100, ids: { BP: "THEIR-9", UP: "012345678905", VP: "RM-RICE" } },
      { lineNo: "20", qty: 40, unit: "KG", price: 10, ids: { VP: "RM-OATS" } },
    ]);
  });

  it("several orders on one invoice carry the PO number on each line instead of in BIG04", () => {
    const f = inv({
      lines: [{ shipLineId: "SL1", soId: "S1", soLineId: "OL1", qtyBase: 600, amount: 300, ratePerBase: 0.5 }, { shipLineId: "SL2", soId: "S2", soLineId: "OL3", qtyBase: 40, amount: 400, ratePerBase: 10 }],
      orders: [inv().orders[0], { soId: "S2", poNumber: "CUST-PO-78", poDate: "2026-11-21", soLines: [{ id: "OL3", lineNo: 1, orderUom: "kg", baseUom: "kg", unitsPerOrderUnit: 1, itemCode: "RM-OATS" }], theirs: null }],
    });
    const i = out(f);
    expect(i.poNumber).toBeNull();
    const n = parse810(readInterchange(write810(i, sellerEnv)).groups[0].txns[0].segments);
    expect(n.poNumber).toBe("");
    expect(n.lines.map(l => l.ids.PO)).toEqual(["CUST-PO-77", "CUST-PO-78"]);
  });

  it("never guesses: no line-level links, an invoice edited afterwards, no PO number, lines that no longer match, not posted", () => {
    expect(failOf(inv({ lines: [] }))).toMatch(/no line-level link to its shipments/);
    expect(failOf(inv({ invoice: { ...inv().invoice, net: 750, total: 911 } }))).toMatch(/add up to 700, the invoice net is 750/);
    const noPo = inv(); noPo.orders[0].poNumber = null;
    expect(failOf(noPo)).toMatch(/no customer PO number/);
    const moved = inv(); moved.orders[0].theirs = [{ lineNo: "10", unit: "CT" }];
    expect(failOf(moved)).toMatch(/2 line\(s\), their order had 1/);
    expect(failOf(inv({ invoice: { ...inv().invoice, posted: false } }))).toMatch(/not posted/);
    expect(failOf(inv({ invoice: { ...inv().invoice, tax: 100 } }))).toMatch(/is not the total/);
  });
});
