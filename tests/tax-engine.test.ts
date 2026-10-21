import { describe, it, expect } from "vitest";
import {
  calcLineTax, aggregateDocumentTax, TAX_TREATMENTS, TAX_TREATMENT_META, isTaxTreatment,
  type TaxCodeRates, type TaxComponentRate,
} from "@/lib/accounting/tax-engine";

const comp = (over: Partial<TaxComponentRate> = {}): TaxComponentRate => ({
  componentId: "c1", name: "Standard", rate: 20, sequence: 0,
  salesAccountId: "sales-acct", purchaseAccountId: "purchase-acct", ...over,
});
const code = (over: Partial<TaxCodeRates> = {}): TaxCodeRates => ({
  id: "code1", name: "Standard 20%", treatment: "standard", compound: false,
  components: [comp()], ...over,
});

describe("calcLineTax — no tax code", () => {
  it("passes the amount through as net with zero tax", () => {
    const r = calcLineTax(100, "exclusive", null, true);
    expect(r).toEqual({ net: 100, gross: 100, componentAmounts: [], taxTotal: 0, notionalComponentAmounts: [], notionalTotal: 0 });
  });
});

describe("calcLineTax — single-rate, exclusive pricing", () => {
  it("computes tax on top of the net amount", () => {
    const r = calcLineTax(100, "exclusive", code(), true);
    expect(r.net).toBe(100);
    expect(r.taxTotal).toBe(20);
    expect(r.gross).toBe(120);
    expect(r.componentAmounts).toEqual([{ componentId: "c1", name: "Standard", rate: 20, amount: 20, rawAmount: 20, accountId: "sales-acct" }]);
  });

  it("resolves the purchase account, not the sales account, when isSale is false", () => {
    const r = calcLineTax(100, "exclusive", code(), false);
    expect(r.componentAmounts[0].accountId).toBe("purchase-acct");
  });
});

describe("calcLineTax — single-rate, inclusive pricing", () => {
  it("backs the net amount out of a tax-inclusive gross amount", () => {
    // 120 inclusive of 20% = 100 net + 20 tax, exactly.
    const r = calcLineTax(120, "inclusive", code(), true);
    expect(r.net).toBe(100);
    expect(r.taxTotal).toBe(20);
    expect(r.gross).toBe(120);
  });

  it("round-trips exclusive -> gross -> inclusive back to the same net", () => {
    const excl = calcLineTax(133.33, "exclusive", code({ components: [comp({ rate: 15 })] }), true);
    const incl = calcLineTax(excl.gross, "inclusive", code({ components: [comp({ rate: 15 })] }), true);
    expect(incl.net).toBeCloseTo(excl.net, 2);
  });
});

describe("calcLineTax — compound tax (sequential)", () => {
  it("computes the second component on top of net + the first component", () => {
    // 10% then 5% compound on 100: first = 10, second = (100+10)*5% = 5.5
    const c = code({ compound: true, components: [
      comp({ componentId: "a", rate: 10, sequence: 0 }),
      comp({ componentId: "b", rate: 5, sequence: 1 }),
    ] });
    const r = calcLineTax(100, "exclusive", c, true);
    expect(r.componentAmounts.map(x => x.amount)).toEqual([10, 5.5]);
    expect(r.taxTotal).toBe(15.5);
  });

  it("respects sequence order regardless of array order", () => {
    const c = code({ compound: true, components: [
      comp({ componentId: "b", rate: 5, sequence: 1 }),
      comp({ componentId: "a", rate: 10, sequence: 0 }),
    ] });
    const r = calcLineTax(100, "exclusive", c, true);
    expect(r.componentAmounts.map(x => x.componentId)).toEqual(["a", "b"]);
  });

  it("inclusive pricing backs out a compound code's net correctly", () => {
    const c = code({ compound: true, components: [
      comp({ componentId: "a", rate: 10, sequence: 0 }),
      comp({ componentId: "b", rate: 5, sequence: 1 }),
    ] });
    // gross multiplier = 1.10 * 1.05 = 1.155; net = 115.5 / 1.155 = 100
    const r = calcLineTax(115.5, "inclusive", c, true);
    expect(r.net).toBe(100);
  });
});

