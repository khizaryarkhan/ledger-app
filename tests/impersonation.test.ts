import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

let lib: typeof import("@/lib/impersonation");
beforeAll(async () => {
  process.env.AUTH_SECRET = process.env.AUTH_SECRET || "test-secret-for-impersonation";
  lib = await import("@/lib/impersonation");
});

const ADMIN = { id: "admin-1", role: "super_admin", orgId: "org-home", repId: null, name: "Ada Admin", email: "ada@x.test" };
const TARGET = { id: "user-9", role: "employee", orgId: "org-1", repId: null, name: "Jack K.", email: "jack@x.test" };
const NOW = 1_800_000_000_000;

describe("tickets", () => {
  it("verify what was minted, for two minutes only", () => {
    const t = lib.mintTicket("admin-1", "user-9", "org-1", NOW);
    expect(lib.verifyTicket(t, NOW)).toMatchObject({ by: "admin-1", as: "user-9", orgId: "org-1" });
    expect(lib.verifyTicket(t, NOW + 3 * 60_000)).toBeNull();
  });
  it("refuse a tampered or forged ticket", () => {
    const [payload, sig] = lib.mintTicket("admin-1", "user-9", "org-1", NOW).split(".");
    const forged = Buffer.from(JSON.stringify({ by: "admin-1", as: "someone-else", orgId: "org-1", exp: NOW + 60_000 })).toString("base64url");
    expect(lib.verifyTicket(`${forged}.${sig}`, NOW)).toBeNull();
    expect(lib.verifyTicket(`${payload}.AAAA`, NOW)).toBeNull();
    expect(lib.verifyTicket("garbage", NOW)).toBeNull();
    expect(lib.verifyTicket({ by: "x" } as any, NOW)).toBeNull();
  });
});

describe("starting", () => {
  const ticket = () => lib.verifyTicket(lib.mintTicket("admin-1", "user-9", "org-1", NOW), NOW);

  it("becomes the target and keeps the original inside the token", () => {
    const t = lib.startImpersonation({ ...ADMIN }, ticket(), TARGET, true, NOW);
    expect(t).toMatchObject({ id: "user-9", role: "employee", orgId: "org-1", name: "Jack K." });
    expect(t.imp.original).toMatchObject({ id: "admin-1", role: "super_admin" });
    expect(t.imp.until).toBe(NOW + lib.IMPERSONATION_MINUTES * 60_000);
  });
  it("refuses when the actor is not allowed (roles re-read from the DB), even with a valid ticket", () => {
    const t = lib.startImpersonation({ ...ADMIN }, ticket(), TARGET, false, NOW);
    expect(t.id).toBe("admin-1");
    expect(t.imp).toBeUndefined();
  });
  it("refuses a ticket minted for a different admin", () => {
    expect(lib.startImpersonation({ ...ADMIN, id: "admin-2" }, ticket(), TARGET, true, NOW).id).toBe("admin-2");
  });
  it("refuses a target that is not the one on the ticket", () => {
    expect(lib.startImpersonation({ ...ADMIN }, ticket(), { ...TARGET, id: "user-other" }, true, NOW).id).toBe("admin-1");
  });
  it("refuses to chain while already impersonating (the original is never overwritten)", () => {
    const once = lib.startImpersonation({ ...ADMIN }, ticket(), TARGET, true, NOW);
    const forged = { ...once, role: "super_admin" };
    const twice = lib.startImpersonation(forged, ticket(), { ...TARGET, id: "user-9" }, true, NOW);
    expect(twice).toBe(forged);
    expect(twice.imp.original.id).toBe("admin-1");
  });
  it("refuses a missing ticket or target", () => {
    expect(lib.startImpersonation({ ...ADMIN }, null, TARGET, true, NOW).id).toBe("admin-1");
    expect(lib.startImpersonation({ ...ADMIN }, ticket(), null, true, NOW).id).toBe("admin-1");
  });
});

describe("stopping", () => {
  const on = () => lib.startImpersonation({ ...ADMIN }, lib.verifyTicket(lib.mintTicket("admin-1", "user-9", "org-1", NOW), NOW), TARGET, true, NOW);
  it("returns exactly to the original identity", () => {
    const off = lib.stopImpersonation(on());
    expect(off).toMatchObject(ADMIN);
    expect(off.imp).toBeUndefined();
  });
  it("ends by itself after the hour", () => {
    expect(lib.isExpired(on(), NOW + 59 * 60_000)).toBe(false);
    expect(lib.isExpired(on(), NOW + 61 * 60_000)).toBe(true);
  });
  it("is a no-op when not impersonating", () => {
    expect(lib.stopImpersonation({ ...ADMIN })).toMatchObject(ADMIN);
  });
});

