import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readInterchange } from "@/lib/edi/x12/read";
import { parse997, parse855, parse856, parse810, ymdFrom } from "@/lib/edi/x12/inbound";
import { ackToResponse, asnOrderToDelivery, asnPurpose, asnReference, invoiceToBill, type AckPoLine, type AsnPoLine, type InvoiceReceipt } from "@/lib/edi/inbound";
import { prepareDelivery } from "@/lib/inventory/expected-delivery";
import { interchange, seg, type Envelope } from "@/lib/edi/x12/envelope";

// A file FROM the partner: their ID is the sender.
const env: Envelope = { version: "004010", test: true, senderQualifier: "01", senderId: "123456789", receiverQualifier: "ZZ",
  receiverId: "PRIMEFOODS", senderAppId: "123456789", receiverAppId: "PRIMEFOODS", controlNo: 7, now: { date: "20261121", time: "0900" } };
const file855 = (body: string[]) => interchange(env, "PR", "855", body);
const poLines: AckPoLine[] = [
  { id: "L1", lineNo: 1, qty: 40, unitCode: "BG", closed: false },
  { id: "L2", lineNo: 2, qty: 10, unitCode: "CA", closed: false },
];
const ack = (body: string[]) => parse855(readInterchange(file855(body)).groups[0].txns[0].segments);

describe("readInterchange", () => {
  it("reads our own writer's file back: IDs, control number, test flag, one transaction set", () => {
    const ixn = readInterchange(file855([seg("BAK", "00", "AD", "PO-0042", "20261120")]));
    expect(ixn).toMatchObject({ senderQualifier: "01", senderId: "123456789", receiverId: "PRIMEFOODS", controlNo: 7, test: true });
    expect(ixn.groups[0]).toMatchObject({ functionalId: "PR", controlNo: 7, version: "004010" });
    expect(ixn.groups[0].txns[0].setId).toBe("855");
  });

  it("takes the separators from the ISA, not from our writer", () => {
    const ours = file855([seg("BAK", "00", "AD", "PO-0042", "20261120")]);
    const theirs = ours.replace(/\*/g, "|").replace(/~\n/g, "\n");
    const ixn = readInterchange(theirs);
    expect(ixn.separators).toEqual({ element: "|", component: ">", segment: "\n" });
    expect(ixn.groups[0].txns[0].segments[1]).toEqual(["BAK", "00", "AD", "PO-0042", "20261120"]);
  });

  it("refuses a file whose envelope does not add up, saying why", () => {
    const good = file855([seg("BAK", "00", "AD", "PO-0042", "20261120")]);
    expect(() => readInterchange("hello")).toThrow(/does not start with ISA/);
    expect(() => readInterchange(good.replace("SE*3*0001", "SE*9*0001"))).toThrow(/SE says 9 segments, it has 3/);
    expect(() => readInterchange(good.replace("GE*1*7", "GE*2*7"))).toThrow(/GE says 2/);
    expect(() => readInterchange(good.replace("IEA*1*000000007", "IEA*1*000000008"))).toThrow(/IEA control number/);
    expect(() => readInterchange(good.replace(/IEA\*1\*000000007~\n$/, ""))).toThrow(/no IEA/);
  });
});

describe("997", () => {
  it("reads which of our groups it answers, and whether it was accepted", () => {
    const f = interchange(env, "FA", "997", [seg("AK1", "PO", "42"), seg("AK2", "850", "0001"), seg("AK5", "A"), seg("AK9", "A", "1", "1", "1")]);
    expect(parse997(readInterchange(f).groups[0].txns[0].segments)).toMatchObject({ functionalId: "PO", groupControlNo: 42, groupStatus: "accepted", txns: [{ setId: "850", status: "accepted" }] });
    const bad = interchange(env, "FA", "997", [seg("AK1", "PO", "43"), seg("AK2", "850", "0001"), seg("AK3", "PO1", "12", "", "8"), seg("AK5", "R", "5"), seg("AK9", "R", "1", "1", "0")]);
    const r = parse997(readInterchange(bad).groups[0].txns[0].segments);
    expect(r.groupStatus).toBe("rejected");
    expect(r.txns[0].codes).toEqual(["5", "AK3:PO1/12/8"]);
  });
});

