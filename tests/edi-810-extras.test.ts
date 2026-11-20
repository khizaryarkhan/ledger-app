import { describe, it, expect } from "vitest";
import { readInterchange } from "@/lib/edi/x12/read";
import { parse810 } from "@/lib/edi/x12/inbound";
import { write810 } from "@/lib/edi/x12/810";
import { buildInvoice, buildCreditNote, type InvFacts, type CreditFacts } from "@/lib/edi/build/invoice";
import { partnerValues, EDI_TAX_TYPES } from "@/lib/edi/partner";
import type { Envelope } from "@/lib/edi/x12/envelope";

const env: Envelope = { version: "004010", test: true, senderQualifier: "ZZ", senderId: "PRIMEFOODS", receiverQualifier: "ZZ",
  receiverId: "CUSTOMER", senderAppId: "PRIMEFOODS", receiverAppId: "CUSTOMER", controlNo: 41, now: { date: "20261126", time: "1000" } };

// One carton line of 100 plus 20 freight and 10 off, net 110, 23% tax.
const inv = (over: Partial<InvFacts> = {}): InvFacts => ({
  invoice: { docNumber: "INV-1", date: "2026-11-27", dueDate: null, currency: "EUR", net: 110, tax: 25.3, total: 135.3, posted: true },
  customer: { name: "Customer Ltd", gln: null }, us: { name: "Prime Foods Ltd", gln: null },
  lines: [{ shipLineId: "SL1", soId: "S1", soLineId: "OL1", qtyBase: 100, amount: 100, ratePerBase: 1 }],
  orders: [{ soId: "S1", poNumber: "PO-1", poDate: "2026-11-20", soLines: [{ id: "OL1", lineNo: 1, orderUom: "kg", baseUom: "kg", unitsPerOrderUnit: 1, itemCode: "RM" }], theirs: null }],
  parts: { SL1: { bp: null, gtin: null } },
  extras: [{ description: "Freight", amount: 20 }, { description: "Early order discount", amount: -10 }],
  ...over,
});

const credit = (over: Partial<CreditFacts> = {}): CreditFacts => ({
  credit: { docNumber: "CN-1", date: "2026-11-28", currency: "EUR", net: 50, tax: 11.5, total: 61.5, posted: true },
  customer: { name: "Customer Ltd", gln: null }, us: { name: "Prime Foods Ltd", gln: null },
  lines: [{ description: "Rice", itemCode: "RM-RICE", baseUom: "kg", qty: 5, rate: 10, amount: 50, bp: "THEIR-1", gtin: null }],
  ...over,
});

const segsOf = (file: string) => readInterchange(file).groups[0].txns[0].segments;

describe("810 charges, allowances and tax type", () => {
  it("sends freight as a charge and a discount as an allowance, in cents, and counts them toward the net", () => {
    const r = buildInvoice(inv(), {}, "VA");
    if (r.ok === false) throw new Error(JSON.stringify(r.problems));
    expect(r.invoice.charges).toEqual([{ kind: "C", description: "Freight", amount: 20 }, { kind: "A", description: "Early order discount", amount: 10 }]);
    const s = segsOf(write810(r.invoice, env));
    const sacs = s.filter(x => x[0] === "SAC");
    expect(sacs.map(x => [x[1], x[5], x[15]])).toEqual([["C", "2000", "Freight"], ["A", "1000", "Early order discount"]]);
    expect(s.find(x => x[0] === "TXI")?.slice(1, 3)).toEqual(["VA", "25.3"]);
    expect(s.find(x => x[0] === "BIG")?.[7]).toBe("DI");
    expect(parse810(s).problems).toEqual([]);
  });

  it("refuses when goods plus charges do not add up to the invoice net", () => {
    const r = buildInvoice(inv({ extras: [{ description: "Freight", amount: 20 }] }), {});
    expect(r.ok === false && r.problems.map(p => p.message).join(" ")).toMatch(/shipment lines and charges add up to 120/);
  });

  it("with no charges and the default tax type the file is what it was before, apart from the explicit DI", () => {
    const r = buildInvoice(inv({ extras: [], invoice: { ...inv().invoice, net: 100, tax: 23, total: 123 } }), {});
    if (r.ok === false) throw new Error(JSON.stringify(r.problems));
    const s = segsOf(write810(r.invoice, env));
    expect(s.filter(x => x[0] === "SAC")).toEqual([]);
    expect(s.find(x => x[0] === "TXI")?.[1]).toBe("ZZ");
  });

  it("a partner's tax type must be one of the listed codes", () => {
    expect(EDI_TAX_TYPES.map(t => t.code)).toContain("VA");
    const base = { partyId: "p", senderQualifier: "ZZ", senderId: "A", receiverQualifier: "ZZ", receiverId: "B" };
    expect(partnerValues({ ...base, taxType: "XX" }).ok).toBe(false);
    const ok = partnerValues({ ...base, taxType: "gs" });
    expect(ok.ok && ok.value.taxType).toBe("GS");
  });
});

describe("810 credit memo (BIG07 CR)", () => {
  it("builds lines 1..n from the credit itself, with no PO number, and is read back by our own reader", () => {
    const r = buildCreditNote(credit(), {}, "VA");
    if (r.ok === false) throw new Error(JSON.stringify(r.problems));
    expect(r.invoice).toMatchObject({ kind: "credit", poNumber: null, net: 50, tax: 11.5, total: 61.5 });
    expect(r.invoice.items).toEqual([{ lineNo: "1", partNumber: "THEIR-1", gtin: null, itemCode: "RM-RICE", qty: 5, unit: "KG", price: 10, poNumber: "" }]);
    const s = segsOf(write810(r.invoice, env));
    expect(s.find(x => x[0] === "BIG")?.[7]).toBe("CR");
    expect(s.find(x => x[0] === "IT1")?.some(e => e === "PO")).toBe(false);
    expect(parse810(s)).toMatchObject({ invoiceNo: "CN-1", total: 61.5, problems: [] });
  });

  it("never guesses: not posted, lines that do not add up, no goods lines, a unit with no EDI code", () => {
    const msg = (f: CreditFacts) => { const r = buildCreditNote(f, {}); return r.ok === false ? r.problems.map(p => p.message).join(" | ") : "OK"; };
    expect(msg(credit({ credit: { ...credit().credit, posted: false } }))).toMatch(/not posted/);
    expect(msg(credit({ credit: { ...credit().credit, net: 60, total: 71.5 } }))).toMatch(/add up to 50, the credit net is 60/);
    expect(msg(credit({ lines: [], credit: { ...credit().credit, net: 0, tax: 0, total: 0 } }))).toMatch(/no goods lines/);
    expect(msg(credit({ lines: [{ ...credit().lines[0], baseUom: "zorb" }] }))).toMatch(/unit/);
  });
});
