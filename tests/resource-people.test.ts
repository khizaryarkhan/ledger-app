import { describe, it, expect } from "vitest";
import {
  normaliseLoginEmail, passwordError, designationNameKey, parseDesignation,
  normaliseDepartment, stripCostRate, MIN_PASSWORD_LENGTH,
} from "@/lib/resources/people-rules";
import { wouldCreateCycle } from "@/lib/resources/access";

describe("normaliseLoginEmail", () => {
  it("trims and lower-cases a valid address", () => {
    expect(normaliseLoginEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });
  it("rejects non-addresses and non-strings", () => {
    expect(normaliseLoginEmail("not-an-email")).toBeNull();
    expect(normaliseLoginEmail("a b@c.com")).toBeNull();
    expect(normaliseLoginEmail("")).toBeNull();
    expect(normaliseLoginEmail(undefined)).toBeNull();
    expect(normaliseLoginEmail(42)).toBeNull();
  });
});

describe("passwordError", () => {
  it("requires the minimum length", () => {
    expect(passwordError("1234567")).toMatch(String(MIN_PASSWORD_LENGTH));
    expect(passwordError("12345678")).toBeNull();
  });
  it("rejects missing and absurdly long passwords", () => {
    expect(passwordError(undefined)).not.toBeNull();
    expect(passwordError("x".repeat(129))).not.toBeNull();
  });
});

describe("designationNameKey", () => {
  it("ignores case and repeated whitespace", () => {
    expect(designationNameKey("  Team   Lead ")).toBe(designationNameKey("team lead"));
    expect(designationNameKey("Team Lead")).not.toBe(designationNameKey("Team Leader"));
  });
});

describe("parseDesignation", () => {
  it("applies defaults on create", () => {
    const r = parseDesignation({ name: " Operator " }, false);
    expect(r).toEqual({ ok: true, value: { name: "Operator", accessLevel: "self", sortOrder: 0, status: "active" } });
  });
  it("requires a name on create but not on a partial update", () => {
    expect(parseDesignation({}, false).ok).toBe(false);
    expect(parseDesignation({ accessLevel: "team" }, true)).toEqual({ ok: true, value: { accessLevel: "team" } });
  });
  it("rejects an empty name even on a partial update", () => {
    expect(parseDesignation({ name: "  " }, true).ok).toBe(false);
  });
  it("rejects an unknown access level or status", () => {
    expect(parseDesignation({ name: "X", accessLevel: "admin" }, false).ok).toBe(false);
    expect(parseDesignation({ name: "X", status: "deleted" }, false).ok).toBe(false);
  });
  it("rejects a non-integer sort order", () => {
    expect(parseDesignation({ name: "X", sortOrder: 1.5 }, false).ok).toBe(false);
    expect(parseDesignation({ name: "X", sortOrder: "3" }, false)).toMatchObject({ ok: true, value: { sortOrder: 3 } });
  });
  it("rejects an over-long name", () => {
    expect(parseDesignation({ name: "x".repeat(81) }, false).ok).toBe(false);
  });
});

describe("normaliseDepartment", () => {
  it("treats blank as none and trims", () => {
    expect(normaliseDepartment("  ").value).toBeNull();
    expect(normaliseDepartment(" Finance ").value).toBe("Finance");
    expect(normaliseDepartment(undefined).value).toBeNull();
  });
  it("flags over-long text", () => {
    expect(normaliseDepartment("x".repeat(81)).error).toBeTruthy();
  });
});

describe("stripCostRate", () => {
  const row = { id: "a", costRatePerHour: "12.00" };
  it("removes the key for non-admins", () => {
    expect("costRatePerHour" in stripCostRate(row, false)).toBe(false);
    expect(JSON.stringify(stripCostRate(row, false))).not.toContain("12.00");
  });
  it("keeps it for admins", () => {
    expect(stripCostRate(row, true)).toBe(row);
  });
});

describe("manager cycles (as enforced by the people routes)", () => {
  const nodes = [
    { id: "boss", managerId: null },
    { id: "lead", managerId: "boss" },
    { id: "dev", managerId: "lead" },
  ];
  it("refuses a manager who reports to the person, directly or indirectly", () => {
    expect(wouldCreateCycle("boss", "dev", nodes)).toBe(true);
    expect(wouldCreateCycle("lead", "dev", nodes)).toBe(true);
  });
  it("refuses self-management", () => {
    expect(wouldCreateCycle("dev", "dev", nodes)).toBe(true);
  });
  it("allows a valid move and clearing the manager", () => {
    expect(wouldCreateCycle("dev", "boss", nodes)).toBe(false);
    expect(wouldCreateCycle("dev", null, nodes)).toBe(false);
  });
});