describe("wiring", () => {
  it("middleware makes every non-read request read-only while impersonating, except NextAuth's own", () => {
    const mw = src("middleware.ts");
    // Only NextAuth's own endpoints, not every /api/auth/* (switch-org is a custom POST).
    expect(mw).toMatch(/const nextAuthOwn = path === "\/api\/auth\/session" \|\| path === "\/api\/auth\/signout" \|\| path === "\/api\/auth\/csrf";/);
    expect(mw).toMatch(/impersonating && !nextAuthOwn && !\["GET", "HEAD", "OPTIONS"\]\.includes\(req\.method\)/);
    expect(mw).not.toMatch(/impersonating && !path\.startsWith\("\/api\/auth\/"\)/);
  });
  it("an impersonated session is pinned to the ticket's organisation and cannot switch", () => {
    const api = src("lib/api.ts");
    expect(api).toMatch(/if \(impersonating\) activeOrgCookie = /);
    expect(api).toMatch(/!orgId && userRow\.orgId && !impersonating/);
    expect(src("app/api/auth/switch-org/route.ts")).toMatch(/impersonatedBy/);
  });
  it("tickets are minted only for an admin, in their own active org, never for a platform admin", () => {
    const r = src("app/api/org/impersonate/route.ts");
    expect(r).toMatch(/requireOrg\(\)/);
    expect(r).toMatch(/mayImpersonate\(/);
    expect(r).not.toMatch(/body\?\.orgId/);
    expect(r).toMatch(/globalRole === "super_admin" \|\| target\.globalRole === "platform_admin"/);
    expect(r).toMatch(/impersonation_started/);
  });
  it("the jwt callback starts only from a verified ticket and a re-checked target", () => {
    const a = src("lib/auth.ts");
    expect(a).toMatch(/verifyTicket\(\(session as any\)\.impersonationTicket\)/);
    expect(a).toMatch(/impersonationTarget\(ticket\.as, ticket\.orgId\)/);
    expect(a).toMatch(/mayImpersonate\(actor, target\?\.role/);
  });
  it("the edge config restores an expired session too", () => {
    expect(src("auth.config.ts")).toMatch(/imp\.until < Date\.now\(\)/);
  });
  it("the read-only check runs BEFORE the public/cron early returns (the MCP consent route is 'public')", () => {
    const mw = src("middleware.ts");
    expect(mw.indexOf("const impersonating")).toBeGreaterThan(-1);
    expect(mw.indexOf("const impersonating")).toBeLessThan(mw.indexOf("if (isCron) return"));
    expect(mw.indexOf("const impersonating")).toBeLessThan(mw.indexOf("if (isPublic)"));
  });
  it("requireOrg is a second wall, failing closed", () => {
    expect(src("lib/api.ts")).toMatch(/impersonatedBy\) \{[\s\S]{0,300}isWriteMethod\(m\)/);
  });
  it("an impersonated session can never grant an AI client access or change AI switches", () => {
    expect(src("app/api/mcp/oauth/approve/route.ts")).toMatch(/impersonatedBy\) return/);
    expect(src("app/api/mcp/settings/route.ts")).toMatch(/impersonatedBy\) return/);
  });
  it("starting needs a same-origin request; stopping re-reads the admin's role", () => {
    expect(src("app/api/org/impersonate/route.ts")).toMatch(/if \(!sameOrigin\(req\)\)/);
    expect(src("lib/auth.ts")).toMatch(/withCurrentRole\(stopImpersonation/);
  });
});

describe("who may sign in as whom", () => {
  it("a super admin may sign in as anyone who is not a platform admin", () => {
    expect(lib.mayImpersonate({ globalRole: "super_admin", orgRole: null }, "company_admin")).toBe(true);
    expect(lib.mayImpersonate({ globalRole: "super_admin", orgRole: null }, "employee")).toBe(true);
  });
  it("a company admin may sign in as non-admins in their own org only", () => {
    expect(lib.mayImpersonate({ globalRole: "company_admin", orgRole: "company_admin" }, "employee")).toBe(true);
    expect(lib.mayImpersonate({ globalRole: "company_admin", orgRole: "company_admin" }, "company_user")).toBe(true);
    expect(lib.mayImpersonate({ globalRole: "company_admin", orgRole: "company_admin" }, "company_admin")).toBe(false);
    expect(lib.mayImpersonate({ globalRole: "company_admin", orgRole: "company_admin" }, "super_admin")).toBe(false);
  });
  it("an admin of ANOTHER org, or anyone else, may not", () => {
    expect(lib.mayImpersonate({ globalRole: "company_admin", orgRole: null }, "employee")).toBe(false);
    expect(lib.mayImpersonate({ globalRole: "company_user", orgRole: "company_user" }, "employee")).toBe(false);
    expect(lib.mayImpersonate(null, "employee")).toBe(false);
  });
});
