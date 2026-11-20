import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { shipToValues, shipToCodeKey, shipToOneLine, shipToLines } from "@/lib/customer-ship-to";
import { gs1CheckDigit } from "@/lib/gs1";

const body = "501234567890";
const GLN = body + gs1CheckDigit(body);

describe("shipToValues", () => {
  it("requires a name on create, and writes only what was sent on edit", () => {
    expect(shipToValues({ addressCity: "Cork" }, { creating: true })).toEqual({ error: expect.stringMatching(/Give the delivery address a name/) });
    expect(shipToValues({ addressCity: " Cork " }, { creating: false })).toEqual({ values: { addressCity: "Cork" } });
  });

  it("never lets an edit clear the name", () => {
    expect(shipToValues({ name: "  " }, { creating: false })).toEqual({ error: "A delivery address needs a name." });
  });

  it("validates the address the same way as a stock location", () => {
    expect(shipToValues({ name: "DC", countryCode: "UK" }, { creating: true })).toEqual({ error: expect.stringMatching(/not an ISO 3166 country code/) });
    expect(shipToValues({ name: "DC", countryCode: "gb", gln: GLN }, { creating: true }))
      .toEqual({ values: { name: "DC", countryCode: "GB", gln: GLN } });
  });

  it("keeps the customer's code, collapsing spaces, and refuses over-long or control characters", () => {
    expect(shipToValues({ name: "DC", code: " st  042 " }, { creating: true })).toEqual({ values: { name: "DC", code: "st 042" } });
    expect(shipToValues({ name: "DC", code: "x".repeat(33) }, { creating: true })).toEqual({ error: expect.stringMatching(/32 characters/) });
    expect(shipToValues({ name: "DC", code: "A\u0001" }, { creating: true })).toEqual({ error: expect.stringMatching(/control characters/) });
  });

  it("refuses an inactive default and an unknown status", () => {
    expect(shipToValues({ status: "Inactive", isDefault: true }, { creating: false })).toEqual({ error: expect.stringMatching(/inactive delivery address can't be the default/) });
    expect(shipToValues({ status: "Gone" }, { creating: false })).toEqual({ error: "Status must be Active or Inactive." });
  });
});

describe("shipToCodeKey", () => {
  it("matches a location code case-insensitively, like the upper(code) index", () => {
    expect(shipToCodeKey("st 042")).toBe(shipToCodeKey(" ST  042"));
    expect(shipToCodeKey("ST-042")).not.toBe(shipToCodeKey("ST042"));
  });
});

describe("read-back", () => {
  const r = { name: "Dublin DC", addressStreet: "1 Quay St", addressCity: "Dublin", addressPostcode: "D02", countryCode: "IE", gln: GLN };
  it("one line for pickers, printed lines for a document", () => {
    expect(shipToOneLine(r)).toBe("Dublin DC · 1 Quay St, Dublin, D02, IE");
    expect(shipToOneLine({ name: "Bare" })).toBe("Bare");
    expect(shipToLines(r)).toEqual(["1 Quay St", "Dublin D02", "IE", `GLN ${GLN}`]);
  });
});

describe("migration 0141", () => {
  const sql = readFileSync("db/migrations/0141_customer_ship_to.sql", "utf8");
  it("lets the database settle one default, one code and one GLN per customer", () => {
    expect(sql).toMatch(/UNIQUE INDEX[^;]+party_ship_to_default_uq[^;]+\("party_id"\) WHERE "is_default"/);
    expect(sql).toMatch(/UNIQUE INDEX[^;]+party_ship_to_code_uq[^;]+upper\("code"\)/);
    expect(sql).toMatch(/UNIQUE INDEX[^;]+party_ship_to_gln_uq/);
    expect(sql).toMatch(/"customer_ship_to_id" uuid REFERENCES "party_ship_to"\("id"\) ON DELETE set null/);
  });
});