describe("855 → the supplier-response path", () => {
  it("accepted with detail and no change is a confirmation", () => {
    const a = ack([seg("BAK", "00", "AD", "PO-0042", "20261120"), seg("PO1", "1", "40", "BG", "12.5"), seg("ACK", "IA", "40", "BG")]);
    expect(ackToResponse(a, poLines)).toEqual({ ok: true, kind: "confirm", lines: [], notes: [], needsReview: false });
  });

  it("a rejected order is a decline", () => {
    expect(ackToResponse(ack([seg("BAK", "00", "RJ", "PO-0042", "20261120")]), poLines)).toMatchObject({ ok: true, kind: "decline" });
  });

  it("quantity and date changes become proposed lines, never applied here", () => {
    const a = ack([
      seg("BAK", "00", "AC", "PO-0042", "20261120"),
      seg("PO1", "1", "40", "BG", "12.5"), seg("ACK", "IQ", "30", "BG", "068", "20261205"),
      seg("PO1", "2", "10", "CA", "8"), seg("ACK", "IR", "0", "CA"),
    ]);
    expect(ackToResponse(a, poLines)).toEqual({ ok: true, kind: "revise", needsReview: false, notes: [],
      lines: [{ lineId: "L1", qty: 30, date: "2026-12-05" }, { lineId: "L2", qty: 0, date: null }] });
  });

  it("a price change is never applied and puts the file in review", () => {
    const a = ack([seg("BAK", "00", "AC", "PO-0042", "20261120"), seg("PO1", "1", "40", "BG", "13"), seg("ACK", "IP", "40", "BG")]);
    const r = ackToResponse(a, poLines);
    expect(r).toMatchObject({ ok: true, kind: "confirm", needsReview: true, notes: [expect.stringMatching(/price change.*not applied/)] });
  });

  it("a split delivery proposes the total and the latest date, and asks a person to look", () => {
    const a = ack([seg("BAK", "00", "AC", "PO-0042", "20261120"), seg("PO1", "1", "40", "BG"),
      seg("ACK", "IB", "25", "BG", "068", "20261201"), seg("ACK", "IB", "15", "BG", "068", "20261215")]);
    expect(ackToResponse(a, poLines)).toMatchObject({ ok: true, kind: "revise", needsReview: true, lines: [{ lineId: "L1", qty: 40, date: "2026-12-15" }] });
  });

  it("never guesses: an unknown line, a quantity in another unit, a bad date, an unknown BAK02", () => {
    expect(ackToResponse(ack([seg("BAK", "00", "AC", "PO-0042"), seg("PO1", "9", "1", "BG"), seg("ACK", "IA")]), poLines))
      .toEqual({ ok: false, problems: [expect.stringMatching(/Line "9" is not a line of this order/)] });
    expect(ackToResponse(ack([seg("BAK", "00", "AC", "PO-0042"), seg("PO1", "1", "40", "BG"), seg("ACK", "IQ", "1000", "KG")]), poLines))
      .toEqual({ ok: false, problems: [expect.stringMatching(/quantity is in KG, the order is in BG/)] });
    expect(ackToResponse(ack([seg("BAK", "00", "AC", "PO-0042"), seg("PO1", "1", "40", "BG"), seg("ACK", "DR", "", "", "068", "20261332")]), poLines))
      .toEqual({ ok: false, problems: [expect.stringMatching(/"20261332" is not a date/)] });
    expect(ackToResponse(ack([seg("BAK", "00", "ZZ", "PO-0042")]), poLines)).toEqual({ ok: false, problems: [expect.stringMatching(/Unknown acknowledgement type/)] });
  });

  it("reads CCYYMMDD by slicing and refuses an impossible date", () => {
    expect(ymdFrom("20260229")).toBeNull();
    expect(ymdFrom("20280229")).toBe("2028-02-29");
  });
});

