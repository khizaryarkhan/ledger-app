import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { buildSscc, normaliseSscc, normaliseCompanyPrefix, ssccCapacity, preparePackage, packingSummary } from "@/lib/inventory/sscc";
import { buildGs1, parseGs1, gs1CheckDigit } from "@/lib/gs1";

describe("GS1 Company Prefix", () => {
  it("is 4 to 12 digits, spaces and hyphens ignored", () => {
    expect(normaliseCompanyPrefix(" 0614-141 ")).toEqual({ ok: true, prefix: "0614141" });
    expect(normaliseCompanyPrefix("")).toEqual({ ok: true, prefix: null });
    expect(normaliseCompanyPrefix("123")).toEqual({ ok: false, error: expect.stringMatching(/4 to 12 digits/) });
    expect(normaliseCompanyPrefix("1234567890123")).toEqual({ ok: false, error: expect.stringMatching(/4 to 12 digits/) });
    expect(normaliseCompanyPrefix("06A4141")).toEqual({ ok: false, error: expect.stringMatching(/digits only/) });
  });
});

describe("buildSscc", () => {
  it("is extension + prefix + zero-padded serial + check digit, 18 digits", () => {
    const s = buildSscc(0, "0614141", 1);
    expect(s).toHaveLength(18);
    expect(s.slice(0, 17)).toBe("0" + "0614141" + "000000001");
    expect(Number(s[17])).toBe(gs1CheckDigit(s.slice(0, 17)));
  });

  it("gives every serial its own code and never wraps round", () => {
    expect(buildSscc(3, "0614141", 41)).not.toBe(buildSscc(3, "0614141", 42));
    expect(ssccCapacity("0614141")).toBe(1e9);
    expect(() => buildSscc(0, "123456789012", 10_000)).toThrow(/does not fit a 12-digit company prefix/);
    expect(() => buildSscc(10, "0614141", 1)).toThrow(/one digit, 0-9/);
  });

  it("round-trips through a GS1-128 label and the scan parser", () => {
    const s = buildSscc(1, "0614141", 123456789);
    const { data } = buildGs1({ sscc: s });
    const parsed = parseGs1(data);
    expect(parsed.elements.find(e => e.ai === "00")?.value).toBe(s);
    expect(normaliseSscc(`(00)${s}`)).toEqual({ ok: true, sscc: s });
    expect(normaliseSscc(`00${s}`)).toEqual({ ok: true, sscc: s });
  });
});

describe("normaliseSscc", () => {
  const good = buildSscc(0, "0614141", 7);
  it("accepts 18 digits with spaces", () => {
    expect(normaliseSscc(`${good.slice(0, 9)} ${good.slice(9)}`)).toEqual({ ok: true, sscc: good });
  });
  it("refuses a wrong check digit and a wrong length", () => {
    const bad = good.slice(0, 17) + ((Number(good[17]) + 1) % 10);
    expect(normaliseSscc(bad)).toEqual({ ok: false, error: expect.stringMatching(/^Check digit should be/) });
    expect(normaliseSscc("12345")).toEqual({ ok: false, error: expect.stringMatching(/18 digits/) });
  });
});

describe("preparePackage", () => {
  const lines = [
    { id: "L1", qtyBase: 10, packedQty: 4, description: "Rice 25 kg" },
    { id: "L2", qtyBase: 5, packedQty: 0, description: "Oil 5 l" },
  ];
  const parents = [{ id: "P1", parentId: null }, { id: "C1", parentId: "P1" }];

  it("accepts a carton on a pallet holding what is left", () => {
    expect(preparePackage({ packType: "Carton", parentId: "P1", grossWeightKg: "12.5", contents: [{ shipmentLineId: "L1", qtyBase: "6" }] }, lines, parents))
      .toEqual({ ok: true, pkg: { packType: "carton", parentId: "P1", grossWeightKg: "12.500", contents: [{ shipmentLineId: "L1", qtyBase: 6 }] } });
  });

  it("allows an empty pallet, to put cartons on", () => {
    expect(preparePackage({ packType: "pallet" }, lines, parents)).toEqual({ ok: true, pkg: expect.objectContaining({ packType: "pallet", contents: [] }) });
  });

  it("never packs more of a line than is left unpacked", () => {
    expect(preparePackage({ packType: "carton", contents: [{ shipmentLineId: "L1", qtyBase: 4 }, { shipmentLineId: "L1", qtyBase: 3 }] }, lines, parents))
      .toEqual({ ok: false, error: expect.stringMatching(/Rice 25 kg: 7 would be packed but only 6/) });
  });

  it("refuses a line of another shipment, an unknown pack type and a second level of nesting", () => {
    expect(preparePackage({ packType: "carton", contents: [{ shipmentLineId: "X", qtyBase: 1 }] }, lines, parents)).toEqual({ ok: false, error: expect.stringMatching(/only hold lines of this shipment/) });
    expect(preparePackage({ packType: "crate-ish" }, lines, parents)).toEqual({ ok: false, error: expect.stringMatching(/Choose what this package is/) });
    expect(preparePackage({ packType: "box", parentId: "C1" }, lines, parents)).toEqual({ ok: false, error: expect.stringMatching(/one level only/) });
    expect(preparePackage({ packType: "box", parentId: "elsewhere" }, lines, parents)).toEqual({ ok: false, error: expect.stringMatching(/not on this shipment/) });
  });
});

describe("packingSummary", () => {
  it("is fully packed only when every line is", () => {
    const lines = [{ id: "L1", qtyBase: 10 }, { id: "L2", qtyBase: 2 }];
    expect(packingSummary(lines, [{ shipmentLineId: "L1", qtyBase: 10 }]).fullyPacked).toBe(false);
    expect(packingSummary(lines, [{ shipmentLineId: "L1", qtyBase: 10 }, { shipmentLineId: "L2", qtyBase: 2 }]).fullyPacked).toBe(true);
  });
});

describe("migration 0143", () => {
  const sql = readFileSync("db/migrations/0143_sscc_packages.sql", "utf8");
  it("keeps an SSCC unique per org and the counter on the org", () => {
    expect(sql).toMatch(/UNIQUE INDEX[^;]+shipment_packages_sscc_uq[^;]+\("org_id", "sscc"\)/);
    expect(sql).toMatch(/"sscc_next_serial" bigint DEFAULT 1 NOT NULL/);
  });
});
