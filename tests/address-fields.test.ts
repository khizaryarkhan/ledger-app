import { describe, it, expect } from "vitest";
import { addressValues, isAddressComplete, resolveCountryCode } from "@/lib/address-fields";
import { gs1CheckDigit } from "@/lib/gs1";

const body = "501234567890";
const GLN = body + gs1CheckDigit(body);

describe("addressValues", () => {
  it("writes only the fields the request mentions, so an edit leaves the rest alone", () => {
    const r = addressValues({ addressCity: " Dublin " });
    expect(r).toEqual({ values: { addressCity: "Dublin" } });
  });

  it("clears a field sent empty or null", () => {
    expect(addressValues({ addressStreet: "", addressLine2: null, countryCode: "", gln: "" }))
      .toEqual({ values: { addressStreet: null, addressLine2: null, countryCode: null, gln: null } });
  });

  it("stores the country code in canonical form and the GLN as digits", () => {
    expect(addressValues({ countryCode: "ie", gln: `${GLN.slice(0, 4)} ${GLN.slice(4)}` }))
      .toEqual({ values: { countryCode: "IE", gln: GLN } });
  });

  it("refuses a country that is not ISO, a bad GLN, or an over-long field", () => {
    expect(addressValues({ countryCode: "UK" })).toEqual({ error: expect.stringMatching(/not an ISO 3166 country code/) });
    expect(addressValues({ gln: GLN.slice(0, 12) + ((Number(GLN[12]) + 1) % 10) }))
      .toEqual({ error: expect.stringMatching(/^GLN: Check digit should be/) });
    expect(addressValues({ addressPostcode: "x".repeat(33) })).toEqual({ error: "Postal code must be 32 characters or fewer." });
  });

  it("calls an address complete only with street, city and country code", () => {
    expect(isAddressComplete({ addressStreet: "1 Main St", addressCity: "Cork", countryCode: "IE" })).toBe(true);
    expect(isAddressComplete({ addressStreet: "1 Main St", addressCity: "Cork" })).toBe(false);
  });
});

describe("resolveCountryCode", () => {
  it("prefers an explicit code, then the org-list code, then the name", () => {
    expect(resolveCountryCode({ explicit: "gb", fromList: "IE", name: "France" })).toBe("GB");
    expect(resolveCountryCode({ explicit: "", fromList: "IE", name: "France" })).toBe("IE");
    expect(resolveCountryCode({ explicit: null, fromList: null, name: "France" })).toBe("FR");
  });

  it("gives no code rather than a guess when nothing matches", () => {
    expect(resolveCountryCode({ name: "Atlantis" })).toBeNull();
    expect(resolveCountryCode({})).toBeNull();
  });
});