describe("calcLineTax — split tax, non-compound (e.g. India CGST + SGST)", () => {
  it("computes every component on the SAME net, not on top of each other", () => {
    const c = code({ compound: false, components: [
      comp({ componentId: "cgst", name: "CGST", rate: 9, sequence: 0 }),
      comp({ componentId: "sgst", name: "SGST", rate: 9, sequence: 1 }),
    ] });
    const r = calcLineTax(100, "exclusive", c, true);
    expect(r.componentAmounts.map(x => x.amount)).toEqual([9, 9]);
    expect(r.taxTotal).toBe(18);
  });
});

describe("calcLineTax — treatments that don't charge tax", () => {
  const nonCharging: Array<typeof TAX_TREATMENTS[number]> = ["zero_rated", "exempt", "out_of_scope", "export", "reverse_charge"];

  it.each(nonCharging)("%s zeroes the tax shown on the document", (treatment) => {
    const r = calcLineTax(100, "exclusive", code({ treatment }), true);
    expect(r.taxTotal).toBe(0);
    expect(r.gross).toBe(100);
    expect(r.componentAmounts[0].amount).toBe(0);
  });

  it.each(nonCharging)("%s still exposes the notional amount for self-assessment/reporting", (treatment) => {
    const r = calcLineTax(100, "exclusive", code({ treatment }), true);
    expect(r.notionalTotal).toBe(20);
    expect(r.notionalComponentAmounts[0].amount).toBe(20);
  });

  it("standard and reduced actually charge", () => {
    expect(TAX_TREATMENT_META.standard.chargesTax).toBe(true);
    expect(TAX_TREATMENT_META.reduced.chargesTax).toBe(true);
  });

  it("reverse charge carries the required legal wording; the others don't need one", () => {
    expect(TAX_TREATMENT_META.reverse_charge.legalWording).toBeTruthy();
  });
});

describe("isTaxTreatment", () => {
  it("accepts every listed treatment and rejects anything else", () => {
    for (const t of TAX_TREATMENTS) expect(isTaxTreatment(t)).toBe(true);
    expect(isTaxTreatment("vat")).toBe(false);
    expect(isTaxTreatment(null)).toBe(false);
  });
});

describe("aggregateDocumentTax", () => {
  it("sums already-rounded per-line amounts under perLine mode", () => {
    const l1 = calcLineTax(10.005, "exclusive", code({ components: [comp({ rate: 20 })] }), true); // net rounds to 10.01 (banker-free: *100 round)
    const l2 = calcLineTax(10.005, "exclusive", code({ components: [comp({ rate: 20 })] }), true);
    const { components, total } = aggregateDocumentTax([l1, l2], "perLine");
    expect(components).toHaveLength(1);
    expect(components[0].amount).toBe(round2to(l1.taxTotal + l2.taxTotal));
    expect(total).toBe(components[0].amount);
  });

  it("rounds once per component under perDocument mode instead of summing per-line roundings", () => {
    // Three lines of 0.033 net at 10% each round individually to 0 (0.0033 -> 0.00),
    // but their true sum (0.0099) still rounds to 0.01 once aggregated.
    const c = code({ components: [comp({ rate: 10 })] });
    const lines = [calcLineTax(0.033, "exclusive", c, true), calcLineTax(0.033, "exclusive", c, true), calcLineTax(0.033, "exclusive", c, true)];
    expect(lines.every(l => l.taxTotal === 0)).toBe(true); // each line alone rounds to nothing
    const perLine = aggregateDocumentTax(lines, "perLine");
    const perDoc = aggregateDocumentTax(lines, "perDocument");
    expect(perLine.total).toBe(0);
    expect(perDoc.total).toBe(0.01);
  });

  it("groups by component id across lines with different rates", () => {
    const standard = code({ components: [comp({ componentId: "std", rate: 20 })] });
    const reduced = code({ components: [comp({ componentId: "red", rate: 5 })] });
    const l1 = calcLineTax(100, "exclusive", standard, true);
    const l2 = calcLineTax(100, "exclusive", reduced, true);
    const { components, total } = aggregateDocumentTax([l1, l2], "perLine");
    expect(components.map(c => c.componentId).sort()).toEqual(["red", "std"]);
    expect(total).toBe(25);
  });
});

function round2to(n: number) { return Math.round(n * 100) / 100; }