describe("856 → expected delivery", () => {
  const SSCC_PALLET = "354123450000000014", SSCC_CASE = "354123450000000021";
  const asnFile = (body: string[]) => interchange(env, "SH", "856", body);
  const notice = (body: string[]) => parse856(readInterchange(asnFile(body)).groups[0].txns[0].segments);
  // S → O → T (pallet) → P (case) → I, the usual pick-and-pack shape.
  const standard = (over: { sn1?: string[]; lin?: string[]; dtm?: string[]; purpose?: string } = {}) => [
    seg("BSN", over.purpose ?? "00", "ASN-7781", "20261121", "0900"),
    seg("HL", "1", "", "S"), seg("TD5", "B", "2", "DHLX", "M", "DHL Freight"), seg("REF", "CN", "TRK123"),
    seg("DTM", "011", "20261121"), seg("DTM", "017", "20261124"),
    seg("HL", "2", "1", "O"), seg("PRF", "PO-0042"),
    seg("HL", "3", "2", "T"), seg("MAN", "GM", SSCC_PALLET),
    seg("HL", "4", "3", "P"), seg("MAN", "GM", SSCC_CASE),
    seg("HL", "5", "4", "I"), seg("LIN", ...(over.lin ?? ["1", "VP", "SUP-88231", "BP", "RM-RICE", "LT", "B2401"])),
    seg("SN1", ...(over.sn1 ?? ["", "40", "BG"])),
    ...(over.dtm ?? [seg("DTM", "094", "20261101"), seg("DTM", "036", "20271101")]),
    seg("CTT", "1"),
  ];
  const lines: AsnPoLine[] = [{ id: "L1", lineNo: 1, itemCode: "RM-RICE", closed: false, orderUnitCode: "BG", baseUnitCode: "KG", unitsPerOrderUnit: 25 }];

  it("reads the shipment, the order, the pallet and case, and the item with batch and dates", () => {
    const n = notice(standard());
    expect(n).toMatchObject({ purpose: "00", shipmentId: "ASN-7781", shipDate: "2026-11-21", expectedDate: "2026-11-24", carrier: "DHL Freight", trackingNo: "TRK123", problems: [] });
    expect(n.orders).toEqual([{ poNumber: "PO-0042",
      items: [{ lineNo: "1", ids: { VP: "SUP-88231", BP: "RM-RICE", LT: "B2401" }, qty: 40, unit: "BG", batch: "B2401",
        productionDate: "2026-11-01", bestBeforeDate: null, expiryDate: "2027-11-01", badDates: [], sscc: SSCC_CASE }],
      packages: [{ sscc: SSCC_CASE, level: "pack", parentSscc: SSCC_PALLET }, { sscc: SSCC_PALLET, level: "tare", parentSscc: null }] }]);
  });

  it("becomes an ASN delivery for the PO line, the quantity in base units, packed as announced", () => {
    const n = notice(standard());
    const r = asnOrderToDelivery(n, n.orders[0], lines);
    expect(r).toMatchObject({ ok: true, notes: [], input: { source: "asn", reference: "ASN-7781", shipDate: "2026-11-21", expectedDate: "2026-11-24",
      carrier: "DHL Freight", trackingNo: "TRK123",
      lines: [{ poLineId: "L1", qtyBase: 1000, sscc: SSCC_CASE, supplierBatchNo: "B2401", productionDate: "2026-11-01", expiryDate: "2027-11-01" }] } });
    // And the existing delivery rules accept it as it stands.
    expect(prepareDelivery((r as any).input, { poLines: [{ id: "L1", itemId: "I1" }] }).ok).toBe(true);
  });

  it("accepts a quantity in the base unit too", () => {
    const n = notice(standard({ sn1: ["", "500", "KG"] }));
    expect(asnOrderToDelivery(n, n.orders[0], lines)).toMatchObject({ ok: true, input: { lines: [{ qtyBase: 500 }] } });
  });

  it("never guesses: an unknown line, another unit, our item code disagreeing, a bad date", () => {
    const run = (o: Parameters<typeof standard>[0]) => { const n = notice(standard(o)); return asnOrderToDelivery(n, n.orders[0], lines); };
    expect(run({ lin: ["9", "VP", "X"] })).toEqual({ ok: false, problems: [expect.stringMatching(/Line "9" is not a line of PO-0042/)] });
    expect(run({ sn1: ["", "40", "CA"] })).toEqual({ ok: false, problems: [expect.stringMatching(/quantity is in CA, the order line is in BG \(base KG\)/)] });
    expect(run({ lin: ["1", "BP", "RM-OATS"] })).toEqual({ ok: false, problems: [expect.stringMatching(/they name our item RM-OATS, the order line is RM-RICE/)] });
    expect(run({ dtm: [seg("DTM", "036", "20271340")] })).toEqual({ ok: false, problems: [expect.stringMatching(/Expiry date "20271340" is not a date/)] });
  });

  it("an item with no order above it is reported, not attached to a guess", () => {
    const n = notice([seg("BSN", "00", "ASN-1", "20261121"), seg("HL", "1", "", "S"), seg("HL", "2", "1", "I"), seg("LIN", "1"), seg("SN1", "", "1", "BG")]);
    expect(n.orders).toEqual([]);
    expect(n.problems).toEqual([expect.stringMatching(/no order \(HL O\) above it/)]);
  });

  it("knows what BSN01 asks, and keys several orders by shipment and PO", () => {
    expect([asnPurpose("00"), asnPurpose("05"), asnPurpose("01"), asnPurpose("ZZ")]).toEqual(["create", "replace", "cancel", null]);
    const two = notice([...standard().slice(0, -1), seg("HL", "6", "1", "O"), seg("PRF", "PO-0043"), seg("HL", "7", "6", "I"), seg("LIN", "1"), seg("SN1", "", "5", "BG"), seg("CTT", "2")]);
    expect(two.orders.map(o => asnReference(two, o.poNumber))).toEqual(["ASN-7781/PO-0042", "ASN-7781/PO-0043"]);
  });
});

