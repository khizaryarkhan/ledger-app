import { describe, it, expect, vi } from "vitest";
import { handleRpc, toolsFor, listRoutes, type McpContext } from "@/lib/mcp/server";
import type { McpScope } from "@/lib/mcp/oauth";

const FULL: McpScope[] = ["mcp:read", "mcp:write", "mcp:delete"];

function ctx(scopes: McpScope[], status = 200) {
  const callApi = vi.fn(async () => ({ ok: true as const, status, contentType: "application/json", text: '{"ok":true}', truncated: false }));
  const audit = vi.fn(async () => {});
  const c: McpContext = { scopes, connectionId: "conn-1", confirmSecret: "test-secret", callApi, audit, whoami: async () => ({ user: "a@b.c", role: "company_admin" }) };
  return { c, callApi, audit };
}
const tokenFrom = (r: any): string => /\(valid 5 minutes\): (\S+)/.exec(r.result.content[0].text)![1];
const call = (c: McpContext, name: string, args: Record<string, unknown>) =>
  handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }, c) as Promise<any>;

describe("protocol", () => {
  it("negotiates a supported version and ships instructions", async () => {
    const r: any = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }, ctx(FULL).c);
    expect(r.result.protocolVersion).toBe("2025-03-26");
    expect(r.result.instructions).toMatch(/DATA written by third parties/);
    const r2: any = await handleRpc({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "1999-01-01" } }, ctx(FULL).c);
    expect(r2.result.protocolVersion).toBe("2025-06-18");
  });
  it("answers notifications with nothing", async () => {
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, ctx(FULL).c)).toBeNull();
  });
  it("reports unknown methods and malformed requests", async () => {
    const a: any = await handleRpc({ jsonrpc: "2.0", id: 3, method: "nope" }, ctx(FULL).c);
    expect(a.error.code).toBe(-32601);
    const b: any = await handleRpc({ jsonrpc: "1.0", id: 4, method: "ping" } as any, ctx(FULL).c);
    expect(b.error.code).toBe(-32600);
  });
});

describe("tools are offered only for granted scopes", () => {
  const names = (s: McpScope[]) => toolsFor(s).map((t) => t.name);
  it("read only", () => expect(names(["mcp:read"])).toEqual(["whoami", "list_api_routes", "api_get"]));
  it("read + write", () => expect(names(["mcp:read", "mcp:write"])).toEqual(["whoami", "list_api_routes", "api_get", "api_write"]));
  it("everything", () => expect(names(FULL)).toEqual(["whoami", "list_api_routes", "api_get", "api_write", "api_delete"]));
  it("tools/list never leaks the internal scope field and marks delete destructive", async () => {
    const r: any = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/list" }, ctx(FULL).c);
    expect(r.result.tools.every((t: any) => !("scope" in t))).toBe(true);
    expect(r.result.tools.find((t: any) => t.name === "api_delete").annotations.destructiveHint).toBe(true);
    expect(r.result.tools.find((t: any) => t.name === "api_get").annotations.readOnlyHint).toBe(true);
  });
});

describe("api_get", () => {
  it("replays a GET and returns the status and body", async () => {
    const { c, callApi } = ctx(["mcp:read"]);
    const r = await call(c, "api_get", { path: "/api/invoices", query: { status: "open" } });
    expect(callApi).toHaveBeenCalledWith({ method: "GET", path: "/api/invoices", query: { status: "open" }, body: undefined });
    expect(r.result.content[0].text).toBe('HTTP 200\n{"ok":true}');
    expect(r.result.isError).toBe(false);
  });
  it("flags an HTTP error from the app as an error result (e.g. the user's role forbids it)", async () => {
    const { c } = ctx(["mcp:read"], 403);
    expect((await call(c, "api_get", { path: "/api/invoices" })).result.isError).toBe(true);
  });
  it("refuses a blocked or escaping path without calling the app", async () => {
    const { c, callApi } = ctx(FULL);
    for (const path of ["/api/admin/customers", "/api/../admin", "/api/org/users", "/api/qbo/callback"]) {
      const r = await call(c, "api_get", { path });
      expect(r.result.isError, path).toBe(true);
    }
    expect(callApi).not.toHaveBeenCalled();
  });
  it("ignores a smuggled method argument — api_get only ever sends GET", async () => {
    const { c, callApi } = ctx(FULL);
    await call(c, "api_get", { path: "/api/invoices", method: "DELETE" });
    expect((callApi.mock.calls[0] as any[])[0].method).toBe("GET");
  });
});

