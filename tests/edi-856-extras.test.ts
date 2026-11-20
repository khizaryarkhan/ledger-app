import { describe, it, expect } from "vitest";
import { readInterchange } from "@/lib/edi/x12/read";
import { parse856 } from "@/lib/edi/x12/inbound";
import { write856 } from "@/lib/edi/x12/856";
import { buildShipNotice, lotSplitsForLines, type ShipFacts, type LotIssue } from "@/lib/edi/build/shipment";
import { normaliseScac } from "@/lib/edi/scac";
import type { Envelope } from "@/lib/edi/x12/envelope";

const env: Envelope = { version: "004010", test: true, senderQualifier: "ZZ", senderId: "PRIMEFOODS", receiverQualifier: "ZZ",
  receiverId: "CUSTOMER", senderAppId: "PRIMEFOODS", receiverAppId: "CUSTOMER", controlNo: 61, now: { date: "20261126", time: "1000" } };

const P1 = "354123450000000014", P2 = "354123450000000021";
const ship = (over: Partial<ShipFacts> = {}): ShipFacts => ({
  shipment: { shipmentNo: "SHP-1", shipDate: "2026-11-26", carrier: "UPS Freight", carrierScac: "UPSN", trackingNo: null, posted: true },
  shipFrom: { name: "Prime Foods Ltd", gln: null },
  lines: [{ id: "SL1", soId: "S1", soLineId: "OL1", qtyBase: 600 }],
  orders: [{ soId: "S1", poNumber: "PO-1", poDate: "2026-11-20", shipTo: null,
    soLines: [{ id: "OL1", lineNo: 1, orderUom: "kg", baseUom: "kg", unitsPerOrderUnit: 1, itemCode: "RM" }], theirs: [{ lineNo: "10", unit: "KG" }] }],
  parts: { SL1: { bp: null, gtin: null } },
  packages: [{ id: "A", sscc: P1, parentId: null, packType: "pallet", weightKg: 640.5, lines: [{ shipmentLineId: "SL1", qtyBase: 600 }] }],
  replaces: false,
  ...over,
});
const asnOf = (f: ShipFacts) => { const r = buildShipNotice(f, {}); if (r.ok === false) throw new Error(JSON.stringify(r.problems)); return r.asn; };
const segs = (f: ShipFacts) => readInterchange(write856(asnOf(f), env)).groups[0].txns[0].segments;

describe("856 carrier code and weights", () => {
  it("names the carrier by its SCAC and sends the gross weight and each package's weight", () => {
    const s = segs(ship());
    expect(s.find(x => x[0] === "TD5")).toEqual(["TD5", "B", "2", "UPSN", "M", "UPS Freight"]);
    expect(s.find(x => x[0] === "TD1")).toEqual(["TD1", "PLT94", "1", "", "", "", "G", "640.5", "KG"]);
    expect(s.find(x => x[0] === "MEA")).toEqual(["MEA", "PD", "G", "640.5", "KG"]);
    expect(parse856(s).problems).toEqual([]);
  });

  it("sends no total when any top-level package has no weight, or the kinds are mixed", () => {
    const two = ship({ packages: [{ id: "A", sscc: P1, parentId: null, packType: "pallet", weightKg: 300, lines: [{ shipmentLineId: "SL1", qtyBase: 300 }] }, { id: "B", sscc: P2, parentId: null, packType: "pallet", weightKg: null, lines: [{ shipmentLineId: "SL1", qtyBase: 300 }] }] });
    expect(asnOf(two).weight).toBeNull();
    const mixed = ship({ packages: [{ id: "A", sscc: P1, parentId: null, packType: "pallet", weightKg: 300, lines: [{ shipmentLineId: "SL1", qtyBase: 300 }] }, { id: "B", sscc: P2, parentId: null, packType: "carton", weightKg: 5, lines: [{ shipmentLineId: "SL1", qtyBase: 300 }] }] });
    expect(asnOf(mixed).weight).toBeNull();
  });

  it("a shipment with no carrier code or weights writes the segments it always did", () => {
    const s = segs(ship({ shipment: { ...ship().shipment, carrierScac: null }, packages: [{ id: "A", sscc: P1, parentId: null, packType: "pallet", lines: [{ shipmentLineId: "SL1", qtyBase: 600 }] }] }));
    expect(s.find(x => x[0] === "TD5")).toEqual(["TD5", "", "", "", "M", "UPS Freight"]);
    expect(s.some(x => x[0] === "TD1" || x[0] === "MEA")).toBe(false);
  });

  it("a SCAC is 2 to 4 capital letters, typed by a person and never guessed", () => {
    expect(normaliseScac("upsn")).toEqual({ ok: true, scac: "UPSN" });
    expect(normaliseScac("")).toEqual({ ok: true, scac: null });
    expect(normaliseScac("U").ok).toBe(false);
    expect(normaliseScac("UP5N").ok).toBe(false);
  });
});

describe("856 batch on a line issued from several lots", () => {
  const issue = (lotId: string, qty: number, batch: string): LotIssue => ({ itemId: "I1", lotId, qtyBase: qty, batch, productionDate: null, bestBeforeDate: null, expiryDate: null });
  const splits = lotSplitsForLines([{ id: "SL1", itemId: "I1" }], [issue("L1", 400, "B1"), issue("L2", 200, "B2"), issue("L1", 0, "B1")]);

  it("splits a line by lot, adding up a lot's several movements", () => {
    expect(splits.SL1.map(x => [x.batch, x.qtyBase])).toEqual([["B1", 400], ["B2", 200]]);
  });

  it("sends one item per lot when the whole line sits in one package", () => {
    const a = asnOf(ship({ lotSplits: splits }));
    expect(a.orders[0].packages[0].items.map(i => [i.qty, i.batch])).toEqual([[400, "B1"], [200, "B2"]]);
  });

  it("sends one item per lot when the whole line is loose", () => {
    const a = asnOf(ship({ lotSplits: splits, packages: [] }));
    expect(a.orders[0].loose.map(i => [i.qty, i.batch])).toEqual([[400, "B1"], [200, "B2"]]);
  });

  it("never guesses: a line spread over two packages, or part packed and part loose, gets no batch", () => {
    const spread = ship({ lotSplits: splits, packages: [{ id: "A", sscc: P1, parentId: null, packType: "pallet", lines: [{ shipmentLineId: "SL1", qtyBase: 300 }] }, { id: "B", sscc: P2, parentId: null, packType: "pallet", lines: [{ shipmentLineId: "SL1", qtyBase: 300 }] }] });
    expect(asnOf(spread).orders[0].packages.flatMap(p => p.items).map(i => i.batch)).toEqual([undefined, undefined]);
    const partLoose = ship({ lotSplits: splits, packages: [{ id: "A", sscc: P1, parentId: null, packType: "pallet", lines: [{ shipmentLineId: "SL1", qtyBase: 400 }] }] });
    const a = asnOf(partLoose);
    expect([...a.orders[0].packages.flatMap(p => p.items), ...a.orders[0].loose].map(i => i.batch)).toEqual([undefined, undefined]);
  });

  it("never guesses: lots that do not add up to the line get no batch", () => {
    const short = lotSplitsForLines([{ id: "SL1", itemId: "I1" }], [issue("L1", 300, "B1"), issue("L2", 200, "B2")]);
    expect(asnOf(ship({ lotSplits: short })).orders[0].packages[0].items.map(i => i.batch)).toEqual([undefined]);
  });
});
