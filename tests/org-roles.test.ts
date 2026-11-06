import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import {
  roleAllows, visibleModules, isWriteMethod, canWriteShared, parseRoleInput, wouldRemoveLastAdmin, checkModulesInOrg,
} from "@/lib/roles";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

describe("roleAllows", () => {
  const role = { modules: { receivables: "edit", payables: "view" } as const };

  it("no custom role keeps today's behaviour", () => {
    expect(roleAllows(null, "accounting", "POST")).toBe(true);
  });
  it("edit allows reads and writes", () => {
    expect(roleAllows(role, "receivables", "GET")).toBe(true);
    expect(roleAllows(role, "receivables", "DELETE")).toBe(true);
  });
  it("view allows reads only", () => {
    expect(roleAllows(role, "payables", "GET")).toBe(true);
    expect(roleAllows(role, "payables", "head")).toBe(true);
    expect(roleAllows(role, "payables", "POST")).toBe(false);
    expect(roleAllows(role, "payables", "PATCH")).toBe(false);
  });
  it("a missing method is a write — fail closed", () => {
    expect(roleAllows(role, "payables", null)).toBe(false);
    expect(isWriteMethod(undefined)).toBe(true);
  });
  it("shared routes are writable only by a role that can edit something", () => {
    expect(canWriteShared(role)).toBe(true);
    expect(canWriteShared({ modules: { payables: "view" } })).toBe(false);
    expect(canWriteShared(null)).toBe(true);
  });
  it("a module not on the role is refused", () => {
    expect(roleAllows(role, "accounting", "GET")).toBe(false);
  });
});

describe("visibleModules", () => {
  it("narrows the org's modules, never widens them", () => {
    const role = { modules: { receivables: "view", manufacturing: "edit" } as const };
    expect(visibleModules(["receivables", "payables"], role)).toEqual(["receivables"]);
  });
  it("no role = every org module", () => {
    expect(visibleModules(["receivables", "payables"], null)).toEqual(["receivables", "payables"]);
  });
});

describe("parseRoleInput", () => {
  const base = { name: "Project Lead", baseRole: "company_user", modules: { receivables: "edit", payables: "none" }, peopleScope: "team" };

  it("accepts a valid role and drops 'none' entries", () => {
    const r = parseRoleInput(base);
    expect("role" in r && r.role.modules).toEqual({ receivables: "edit" });
  });
  it("refuses Admin as a base — a role screen must not mint admins", () => {
    expect(parseRoleInput({ ...base, baseRole: "company_admin" })).toHaveProperty("error");
    expect(parseRoleInput({ ...base, baseRole: "super_admin" })).toHaveProperty("error");
  });
  it("refuses a built-in role's name", () => {
    expect(parseRoleInput({ ...base, name: "admin" })).toHaveProperty("error");
  });
  it("refuses unknown modules, access levels and scopes", () => {
    expect(parseRoleInput({ ...base, modules: { nope: "edit" } })).toHaveProperty("error");
    expect(parseRoleInput({ ...base, modules: { receivables: "full" } })).toHaveProperty("error");
    expect(parseRoleInput({ ...base, peopleScope: "world" })).toHaveProperty("error");
  });
  it("refuses a timesheet-only role that claims modules", () => {
    expect(parseRoleInput({ ...base, baseRole: "employee" })).toHaveProperty("error");
    expect(parseRoleInput({ ...base, baseRole: "employee", modules: {} })).toHaveProperty("role");
  });
  it("refuses a blank name", () => {
    expect(parseRoleInput({ ...base, name: "  " })).toHaveProperty("error");
  });
});

describe("wouldRemoveLastAdmin", () => {
  it("blocks demoting or removing the only admin", () => {
    expect(wouldRemoveLastAdmin(["a"], "a", "company_user")).toBe(true);
    expect(wouldRemoveLastAdmin(["a"], "a", null)).toBe(true);
  });
  it("allows it when another admin remains, or the target is not an admin", () => {
    expect(wouldRemoveLastAdmin(["a", "b"], "a", null)).toBe(false);
    expect(wouldRemoveLastAdmin(["a"], "c", null)).toBe(false);
    expect(wouldRemoveLastAdmin(["a"], "a", "company_admin")).toBe(false);
  });
});

describe("checkModulesInOrg", () => {
  it("refuses a module the org has not bought", () => {
    expect(checkModulesInOrg({ manufacturing: "edit" }, ["receivables"])).toMatch(/manufacturing/);
    expect(checkModulesInOrg({ receivables: "view" }, ["receivables"])).toBeNull();
  });
});

describe("wiring", () => {
  it("requireOrg applies the role gate", () => {
    const api = src("lib/api.ts");
    expect(api).toMatch(/roleAllows\(custom, owner, method\)/);
    expect(api).toMatch(/APP_METHOD_HEADER/);
    expect(api).toMatch(/!owner && isWriteMethod\(method\) && !canWriteShared\(custom\)/);
    expect(api).toMatch(/customRoleId && !opts\.allowEmployee/);
  });
  it("middleware stamps the method and strips any client value on unstamped branches", () => {
    const mw = src("middleware.ts");
    expect(mw).toMatch(/headers\.set\(APP_METHOD_HEADER, req\.method\)/);
    expect((mw.match(/delete\(APP_METHOD_HEADER\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });
  it("the sidebar's module list is narrowed by the role", () => {
    expect(src("app/api/org/settings/route.ts")).toMatch(/visibleModules\(/);
  });
  it("creating a member creates their person record", () => {
    expect(src("app/api/org/users/route.ts")).toMatch(/ensurePersonRecord\(orgId!, created\.id/);
  });
  it("the team API guards the last admin on role change, deactivation and delete", () => {
    const u = src("app/api/org/users/route.ts");
    expect((u.match(/wouldRemoveLastAdmin\(/g) ?? []).length).toBe(3);
  });
  it("AI connections cannot manage roles", () => {
    expect(src("lib/mcp/policy.ts")).toMatch(/"\/api\/org\/roles"/);
  });
});
