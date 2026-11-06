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
    const t = lib.startImpersonation({ ...ADMIN }, ticket(), TARGET, NOW);
    expect(t).toMatchObject({ id: "user-9", role: "employee", orgId: "org-1", name: "Jack K." });
    expect(t.imp.original).toMatchObject({ id: "admin-1", role: "super_admin" });
    expect(t.imp.until).toBe(NOW + lib.IMPERSONATION_MINUTES * 60_000);
  });
  it("refuses a non-super-admin, even with a valid ticket", () => {
    const t = lib.startImpersonation({ ...ADMIN, role: "company_admin" }, ticket(), TARGET, NOW);
    expect(t.id).toBe("admin-1");
    expect(t.imp).toBeUndefined();
  });
  it("refuses a ticket minted for a different admin", () => {
    expect(lib.startImpersonation({ ...ADMIN, id: "admin-2" }, ticket(), TARGET, NOW).id).toBe("admin-2");
  });
  it("refuses a target that is not the one on the ticket", () => {
    expect(lib.startImpersonation({ ...ADMIN }, ticket(), { ...TARGET, id: "user-other" }, NOW).id).toBe("admin-1");
  });
  it("refuses to chain while already impersonating (the original is never overwritten)", () => {
    const once = lib.startImpersonation({ ...ADMIN }, ticket(), TARGET, NOW);
    const forged = { ...once, role: "super_admin" };
    const twice = lib.startImpersonation(forged, ticket(), { ...TARGET, id: "user-9" }, NOW);
    expect(twice).toBe(forged);
    expect(twice.imp.original.id).toBe("admin-1");
  });
  it("refuses a missing ticket or target", () => {
    expect(lib.startImpersonation({ ...ADMIN }, null, TARGET, NOW).id).toBe("admin-1");
    expect(lib.startImpersonation({ ...ADMIN }, ticket(), null, NOW).id).toBe("admin-1");
  });
});

describe("stopping", () => {
  const on = () => lib.startImpersonation({ ...ADMIN }, lib.verifyTicket(lib.mintTicket("admin-1", "user-9", "org-1", NOW), NOW), TARGET, NOW);
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
    expect(src("middleware.ts")).toMatch(/impersonating && !path\.startsWith\("\/api\/auth\/"\) && !\["GET", "HEAD", "OPTIONS"\]\.includes\(req\.method\)/);
  });
  it("only a DB-revalidated super admin can mint a ticket, never for a platform admin", () => {
    const r = src("app/api/admin/impersonate/route.ts");
    expect(r).toMatch(/requireSuperAdmin\(\)/);
    expect(r).toMatch(/globalRole === "super_admin" \|\| target\.globalRole === "platform_admin"/);
    expect(r).toMatch(/impersonation_started/);
  });
  it("the jwt callback starts only from a verified ticket and a re-checked target", () => {
    const a = src("lib/auth.ts");
    expect(a).toMatch(/verifyTicket\(\(session as any\)\.impersonationTicket\)/);
    expect(a).toMatch(/impersonationTarget\(ticket\.as, ticket\.orgId\)/);
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
    expect(src("app/api/admin/impersonate/route.ts")).toMatch(/if \(!sameOrigin\(req\)\)/);
    expect(src("lib/auth.ts")).toMatch(/withCurrentRole\(stopImpersonation/);
  });
});