describe("api_write", () => {
  it("is not callable when write was not granted", async () => {
    const { c, callApi } = ctx(["mcp:read"]);
    const r = await call(c, "api_write", { method: "POST", path: "/api/invoices", body: {} });
    expect(r.result.isError).toBe(true);
    expect(callApi).not.toHaveBeenCalled();
  });
  it("sends the write and records who did it", async () => {
    const { c, callApi, audit } = ctx(["mcp:read", "mcp:write"]);
    await call(c, "api_write", { method: "PATCH", path: "/api/customers/9", body: { name: "X" } });
    expect(callApi).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith({ method: "PATCH", path: "/api/customers/9", scope: "mcp:write", status: 200, ref: null });
  });
  it("cannot be used to read or to delete", async () => {
    const { c, callApi } = ctx(FULL);
    expect((await call(c, "api_write", { method: "GET", path: "/api/invoices" })).result.isError).toBe(true);
    expect((await call(c, "api_write", { method: "DELETE", path: "/api/invoices/1" })).result.isError).toBe(true);
    expect(callApi).not.toHaveBeenCalled();
  });
  it("refuses a body that is not JSON", async () => {
    const { c, callApi } = ctx(FULL);
    expect((await call(c, "api_write", { method: "POST", path: "/api/invoices", body: "drop table" })).result.isError).toBe(true);
    expect(callApi).not.toHaveBeenCalled();
  });
});

