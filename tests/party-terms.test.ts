import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { termsValues, termsForDocument, termsLabel, incotermLabel, INCOTERMS, contactValues } from "@/lib/party-terms";

describe("termsValues", () => {
  it("writes only what was sent, and normalises", () => {
    expect(termsValues({ ourAccountNumber: " AC-77 " })).toEqual({ values: { ourAccountNumber: "AC-77" } });
    expect(termsValues({ discountPercent: "2", discountDays: "10", incoterm: "fob", incotermPlace: " Dublin  Port " }, { paymentTermsDays: 30 }))
      .toEqual({ values: { discountPercent: "2.00", discountDays: 10, incoterm: "FOB", incotermPlace: "Dublin Port" } });
  });

  it("refuses half a discount, judged against what is already stored", () => {
    expect(termsValues({ discountPercent: "2" })).toEqual({ error: expect.stringMatching(/both the percentage and the number of days/) });
    // Clearing the days while a percentage is stored leaves half a discount.
    expect(termsValues({ discountDays: "" }, { discountPercent: "2.00", discountDays: 10 })).toEqual({ error: expect.stringMatching(/both the percentage/) });
    // Clearing both is fine.
    expect(termsValues({ discountPercent: "", discountDays: "" }, { discountPercent: "2.00", discountDays: 10 })).toEqual({ values: { discountPercent: null, discountDays: null } });
  });

  it("refuses a discount that is not for paying early, or not a real percentage", () => {
    expect(termsValues({ discountPercent: "2", discountDays: "30" }, { paymentTermsDays: 30 })).toEqual({ error: expect.stringMatching(/30 days is not before the payment terms of 30 days/) });
    expect(termsValues({ discountPercent: "100", discountDays: "5" })).toEqual({ error: expect.stringMatching(/above 0 and below 100/) });
    expect(termsValues({ discountPercent: "1.255", discountDays: "5" })).toEqual({ error: expect.stringMatching(/at most 2 decimals/) });
    expect(termsValues({ discountPercent: "2", discountDays: "2.5" })).toEqual({ error: expect.stringMatching(/whole number of days/) });
  });

  it("knows the eleven Incoterms 2020 rules and refuses anything else", () => {
    expect(INCOTERMS.map(t => t.code)).toEqual(["EXW", "FCA", "CPT", "CIP", "DAP", "DPU", "DDP", "FAS", "FOB", "CFR", "CIF"]);
    expect(termsValues({ incoterm: "DDU", incotermPlace: "x" })).toEqual({ error: expect.stringMatching(/not an Incoterms 2020 rule/) });
  });

  it("needs the named place with a term, and refuses a place on its own", () => {
    expect(termsValues({ incoterm: "FOB" })).toEqual({ error: expect.stringMatching(/FOB needs its named port of shipment/) });
    expect(termsValues({ incotermPlace: "Cork" })).toEqual({ error: expect.stringMatching(/only means something with an Incoterm/) });
    // Clearing the term while a place is stored leaves a place on its own.
    expect(termsValues({ incoterm: "" }, { incoterm: "FOB", incotermPlace: "Cork" })).toEqual({ error: expect.stringMatching(/only means something with an Incoterm/) });
  });
});

describe("termsForDocument", () => {
  const party = { paymentTerms: 30, discountPercent: "2.00", discountDays: 10, incoterm: "FCA", incotermPlace: "Our warehouse" };
  it("copies the party's terms onto an order", () => {
    expect(termsForDocument(party)).toEqual({ terms: { paymentTermsDays: 30, discountPercent: "2.00", discountDays: 10, incoterm: "FCA", incotermPlace: "Our warehouse" } });
    expect(termsForDocument(null)).toEqual({ terms: { paymentTermsDays: null, discountPercent: null, discountDays: null, incoterm: null, incotermPlace: null } });
  });
  it("lets the order set its own Incoterm, but never only half of one, and never its payment terms", () => {
    expect(termsForDocument(party, { incoterm: "DAP", incotermPlace: "Cork DC" })).toEqual({ terms: expect.objectContaining({ incoterm: "DAP", incotermPlace: "Cork DC", paymentTermsDays: 30 }) });
    expect(termsForDocument(party, { incoterm: null, incotermPlace: null })).toEqual({ terms: expect.objectContaining({ incoterm: null, incotermPlace: null }) });
    expect(termsForDocument(party, { incoterm: "DAP" })).toEqual({ error: expect.stringMatching(/DAP needs its named place of destination/) });
  });
});

describe("labels", () => {
  it("reads terms the way they are written on an invoice", () => {
    expect(termsLabel({ paymentTermsDays: 30, discountPercent: "2.00", discountDays: 10 })).toBe("2% 10, net 30");
    expect(termsLabel({ paymentTermsDays: 30, discountPercent: "1.50", discountDays: 7 })).toBe("1.5% 7, net 30");
    expect(termsLabel({ paymentTermsDays: 0 })).toBe("Due on receipt");
    expect(termsLabel({})).toBeNull();
    expect(incotermLabel({ incoterm: "FOB", incotermPlace: "Dublin Port" })).toBe("FOB Dublin Port");
    expect(incotermLabel({})).toBeNull();
  });
});

describe("contactValues", () => {
  it("needs a name, a known role and a way to reach the person", () => {
    expect(contactValues({ name: "Ann", role: "accounts", email: "ann@supplier.test" }, { creating: true }))
      .toEqual({ values: { name: "Ann", role: "accounts", email: "ann@supplier.test" } });
    expect(contactValues({ email: "a@b.test" }, { creating: true })).toEqual({ error: "A contact needs a name." });
    expect(contactValues({ name: "Ann", role: "boss", phone: "1" }, { creating: true })).toEqual({ error: "Choose what this contact handles." });
    expect(contactValues({ name: "Ann" }, { creating: true })).toEqual({ error: expect.stringMatching(/email or a phone number/) });
    expect(contactValues({ name: "Ann", email: "not-an-email" }, { creating: true })).toEqual({ error: expect.stringMatching(/is not an email address/) });
  });
  it("judges reachability on an edit against what is stored", () => {
    expect(contactValues({ email: "" }, { creating: false, current: { email: "a@b.test", phone: null } })).toEqual({ error: expect.stringMatching(/email or a phone number/) });
    expect(contactValues({ email: "" }, { creating: false, current: { email: "a@b.test", phone: "123" } })).toEqual({ values: { email: null } });
  });
});

describe("migration 0142", () => {
  const sql = readFileSync("db/migrations/0142_party_trading_terms.sql", "utf8");
  it("copies terms onto orders and settles one primary contact in the database", () => {
    expect(sql).toMatch(/ALTER TABLE "trade_documents"[^;]+"incoterm" varchar\(3\)[^;]+"incoterm_place" varchar\(128\)/);
    expect(sql).toMatch(/UNIQUE INDEX[^;]+party_contacts_primary_uq[^;]+\("party_id"\) WHERE "is_primary"/);
  });
});