describe("810 → a bill a person approves", () => {
  const inv = (it1: string[][], extra: string[] = []) => parse810(readInterchange(interchange(env, "IN", "810", [
    seg("BIG", "20261125", "INV-501", "", "PO-0042"), seg("CUR", "SE", "EUR"), seg("ITD", "01", "3", "", "", "", "", "30"),
    ...it1.map(a => seg("IT1", ...a)), ...extra, seg("CTT", String(it1.length)),
  ])).groups[0].txns[0].segments);
  const poLines: AsnPoLine[] = [
    { id: "L1", lineNo: 1, itemCode: "RM-RICE", closed: false, orderUnitCode: "BG", baseUnitCode: "KG", unitsPerOrderUnit: 25 },
    { id: "L2", lineNo: 2, itemCode: "RM-OATS", closed: false, orderUnitCode: "KG", baseUnitCode: "KG", unitsPerOrderUnit: 1 },
  ];
  // Two receipts on the PO: GRN-1 has 400 kg of rice, GRN-2 the other 600 kg and 50 kg of oats. Receipt price 0.5/kg rice, 2/kg oats.
  const receipts: InvoiceReceipt[] = [
    { id: "R2", receiptNo: "GRN-2", receiptDate: "2026-11-22", currency: "EUR", lines: [{ id: "g2a", poLineId: "L1", unbilledQty: 600, price: 0.5 }, { id: "g2b", poLineId: "L2", unbilledQty: 50, price: 2 }] },
    { id: "R1", receiptNo: "GRN-1", receiptDate: "2026-11-20", currency: "EUR", lines: [{ id: "g1", poLineId: "L1", unbilledQty: 400, price: 0.5 }] },
  ];

  it("reads the invoice: number, date, PO, currency, lines, net days, total in cents, tax and charges", () => {
    const i = inv([["1", "16", "BG", "12.5", "", "VP", "SUP-1", "BP", "RM-RICE"]], [seg("TDS", "22500"), seg("TXI", "VA", "25"), seg("SAC", "C", "D240", "", "", "1500")]);
    expect(i).toMatchObject({ invoiceNo: "INV-501", invoiceDate: "2026-11-25", poNumber: "PO-0042", currency: "EUR", netDays: 30, total: 225, tax: 25, charges: [{ code: "D240", amount: 15 }], problems: [] });
    expect(i.lines).toEqual([{ lineNo: "1", qty: 16, unit: "BG", price: 12.5, ids: { VP: "SUP-1", BP: "RM-RICE" } }]);
  });

  it("matches the oldest receipt that covers the invoice exactly, in base units, due 30 days on", () => {
    const r = invoiceToBill(inv([["1", "16", "BG", "12.5"]]), poLines, receipts, "EUR");
    expect(r).toMatchObject({ ok: true, notes: [], proposal: { invoiceNo: "INV-501", invoiceDate: "2026-11-25", dueDate: "2026-12-25",
      receiptIds: ["R1"], receiptNos: ["GRN-1"], prices: [], goods: 200 } });
  });

  it("takes a run of receipts when one is not enough, and only when nothing else on them is unbilled", () => {
    const both = invoiceToBill(inv([["1", "40", "BG", "12.5"], ["2", "50", "KG", "2"]]), poLines, receipts, "EUR");
    expect(both).toMatchObject({ ok: true, proposal: { receiptIds: ["R1", "R2"], goods: 600 } });
    // Rice for both receipts but no oats: GRN-2 would bill the oats too, so it is refused rather than over-billed.
    const riceOnly = invoiceToBill(inv([["1", "40", "BG", "12.5"]]), poLines, receipts, "EUR");
    expect(riceOnly).toMatchObject({ ok: false, problems: [expect.stringMatching(/do not match what has been received/)] });
  });

  it("carries a different invoice price as a per-base-unit price for that line, and says what it does", () => {
    const r = invoiceToBill(inv([["1", "16", "BG", "13"]]), poLines, receipts, "EUR");
    expect(r).toMatchObject({ ok: true, proposal: { prices: [{ lineId: "g1", unitCost: 0.52 }], goods: 208 }, notes: [expect.stringMatching(/purchase price variance/)] });
  });

  it("asks for the tax rate and names charges and a total that does not add up", () => {
    const r = invoiceToBill(inv([["1", "16", "BG", "12.5"]], [seg("TDS", "99900"), seg("TXI", "VA", "46"), seg("SAC", "C", "D240", "", "", "1500")]), poLines, receipts, "EUR");
    expect(r.ok && r.notes).toEqual([expect.stringMatching(/tax of 46: choose the tax rate/), expect.stringMatching(/charges or allowances of 15/), expect.stringMatching(/total is 999; goods 200 plus tax and charges come to 261/)]);
  });

  it("never guesses: another currency, an unknown line, another unit, nothing received", () => {
    expect(invoiceToBill(inv([["1", "16", "BG", "12.5"]]), poLines, receipts, "USD")).toMatchObject({ ok: false, problems: [expect.stringMatching(/in EUR, the goods were received in USD/)] });
    expect(invoiceToBill(inv([["7", "1", "BG", "1"]]), poLines, receipts, "EUR")).toMatchObject({ ok: false, problems: [expect.stringMatching(/Line "7" is not a line of PO-0042/)] });
    expect(invoiceToBill(inv([["1", "1", "CA", "1"]]), poLines, receipts, "EUR")).toMatchObject({ ok: false, problems: [expect.stringMatching(/invoiced in CA/)] });
    expect(invoiceToBill(inv([["1", "16", "BG", "12.5"]]), poLines, [], "EUR")).toMatchObject({ ok: false, problems: [expect.stringMatching(/Nothing received against PO-0042/)] });
  });
});

describe("one supplier-response path", () => {
  it("the portal and the 855 both go through recordSupplierResponse", () => {
    const src = readFileSync("lib/accounting/po-supplier-server.ts", "utf8");
    expect(src).toMatch(/submitSupplierResponse[\s\S]*?return recordSupplierResponse\(/);
    expect(readFileSync("lib/edi/inbound-server.ts", "utf8")).toMatch(/recordSupplierResponse\(orgId, po\.id/);
  });

  it("only a decline rejects the order; a proposed change leaves it live", () => {
    // Regression: a bare `else` after the confirm branch rejected the PO for every revision too.
    const src = readFileSync("lib/accounting/po-supplier-server.ts", "utf8");
    const body = src.slice(src.indexOf("export async function recordSupplierResponse"));
    const reject = body.indexOf("rejectedAt: now");
    const guard = body.lastIndexOf('else if (kind === "decline")', reject);
    expect(reject).toBeGreaterThan(0);
    expect(guard).toBeGreaterThan(0);
    expect(body.slice(guard, reject)).not.toMatch(/\n\s*}\s*else\s*{/);
  });
});
