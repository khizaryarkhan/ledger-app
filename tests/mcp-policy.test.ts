import { describe, it, expect } from "vitest";
import {
  checkApiPath, authorizeCall, scopeForMethod, requiresConfirmation, isSensitiveRoute,
  isAccountingSystemWrite, largestArray, refusedEntity, redactText, isSensitiveKey,
} from "@/lib/mcp/policy";

describe("refused paths — reported by the first live user", () => {
  it.each([
    "/api/qbo",            // was a 307 to Intuit with a binary body
    "/api/xero", "/api/gmail", "/api/microsoft", "/api/google-sheets",
    "/api/group/receivables", // always 401: needs a group picked in the browser
    "/api/batch/download",    // returns a spreadsheet; timed out
    "/api/batch/upload/start", "/api/batch/upload/preview", "/api/batch/template", "/api/batch/debug/record",
  ])("refuses %s with a reason, not a confusing status", (p) => {
    const r = checkApiPath(p);
    expect(r.ok).toBe(false);
    expect((r as any).reason).toMatch(/not available to AI connections: /);
  });
  it("still allows the status routes it points the AI to", () => {
    for (const p of ["/api/qbo/verify", "/api/qbo/sync", "/api/xero/sync", "/api/batch/jobs", "/api/batch/entities"]) {
      expect(checkApiPath(p).ok, p).toBe(true);
    }
  });
});

describe("changes to QuickBooks/Xero", () => {
  it("are Data Studio writes and pushes, but not Data Studio searches", () => {
    expect(isAccountingSystemWrite("/api/batch/bulk-edit/apply")).toBe(true);
    expect(isAccountingSystemWrite("/api/batch/delete/commit")).toBe(true);
    expect(isAccountingSystemWrite("/api/batch/jobs/1/undo")).toBe(true);
    expect(isAccountingSystemWrite("/api/payables/purchase-orders/1/push")).toBe(true);
    expect(isAccountingSystemWrite("/api/batch/bulk-edit/search")).toBe(false);
    expect(isAccountingSystemWrite("/api/invoices")).toBe(false);
  });
  it("need their own grant — create-and-change is not enough", () => {
    const write = ["mcp:read", "mcp:write"] as const;
    expect(authorizeCall(write, "POST", "/api/batch/bulk-edit/apply").ok).toBe(false);
    expect((authorizeCall(write, "POST", "/api/batch/bulk-edit/apply") as any).reason).toMatch(/QuickBooks\/Xero/);
    expect(authorizeCall([...write, "mcp:accounting_system"], "POST", "/api/batch/bulk-edit/apply").ok).toBe(true);
  });
  it("a Data Studio search needs only write (it is a POST that reads)", () => {
    expect(authorizeCall(["mcp:read", "mcp:write"], "POST", "/api/batch/bulk-edit/search").ok).toBe(true);
  });
  it("always go through the describe-then-confirm step, like a delete", () => {
    expect(requiresConfirmation("POST", "/api/batch/bulk-edit/apply")).toBe(true);
    expect(requiresConfirmation("POST", "/api/batch/bulk-edit/search")).toBe(false);
    expect(requiresConfirmation("POST", "/api/invoices")).toBe(false);
  });
});

describe("largestArray", () => {
  it("finds the row count however the body nests it", () => {
    expect(largestArray({ ids: [1, 2, 3] })).toBe(3);
    expect(largestArray({ changes: { ids: Array(150).fill(0) } })).toBe(150);
    expect(largestArray([1, 2])).toBe(2);
    expect(largestArray({ a: 1 })).toBe(0);
    expect(largestArray(undefined)).toBe(0);
  });
  it("does not blow the argument limit on a very large array", () => {
    expect(largestArray({ ids: Array(300_000).fill(1) })).toBe(300_000);
  });
});

describe("refusedEntity", () => {
  it("refuses Data Studio employee records in the query or the body, any case", () => {
    expect(refusedEntity("/api/batch/bulk-edit/search", undefined, { entity: "employee" })).toBe("employee");
    expect(refusedEntity("/api/batch/refs", { entity: "Employee" }, undefined)).toBe("Employee");
    expect(refusedEntity("/api/batch/bulk-edit/search", undefined, { entity: "invoice" })).toBeNull();
    expect(refusedEntity("/api/resources", { entity: "employee" }, undefined)).toBeNull();
  });
});

describe("redaction", () => {
  it("recognises the names however they are written", () => {
    for (const k of ["ssn", "SSN", "Birth Date", "dateOfBirth", "DOB", "national_insurance_number", "passwordHash", "refreshToken", "IBAN", "sort-code", "apiKey"]) {
      expect(isSensitiveKey(k), k).toBe(true);
    }
    for (const k of ["name", "email", "total", "accountId", "taxRateId", "secretary"]) expect(isSensitiveKey(k), k).toBe(false);
  });
  it("redacts values anywhere in JSON and counts them, keeping the keys", () => {
    const r = redactText(JSON.stringify({ rows: [{ name: "A", SSN: "123-45-6789", "Birth Date": "1990-01-01" }], token: { refreshToken: "x" } }));
    expect(r.redacted).toBe(3);
    expect(r.text).not.toContain("123-45-6789");
    expect(r.text).not.toContain("1990-01-01");
    expect(JSON.parse(r.text).rows[0].name).toBe("A");
    expect(JSON.parse(r.text).rows[0].SSN).toBe("[redacted]");
  });
  it("leaves clean JSON byte-identical", () => {
    const s = '{"a":1,"b":[{"c":"d"}]}';
    expect(redactText(s)).toEqual({ text: s, redacted: 0 });
  });
  it("still redacts when the body is not parseable JSON", () => {
    const r = redactText('{"rows":[{"ssn":"123-45-6789","name":"A"},{"ssn": 99');
    expect(r.text).not.toContain("123-45-6789");
    expect(r.redacted).toBeGreaterThanOrEqual(1);
  });
});

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
