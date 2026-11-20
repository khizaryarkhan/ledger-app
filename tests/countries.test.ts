import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { COUNTRIES, countryByCode, normaliseCountryCode, countryCodeError, countryCodeFromName } from "@/lib/countries";
import { normaliseGln, glnError, gs1CheckDigit } from "@/lib/gs1";

// The published ISO 3166-1 alpha-2 list (datahub "country-list" dataset), as fetched.
const ISO = readFileSync(join(__dirname, "fixtures", "iso-3166-1.txt"), "utf8")
  .trim().split(/\r?\n/).map(l => { const [code, name] = l.split("|"); return { code, name }; });

describe("country list", () => {
  it("is exactly ISO 3166-1: 249 codes, none missing, none extra, none repeated", () => {
    expect(ISO).toHaveLength(249);
    const ours = COUNTRIES.map(c => c.code);
    expect(new Set(ours).size).toBe(ours.length);
    expect([...ours].sort()).toEqual(ISO.map(r => r.code).sort());
  });

  it("holds no code that is not ISO 3166-1 (Kosovo, the EU and 'UK' are not)", () => {
    for (const c of ["XK", "EU", "UK", "EL"]) expect(countryByCode(c), c).toBeUndefined();
  });
});

describe("country codes", () => {
  it("normalises a code and refuses anything that is not ISO", () => {
    expect(normaliseCountryCode(" gb ")).toBe("GB");
    expect(normaliseCountryCode("UK")).toBeNull();
    expect(countryCodeError("", "Country")).toBeNull();
    expect(countryCodeError("ie")).toBeNull();
    expect(countryCodeError("XX", "Ship-to country")).toMatch(/^Ship-to country "XX" is not an ISO 3166 country code/);
  });

  it("maps every ISO short name and every one of our names to its own code", () => {
    for (const r of ISO) expect(countryCodeFromName(r.name), r.name).toBe(r.code);
    for (const c of COUNTRIES) expect(countryCodeFromName(c.name), c.name).toBe(c.code);
  });

  it("maps the common alternatives people type", () => {
    expect(countryCodeFromName("UK")).toBe("GB");
    expect(countryCodeFromName("England")).toBe("GB");
    expect(countryCodeFromName("USA")).toBe("US");
    expect(countryCodeFromName("united states of america")).toBe("US");
    expect(countryCodeFromName("Viet Nam")).toBe("VN");
    expect(countryCodeFromName("Cote d'Ivoire")).toBe("CI");
    expect(countryCodeFromName("Holland")).toBe("NL");
  });

  it("gives NO code to a name it does not know, rather than a nearest match", () => {
    expect(countryCodeFromName("Atlantis")).toBeNull();
    expect(countryCodeFromName("Korea")).toBeNull();   // North or South: ambiguous
    expect(countryCodeFromName("")).toBeNull();
    expect(countryCodeFromName(null)).toBeNull();
  });
});

describe("GLN", () => {
  const body = "501234567890";
  const valid = body + gs1CheckDigit(body);

  it("accepts a 13-digit number with the right check digit", () => {
    expect(normaliseGln(valid)).toEqual({ ok: true, gln: valid });
    expect(normaliseGln(`${valid.slice(0, 4)} ${valid.slice(4)}`)).toEqual({ ok: true, gln: valid });
    expect(glnError("")).toBeNull();
    expect(glnError(valid)).toBeNull();
  });

  it("refuses a wrong check digit, the wrong length, or letters", () => {
    const wrong = body + ((gs1CheckDigit(body) + 1) % 10);
    expect(glnError(wrong)).toMatch(/Check digit should be/);
    expect(glnError(valid.slice(1))).toMatch(/13 digits/);
    expect(glnError("50123456789AB")).toMatch(/digits only/);
  });
});
