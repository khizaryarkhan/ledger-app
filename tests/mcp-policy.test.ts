import { describe, it, expect } from "vitest";
import { checkApiPath, authorizeCall, scopeForMethod, requiresConfirmation, isSensitiveRoute } from "@/lib/mcp/policy";

describe("checkApiPath — what may be reached", () => {
  it.each([
    "/api/invoices",
    "/api/invoices/abc-123",
    "/api/accounting/reports",
    "/api/batch/jobs",
    "/api/qbo/sync",
  ])("allows %s", (p) => expect(checkApiPath(p).ok).toBe(true));

  it("strips one trailing slash", () => {
    const r = checkApiPath("/api/invoices/");
    expect(r.ok && r.path).toBe("/api/invoices");
  });

  it.each([
    "/api/admin/customers",
    "/api/auth/mfa",
    "/api/mobile/auth/login",
    "/api/mcp",
    "/api/mcp/oauth/token",
    "/api/billing/checkout",
    "/api/cron/trigger",
    "/api/webhooks/stripe",
    "/api/inngest",
    "/api/org/smtp",
    "/api/org/users",
    "/api/org/users/reset-password",
    "/api/user/orgs",
    "/api/backfill-paid-at",
    "/api/backfill",
  ])("blocks %s", (p) => expect(checkApiPath(p).ok).toBe(false));

  it("blocks credential/hand-shake segments anywhere in the tree", () => {
    for (const p of ["/api/qbo/callback", "/api/xero/disconnect", "/api/google-sheets/connect", "/api/gmail/callback", "/api/x/webhook/y"]) {
      expect(checkApiPath(p).ok, p).toBe(false);
    }
  });

  it("is case-insensitive about the deny-list", () => {
    expect(checkApiPath("/api/ADMIN/customers").ok).toBe(false);
    expect(checkApiPath("/api/Billing/checkout").ok).toBe(false);
  });
});

describe("checkApiPath — path-escape attempts are refused, not cleaned", () => {
  it.each([
    "/api/../admin/x",
    "/api/invoices/../admin/x",
    "/api/./invoices",
    "/api/%2e%2e/admin/x",
    "/api/%2E%2E/admin/x",
    "/api/invoices/%2e%2e/%2e%2e/admin",
    "/api//evil.example/x",
    "/api/invoices?x=1",
    "/api/invoices#frag",
    "/api/invoices%3Fx=1",
    "/api/invoices%23frag",
    "/api/in voices",
    "/api/invoices\\..\\admin",
    "/api/invoices%5C..%5Cadmin",
    "http://evil.example/api/x",
    "//evil.example/api/x",
    "/apix/invoices",
    "api/invoices",
    "/api/admin%2Fcustomers",       // encoded slash must not smuggle a blocked prefix
    "/api/%61dmin/customers",       // %61 = "a": decoded path is /api/admin/…
    "/api/%69nventory/items",       // an encoded letter would dodge module gating, which matches the raw path
    "/api/invoices/%41",            // no percent-encoding at all
    "",
  ])("rejects %j", (p) => expect(checkApiPath(p).ok).toBe(false));

  it("rejects non-strings and oversize paths", () => {
    expect(checkApiPath(undefined).ok).toBe(false);
    expect(checkApiPath({}).ok).toBe(false);
    expect(checkApiPath("/api/" + "a".repeat(600)).ok).toBe(false);
  });
});

describe("isSensitiveRoute", () => {
  it.each([
    "/api/email/send", "/api/email-templates", "/api/gmail/send", "/api/invoices/bulk-send", "/api/board/notify-owners",
    "/api/org/email-settings", "/api/org/settings", "/api/resources/abc/login", "/api/chat",
    "/api/payables/bills/1/send-for-approval", "/api/trade-documents/purchase-orders/send",
  ])("flags %s", (p) => expect(isSensitiveRoute(p)).toBe(true));
  it.each(["/api/invoices", "/api/customers/1", "/api/accounting/reports", "/api/batch/jobs", "/api/qbo/sync", "/api/notifications"])(
    "does not flag %s", (p) => expect(isSensitiveRoute(p)).toBe(false));
});

describe("method → scope", () => {
  it("maps reads, writes and deletes", () => {
    expect(scopeForMethod("GET")).toBe("mcp:read");
    expect(scopeForMethod("POST")).toBe("mcp:write");
    expect(scopeForMethod("PUT")).toBe("mcp:write");
    expect(scopeForMethod("PATCH")).toBe("mcp:write");
    expect(scopeForMethod("DELETE")).toBe("mcp:delete");
  });
  it("only deletes need explicit confirmation", () => {
    expect(requiresConfirmation("DELETE")).toBe(true);
    expect(requiresConfirmation("POST")).toBe(false);
    expect(requiresConfirmation("GET")).toBe(false);
  });
});

describe("authorizeCall", () => {
  const readOnly = ["mcp:read"] as const;
  const full = ["mcp:read", "mcp:write", "mcp:delete"] as const;

  it("allows a read with the read scope", () => {
    const d = authorizeCall(readOnly, "get", "/api/invoices");
    expect(d.ok).toBe(true);
    expect(d.ok && d.method).toBe("GET");
  });
  it("refuses a write or delete when the user only granted read", () => {
    const w = authorizeCall(readOnly, "POST", "/api/invoices");
    const x = authorizeCall(readOnly, "DELETE", "/api/invoices/1");
    expect(w.ok).toBe(false);
    expect(x.ok).toBe(false);
    expect((w as any).reason).toMatch(/write/);
    expect((x as any).reason).toMatch(/delete/);
  });
  it("write does not imply delete", () => {
    expect(authorizeCall(["mcp:read", "mcp:write"], "DELETE", "/api/invoices/1").ok).toBe(false);
  });
  it("delete does not imply write", () => {
    expect(authorizeCall(["mcp:read", "mcp:delete"], "PATCH", "/api/invoices/1").ok).toBe(false);
  });
  it("a fully-scoped connection still cannot reach a blocked route", () => {
    expect(authorizeCall(full, "GET", "/api/admin/customers").ok).toBe(false);
    expect(authorizeCall(full, "DELETE", "/api/org/users").ok).toBe(false);
  });
  it("refuses unknown methods", () => {
    expect(authorizeCall(full, "TRACE", "/api/invoices").ok).toBe(false);
    expect(authorizeCall(full, undefined, "/api/invoices").ok).toBe(false);
  });
});
