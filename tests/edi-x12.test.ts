import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { partnerValues, unitOverrideValues } from "@/lib/edi/partner";
import { prepareOrderForX12, x12UnitFor } from "@/lib/edi/validate";
import { buildEdiOrderFromPo, type PoFacts } from "@/lib/edi/build/purchase-order";
import { write850, gtinPair } from "@/lib/edi/x12/850";
import { clean, num, ccyymmdd, segments, type Envelope } from "@/lib/edi/x12/envelope";

const facts = (over: Partial<PoFacts["lines"][number]> = {}): PoFacts => ({
  po: { docNumber: "PO-0042", issueDate: "2026-11-20", currency: "eur", expiryDate: "2026-12-01", incoterm: "FCA",
    incotermPlace: "Rotterdam", paymentTermsDays: 30, discountPercent: "2", discountDays: 10, total: "500.00" },
  org: { name: "Prime Foods Ltd", displayName: null, gln: "5412345000013", addressStreet: "1 Mill Lane", addressCity: "Dublin", addressPostcode: "D02 X285", countryCode: "IE" },
  supplier: { name: "Grain & Co*", gln: null, ourAccountNumber: "CUST-77", addressCity: "Lyon", countryCode: "FR" },
  shipTo: { name: "Main Store", gln: "5412345000020", addressStreet: "Unit 4", addressCity: "Dublin", addressState: "Leinster", countryCode: "IE" },
  lines: [{ lineNo: 1, description: "Rice 25 kg bag", itemName: "Rice", itemCode: "RM-RICE", qty: "40", rate: "12.5", orderUom: "bag",
    baseUom: "kg", unitsPerOrderUnit: "25", partNumber: "SUP-88231", gtin: "00012345678905", requestedDate: "2026-12-01", ...over }],
});
const env: Envelope = { version: "004010", test: true, senderQualifier: "ZZ", senderId: "PRIMEFOODS", receiverQualifier: "01",
  receiverId: "123456789", senderAppId: "PRIMEFOODS", receiverAppId: "123456789", controlNo: 42, now: { date: "20261120", time: "1305" } };
const rules = { requirePartNumber: true, requireGtin: false, unitOverrides: {} as Record<string, string> };

function fileFor(f: PoFacts, e: Envelope = env) {
  const order = buildEdiOrderFromPo(f);
  const prep = prepareOrderForX12(order, rules);
  if (prep.ok === false) throw new Error(JSON.stringify(prep.problems));
  return write850(order, prep.lines, e);
}

describe("partner profile rules", () => {
  it("accepts a complete profile with test mode and 4010 by default", () => {
    const r = partnerValues({ senderQualifier: "zz", senderId: "PRIMEFOODS", receiverQualifier: "01", receiverId: "123456789" });
    expect(r.ok).toBe(true);
    expect(r.ok && r.value).toMatchObject({ mode: "test", version: "004010", senderQualifier: "ZZ", docsOut: ["850"], requirePartNumber: true });
  });
  it("refuses a separator in an ID, an unknown qualifier, and a document not built yet", () => {
    expect(partnerValues({ senderQualifier: "ZZ", senderId: "A*B", receiverQualifier: "01", receiverId: "1" })).toEqual({ ok: false, error: expect.stringMatching(/plain letters/) });
    expect(partnerValues({ senderQualifier: "QQ", senderId: "A", receiverQualifier: "01", receiverId: "1" })).toEqual({ ok: false, error: expect.stringMatching(/qualifier/) });
    expect(partnerValues({ senderQualifier: "ZZ", senderId: "A", receiverQualifier: "01", receiverId: "1", docsOut: ["810"] })).toEqual({ ok: false, error: expect.stringMatching(/810 is not a document/) });
  });
  it("keeps unit overrides as our unit → a 2-character code", () => {
    expect(unitOverrideValues({ " Case ": "cs" })).toEqual({ case: "CS" });
    expect(() => unitOverrideValues({ case: "CASE" })).toThrow(/2 letters or digits/);
  });
});

describe("pre-send validation", () => {
  it("resolves the order unit and the pack content unit", () => {
    const prep = prepareOrderForX12(buildEdiOrderFromPo(facts()), rules);
    expect(prep).toEqual({ ok: true, lines: [{ lineNo: 1, unitCode: "BG", packUnitCode: "KG" }] });
  });
  it("names the line and never guesses: missing part number, no identifier, an unknown unit", () => {
    const p1 = prepareOrderForX12(buildEdiOrderFromPo(facts({ partNumber: null })), rules);
    expect(p1.ok === false && p1.problems).toEqual([{ lineNo: 1, message: expect.stringMatching(/part number/) }]);
    const p2 = prepareOrderForX12(buildEdiOrderFromPo(facts({ partNumber: null, gtin: null, itemCode: null })), { ...rules, requirePartNumber: false });
    expect(p2.ok === false && p2.problems[0].message).toMatch(/Nothing identifies this item/);
    const p3 = prepareOrderForX12(buildEdiOrderFromPo(facts({ orderUom: "wibble" })), rules);
    expect(p3.ok === false && p3.problems[0]).toMatchObject({ lineNo: 1, message: expect.stringMatching(/^Unit:/) });
  });
  it("uses the partner's own unit code first", () => {
    expect(x12UnitFor("bag", { bag: "SA" })).toEqual({ ok: true, code: "SA" });
  });
});