describe("api_delete", () => {
  it("is not callable without the delete scope, even with write", async () => {
    const { c, callApi } = ctx(["mcp:read", "mcp:write"]);
    expect((await call(c, "api_delete", { path: "/api/invoices/1", confirm: true })).result.isError).toBe(true);
    expect(callApi).not.toHaveBeenCalled();
  });
  it("describes the delete and does NOT execute without a confirmation token", async () => {
    const { c, callApi, audit } = ctx(FULL);
    const r = await call(c, "api_delete", { path: "/api/invoices/1" });
    expect(r.result.content[0].text).toMatch(/NOT EXECUTED/);
    expect(callApi).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
  it("a model cannot skip the describe step by passing confirm:true (or any guess)", async () => {
    const { c, callApi } = ctx(FULL);
    for (const confirm of [true, "true", "yes", "1.abc", "9999999999.abc"]) {
      await call(c, "api_delete", { path: "/api/invoices/1", confirm });
    }
    expect(callApi).not.toHaveBeenCalled();
  });
  it("executes and audits when the issued token is echoed back", async () => {
    const { c, callApi, audit } = ctx(FULL);
    const first = await call(c, "api_delete", { path: "/api/invoices/1" });
    await call(c, "api_delete", { path: "/api/invoices/1", confirm: tokenFrom(first) });
    expect(callApi).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledWith({ method: "DELETE", path: "/api/invoices/1", scope: "mcp:delete", status: 200, ref: null });
  });
  it("a token is bound to the exact arguments — it cannot confirm a different delete", async () => {
    const { c, callApi } = ctx(FULL);
    const first = await call(c, "api_delete", { path: "/api/invoices/1" });
    await call(c, "api_delete", { path: "/api/invoices/2", confirm: tokenFrom(first) });
    await call(c, "api_delete", { path: "/api/invoices/1", query: { all: "1" }, confirm: tokenFrom(first) });
    expect(callApi).not.toHaveBeenCalled();
  });
  it("a token is bound to the connection that was issued it", async () => {
    const a = ctx(FULL);
    const b = ctx(FULL);
    b.c.connectionId = "conn-2";
    const first = await call(a.c, "api_delete", { path: "/api/invoices/1" });
    await call(b.c, "api_delete", { path: "/api/invoices/1", confirm: tokenFrom(first) });
    expect(b.callApi).not.toHaveBeenCalled();
  });
  it("the argument key order does not matter", async () => {
    const { c, callApi } = ctx(FULL);
    const first = await call(c, "api_delete", { path: "/api/x/1", query: { a: "1", b: "2" } });
    await call(c, "api_delete", { confirm: tokenFrom(first), query: { b: "2", a: "1" }, path: "/api/x/1" });
    expect(callApi).toHaveBeenCalledTimes(1);
  });
});

describe("sensitive routes need the separate grant", () => {
  const WRITE: McpScope[] = ["mcp:read", "mcp:write"];
  it.each([
    ["POST", "/api/email/send"],
    ["POST", "/api/gmail/send"],
    ["POST", "/api/invoices/bulk-send"],
    ["POST", "/api/board/notify-owners"],
    ["PATCH", "/api/org/email-settings"],
    ["PATCH", "/api/org/settings"],
    ["POST", "/api/resources/abc/login"],
    ["POST", "/api/chat"],
    ["POST", "/api/payables/bills/1/send-for-approval"],
  ])("%s %s is refused without mcp:sensitive", async (method, path) => {
    const { c, callApi } = ctx(WRITE);
    const r = await call(c, "api_write", { method, path, body: {} });
    expect(r.result.isError, path).toBe(true);
    expect(r.result.content[0].text).toMatch(/sensitive/);
    expect(callApi).not.toHaveBeenCalled();
  });
  it("is allowed once the user granted it", async () => {
    const { c, callApi } = ctx([...WRITE, "mcp:sensitive"]);
    await call(c, "api_write", { method: "POST", path: "/api/email/send", body: {} });
    expect(callApi).toHaveBeenCalledTimes(1);
  });
  it("reading those routes does not need it, and ordinary writes are unaffected", async () => {
    const { c, callApi } = ctx(WRITE);
    await call(c, "api_get", { path: "/api/org/settings" });
    await call(c, "api_write", { method: "POST", path: "/api/customers", body: {} });
    expect(callApi).toHaveBeenCalledTimes(2);
  });
});

describe("QuickBooks/Xero changes through Data Studio", () => {
  const BOOKS: McpScope[] = ["mcp:read", "mcp:write", "mcp:accounting_system"];

  it("are refused without the grant", async () => {
    const { c, callApi } = ctx(["mcp:read", "mcp:write"]);
    const r = await call(c, "api_write", { method: "POST", path: "/api/batch/bulk-edit/apply", body: { ids: [1] } });
    expect(r.result.isError).toBe(true);
    expect(callApi).not.toHaveBeenCalled();
  });
  it("are described first and run only with the issued token", async () => {
    const { c, callApi } = ctx(BOOKS);
    const args = { method: "POST", path: "/api/batch/bulk-edit/apply", body: { entity: "invoice", ids: ["1", "2"] } };
    const first = await call(c, "api_write", args);
    expect(first.result.content[0].text).toMatch(/NOT EXECUTED.*changed in QuickBooks\/Xero/s);
    expect(callApi).not.toHaveBeenCalled();
    await call(c, "api_write", { ...args, confirm: tokenFrom(first) });
    expect(callApi).toHaveBeenCalledTimes(1);
  });
  it("are capped at 100 records per call, before any token is issued", async () => {
    const { c, callApi } = ctx(BOOKS);
    const r = await call(c, "api_write", { method: "POST", path: "/api/batch/delete/commit", body: { ids: Array(101).fill("x") } });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/at most 100/);
    expect(callApi).not.toHaveBeenCalled();
  });
  it("never reach employee records, even read-only", async () => {
    const { c, callApi } = ctx([...BOOKS, "mcp:delete"]);
    const r = await call(c, "api_write", { method: "POST", path: "/api/batch/bulk-edit/search", body: { entity: "employee" } });
    expect(r.result.isError).toBe(true);
    expect(r.result.content[0].text).toMatch(/personal identifiers/);
    expect(callApi).not.toHaveBeenCalled();
  });
  it("a Data Studio search runs straight away with plain write", async () => {
    const { c, callApi } = ctx(["mcp:read", "mcp:write"]);
    await call(c, "api_write", { method: "POST", path: "/api/batch/bulk-edit/search", body: { entity: "invoice" } });
    expect(callApi).toHaveBeenCalledTimes(1);
  });
  it("records the job id the app returned, so the change is traceable", async () => {
    const { c, callApi, audit } = ctx(BOOKS);
    callApi.mockResolvedValueOnce({ ok: true, status: 200, contentType: "application/json", text: '{"jobId":"job-42"}', truncated: false });
    const args = { method: "POST", path: "/api/batch/bulk-edit/apply", body: { ids: ["1"] } };
    const first = await call(c, "api_write", args);
    await call(c, "api_write", { ...args, confirm: tokenFrom(first) });
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/batch/bulk-edit/apply", ref: "job-42" }));
  });
});

describe("output", () => {
  it("redacts personal identifiers before the model sees them, and says so", async () => {
    const { c, callApi } = ctx(["mcp:read"]);
    callApi.mockResolvedValueOnce({ ok: true, status: 200, contentType: "application/json", text: '[{"name":"A","ssn":"123-45-6789"}]', truncated: false });
    const r = await call(c, "api_get", { path: "/api/x" });
    expect(r.result.content[0].text).not.toContain("123-45-6789");
    expect(r.result.content[0].text).toMatch(/1 personal or credential value\(s\) redacted/);
  });
  it("redacts BEFORE truncating, so a long body is still clean", async () => {
    const { c, callApi } = ctx(["mcp:read"]);
    const rows = Array.from({ length: 4000 }, (_, i) => ({ i, filler: "x".repeat(400), ssn: `SSN-${i}` }));
    callApi.mockResolvedValueOnce({ ok: true, status: 200, contentType: "application/json", text: JSON.stringify(rows), truncated: false });
    const out = (await call(c, "api_get", { path: "/api/x", limit: 500 })).result.content[0].text;
    expect(out).toMatch(/truncated/);
    expect(out).not.toMatch(/SSN-\d/);
  });
});

describe("paging and fields on api_get", () => {
  const bigList = (n: number) => JSON.stringify({ currency: "EUR", invoices: Array.from({ length: n }, (_, i) => ({ docNumber: `INV-${i}`, total: i, email: `a${i}@b.c`, ssn: `S${i}` })) });

  it("pages a long list by default and tells the model how to continue", async () => {
    const { c, callApi } = ctx(["mcp:read"]);
    callApi.mockResolvedValueOnce({ ok: true, status: 200, contentType: "application/json", text: bigList(6719), truncated: false });
    const out = (await call(c, "api_get", { path: "/api/invoices" })).result.content[0].text;
    expect(out).toMatch(/rows 1–100 of 6719 in "invoices" — call again with offset 100/);
    expect(out).not.toMatch(/truncated/);
    expect(JSON.parse(out.split("\n")[1]).invoices).toHaveLength(100);
  });
  it("applies limit, offset and fields, and still redacts", async () => {
    const { c, callApi } = ctx(["mcp:read"]);
    callApi.mockResolvedValueOnce({ ok: true, status: 200, contentType: "application/json", text: bigList(30), truncated: false });
    const out = (await call(c, "api_get", { path: "/api/invoices", limit: 2, offset: 10, fields: ["docNumber", "ssn"] })).result.content[0].text;
    const body = JSON.parse(out.split("\n")[1]);
    expect(body.invoices).toEqual([{ docNumber: "INV-10", ssn: "[redacted]" }, { docNumber: "INV-11", ssn: "[redacted]" }]);
    expect(out).not.toMatch(/S1[01]"/);
  });
  it("refuses a bad limit without calling the app", async () => {
    const { c, callApi } = ctx(["mcp:read"]);
    const r = await call(c, "api_get", { path: "/api/invoices", limit: 9999 });
    expect(r.result.isError).toBe(true);
    expect(callApi).not.toHaveBeenCalled();
  });
  it("a short answer is returned byte-for-byte", async () => {
    const { c, callApi } = ctx(["mcp:read"]);
    callApi.mockResolvedValueOnce({ ok: true, status: 200, contentType: "application/json", text: '{"a":[1,2]}', truncated: false });
    expect((await call(c, "api_get", { path: "/api/x" })).result.content[0].text).toBe('HTTP 200\n{"a":[1,2]}');
  });
});

describe("audit", () => {
  it("records reads as well as writes, because reading is how data leaves", async () => {
    const { c, audit } = ctx(["mcp:read"]);
    await call(c, "api_get", { path: "/api/invoices" });
    expect(audit).toHaveBeenCalledWith({ method: "GET", path: "/api/invoices", scope: "mcp:read", status: 200, ref: null });
  });
  it("does not record a refused call as if it ran", async () => {
    const { c, audit } = ctx(["mcp:read"]);
    await call(c, "api_get", { path: "/api/admin/x" });
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("orientation tools", () => {
  it("whoami returns the identity", async () => {
    const r = await call(ctx(["mcp:read"]).c, "whoami", {});
    expect(r.result.content[0].text).toMatch(/company_admin/);
  });
  it("list_api_routes filters by text and never lists a blocked route", () => {
    const out = listRoutes({ search: "invoice" });
    expect(out).toMatch(/\/api\/invoices/);
    const all = listRoutes({ limit: 200 });
    for (const bad of ["/api/admin", "/api/auth/", "/api/billing", "/api/cron", "/api/org/users", "/api/mcp"]) {
      expect(all.includes(bad), bad).toBe(false);
    }
  });
  it("an unknown tool name is an error, not a crash", async () => {
    const r = await call(ctx(FULL).c, "rm_rf", {});
    expect(r.result.isError).toBe(true);
  });
});