describe("X12 850", () => {
  const file = fileFor(facts());
  const segs = segments(file);
  const ids = segs.map(s => s[0]);

  it("is one interchange: ISA GS ST … SE GE IEA, with a fixed-width 106-character ISA", () => {
    expect(ids[0]).toBe("ISA"); expect(ids[1]).toBe("GS"); expect(ids[2]).toBe("ST");
    expect(ids.slice(-3)).toEqual(["SE", "GE", "IEA"]);
    expect(file.split("\n")[0]).toHaveLength(106);
    const isa = segs[0];
    expect(isa[6]).toBe("PRIMEFOODS     "); expect(isa[13]).toBe("000000042"); expect(isa[15]).toBe("T"); expect(isa[12]).toBe("00401");
    expect(segs[1]).toEqual(["GS", "PO", "PRIMEFOODS", "123456789", "20261120", "1305", "42", "X", "004010"]);
  });

  it("counts ST through SE in SE01 and repeats the control numbers in GE and IEA", () => {
    const st = ids.indexOf("ST"), se = ids.indexOf("SE");
    expect(Number(segs[se][1])).toBe(se - st + 1);
    expect(segs[se][2]).toBe(segs[st][2]);
    expect(segs[ids.indexOf("GE")]).toEqual(["GE", "1", "42"]);
    expect(segs[ids.indexOf("IEA")]).toEqual(["IEA", "1", "000000042"]);
  });

  it("writes the header: order number and date, currency, our account no., incoterm, terms, delivery date", () => {
    const by = (id: string) => segs.find(s => s[0] === id)!;
    expect(by("BEG")).toEqual(["BEG", "00", "SA", "PO-0042", "", "20261120"]);
    expect(by("CUR")).toEqual(["CUR", "BY", "EUR"]);
    expect(by("REF")).toEqual(["REF", "11", "CUST-77"]);
    expect(by("FOB")).toEqual(["FOB", "DF", "", "", "01", "FCA", "ZZ", "Rotterdam"]);
    expect(by("ITD")).toEqual(["ITD", "08", "3", "2", "", "10", "", "30"]);
    expect(by("DTM")).toEqual(["DTM", "002", "20261201"]);
  });

  it("names the parties with GLNs, cleans a separator out of a name, and leaves out a non-code state", () => {
    expect(segs.filter(s => s[0] === "N1")).toEqual([
      ["N1", "BY", "Prime Foods Ltd", "UL", "5412345000013"], ["N1", "SE", "Grain & Co"], ["N1", "ST", "Main Store", "UL", "5412345000020"],
    ]);
    expect(segs.filter(s => s[0] === "N4").at(-1)).toEqual(["N4", "Dublin", "", "", "IE"]);
  });

  it("writes the line in its order unit with the part number, GTIN and our code, and the pack content", () => {
    expect(segs.find(s => s[0] === "PO1")).toEqual(["PO1", "1", "40", "BG", "12.5", "", "VP", "SUP-88231", "UP", "012345678905", "BP", "RM-RICE"]);
    expect(segs.find(s => s[0] === "PO4")).toEqual(["PO4", "1", "25", "KG"]);
    expect(segs.find(s => s[0] === "CTT")).toEqual(["CTT", "1", "40"]);
    expect(segs.find(s => s[0] === "AMT")).toEqual(["AMT", "TT", "500"]);
  });

  it("uses the 5010 repetition separator and the live indicator", () => {
    const isa = segments(fileFor(facts(), { ...env, version: "005010", test: false }))[0];
    expect(isa[11]).toBe("^"); expect(isa[12]).toBe("00501"); expect(isa[15]).toBe("P");
  });
});

describe("wire helpers", () => {
  it("maps GTIN-14 to the X12 qualifier for its real length", () => {
    expect(gtinPair("00012345678905")).toEqual(["UP", "012345678905"]);
    expect(gtinPair("05412345000013")).toEqual(["EN", "5412345000013"]);
    expect(gtinPair("15412345000010")).toEqual(["UK", "15412345000010"]);
  });
  it("cleans separators and accents, formats decimals, slices dates", () => {
    expect(clean("Café ~ Crème*Brûlée\n")).toBe("Cafe Creme Brulee");
    expect(num(10.123456789)).toBe("10.123457"); expect(num(40)).toBe("40"); expect(num(2.5, 2)).toBe("2.5");
    expect(ccyymmdd("2026-03-09")).toBe("20260309");
    expect(() => ccyymmdd("9 Mar 2026")).toThrow();
  });
});

describe("EDI boundaries", () => {
  const walk = (dir: string): string[] => readdirSync(dir).flatMap(n => {
    const p = join(dir, n);
    if (n === "node_modules" || n.startsWith(".")) return [];
    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(n) ? [p] : [];
  });
  const edi = walk("lib/edi");
  it("nothing in lib/edi posts stock or ledger", () => {
    const banned = /postJournalEntry|postDocument|postGoodsReceipt|commitReceipt|commitIssue|postShipment|@\/lib\/ledger"/;
    const offenders = edi.filter(f => banned.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
  it("only lib/edi imports the X12 adapter", () => {
    const outside = [...walk("lib"), ...walk("app"), ...walk("components")].filter(f => !f.replace(/\\/g, "/").startsWith("lib/edi/"));
    const offenders = outside.filter(f => /@\/lib\/edi\/x12/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
