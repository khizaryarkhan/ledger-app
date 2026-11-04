import { describe, it, expect, vi } from "vitest";
import { classifyQboRequest, countQueryFor, describeQboFault, entityOfSql } from "@/lib/qbo/passthrough";
import { handleRpc, qboScopesNeeded, switchRefusal, type McpContext } from "@/lib/mcp/server";
import { checkApiPath } from "@/lib/mcp/policy";
import type { McpScope } from "@/lib/mcp/oauth";

const ok = (input: unknown) => {
  const c = classifyQboRequest(input);
  if (c.ok === false) throw new Error(c.error);
  return c;
};
const refused = (input: unknown) => classifyQboRequest(input).ok === false;

describe("classifyQboRequest", () => {
  it("reads: query, single record, report, cdc, preferences", () => {
    expect(ok({ method: "GET", path: "query", query: { query: "select * from Payment" } })).toMatchObject({ kind: "read", entities: ["payment"] });
    expect(ok({ method: "GET", path: "invoice/145" }).kind).toBe("read");
    expect(ok({ method: "GET", path: "reports/ProfitAndLoss", query: { start_date: "2026-01-01" } }).kind).toBe("read");
    expect(ok({ method: "GET", path: "cdc", query: { entities: "Invoice,Payment", changedSince: "2026-10-01" } }).entities).toEqual(["invoice", "payment"]);
    expect(ok({ method: "GET", path: "preferences" }).kind).toBe("read");
  });

  it("writes, deletes and voids", () => {
    expect(ok({ method: "POST", path: "estimate", body: { Line: [] } }).kind).toBe("write");
    expect(ok({ method: "POST", path: "invoice", query: { operation: "delete" }, body: { Id: "1", SyncToken: "0" } }).kind).toBe("delete");
    // A void zeroes the transaction for good, so it is gated like a delete.
    expect(ok({ method: "POST", path: "invoice", query: { operation: "void" }, body: { Id: "1", SyncToken: "0" } }).kind).toBe("delete");
  });

  it("send emails a customer, so it is flagged", () => {
    expect(ok({ method: "POST", path: "invoice/145/send" })).toMatchObject({ kind: "write", sends: true });
  });

  it("a batch is as dangerous as its worst item, and capped at 30", () => {
    const item = (x: object, i: number) => ({ bId: String(i), ...x });
    expect(ok({ method: "POST", path: "batch", body: { BatchItemRequest: [item({ Query: "select * from Item" }, 1)] } }).kind).toBe("read");
    expect(ok({ method: "POST", path: "batch", body: { BatchItemRequest: [item({ Query: "select * from Item" }, 1), item({ Invoice: {} }, 2)] } }).kind).toBe("write");
    expect(ok({ method: "POST", path: "batch", body: { BatchItemRequest: [item({ Invoice: {}, operation: "delete" }, 1), item({ Bill: {} }, 2)] } }).kind).toBe("delete");
    const many = Array.from({ length: 31 }, (_, i) => item({ Query: "select * from Item" }, i));
    expect(refused({ method: "POST", path: "batch", body: { BatchItemRequest: many } })).toBe(true);
  });

  it("refuses files, odd paths, bodies on GET and a client-set requestid", () => {
    expect(refused({ method: "GET", path: "invoice/1/pdf" })).toBe(true);
    expect(refused({ method: "POST", path: "upload" })).toBe(true);
    expect(refused({ method: "GET", path: "../companyinfo" })).toBe(true);
    expect(refused({ method: "GET", path: "invoice/1", body: {} })).toBe(true);
    expect(refused({ method: "DELETE", path: "invoice/1" })).toBe(true);
    expect(refused({ method: "GET", path: "query", query: { query: "select * from Item", requestid: "x" } })).toBe(true);
    expect(refused({ method: "POST", path: "invoice/1", body: {} })).toBe(true);
  });

  it("include is accepted on reads only", () => {
    expect(ok({ method: "GET", path: "invoice/5", query: { include: "invoiceLink" } }).kind).toBe("read");
    expect(refused({ method: "POST", path: "invoice", query: { include: "void" }, body: { Id: "1", SyncToken: "0" } })).toBe(true);
  });

  it("operation casing and spaces cannot dodge the delete gate", () => {
    expect(ok({ method: "POST", path: "invoice", query: { operation: " Delete " }, body: { Id: "1" } }).kind).toBe("delete");
    expect(ok({ method: "POST", path: "batch", body: { BatchItemRequest: [{ bId: "1", operation: "VOID", Invoice: { Id: "1" } }] } }).kind).toBe("delete");
  });

  it("a batch Query item that also names an entity or operation is refused", () => {
    expect(refused({ method: "POST", path: "batch", body: { BatchItemRequest: [{ bId: "1", Query: "select * from Item", operation: "delete", Invoice: { Id: "1" } }] } })).toBe(true);
  });

  it("employee records are refused however they are reached", () => {
    expect(refused({ method: "GET", path: "query", query: { query: "select * from Employee" } })).toBe(true);
    expect(refused({ method: "GET", path: "employee/7" })).toBe(true);
    expect(refused({ method: "GET", path: "cdc", query: { entities: "Invoice,Employee", changedSince: "2026-10-01" } })).toBe(true);
    expect(refused({ method: "POST", path: "batch", body: { BatchItemRequest: [{ bId: "1", Query: "select * from Employee" }] } })).toBe(true);
  });

  it("counts a query with the same entity and WHERE", () => {
    expect(entityOfSql("SELECT * FROM Invoice WHERE Balance > '0'")).toBe("invoice");
    expect(countQueryFor("select * from Invoice where Balance > '0' STARTPOSITION 1 MAXRESULTS 100")).toMatch(/^select count\(\*\) from Invoice where Balance > '0'$/i);
  });

  it("returns QuickBooks' Fault in full", () => {
    const f = describeQboFault({ Fault: { Error: [{ Message: "Stale Object Error", Detail: "SyncToken mismatch", code: "5010" }], type: "ValidationFault" } });
    expect(f).toMatch(/5010/);
    expect(f).toMatch(/SyncToken mismatch/);
  });
});

describe("qbo_api scopes and switches", () => {
  it("names the grants each kind needs", () => {
    expect(qboScopesNeeded("read", false)).toEqual(["mcp:read"]);
    expect(qboScopesNeeded("write", false)).toContain("mcp:accounting_system");
    expect(qboScopesNeeded("delete", false)).toEqual(expect.arrayContaining(["mcp:accounting_system", "mcp:delete"]));
    expect(qboScopesNeeded("write", true)).toContain("mcp:sensitive");
  });
  it("the admin switches refuse changes and deletes", () => {
    expect(switchRefusal({ writes: false, deletes: true }, false)).toMatch(/switched off changes/);
    expect(switchRefusal({ writes: true, deletes: false }, true)).toMatch(/switched off deletes/);
    expect(switchRefusal({ writes: true, deletes: false }, false)).toBeNull();
  });
  it("the passthrough route is closed to the generic api_* tools", () => {
    expect(checkApiPath("/api/qbo/api").ok).toBe(false);
  });
});

function ctx(scopes: McpScope[], switches = { writes: true, deletes: true }) {
  const callQbo = vi.fn(async () => ({ ok: true as const, status: 200, contentType: "application/json", text: '{"ok":true,"rows":[]}', truncated: false }));
  const callApi = vi.fn();
  const c: McpContext = {
    scopes, connectionId: "conn-1", confirmSecret: "test-secret", callApi, callQbo,
    audit: vi.fn(async () => {}), whoami: async () => ({}), aiSwitches: async () => switches,
  };
  return { c, callQbo, callApi };
}
const call = (c: McpContext, args: Record<string, unknown>) =>
  handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "qbo_api", arguments: args } }, c) as Promise<any>;
const out = (r: any): string => r.result.content[0].text;
const tokenFrom = (r: any): string => /\(valid 5 minutes\): (\S+)/.exec(out(r))![1];

const CREATE = { method: "POST", path: "estimate", body: { CustomerRef: { value: "1" }, Line: [] } };
const DELETE = { method: "POST", path: "invoice", query: { operation: "delete" }, body: { Id: "9", SyncToken: "2" } };

describe("qbo_api tool", () => {
  it("a read runs straight away with read access only", async () => {
    const { c, callQbo } = ctx(["mcp:read"]);
    const r = await call(c, { method: "GET", path: "query", query: { query: "select * from Payment" }, withCount: true });
    expect(r.result.isError).toBe(false);
    expect(callQbo).toHaveBeenCalledWith(expect.objectContaining({ path: "query", withCount: true }));
  });

  it("a change without the QuickBooks grant is refused, naming it", async () => {
    const { c, callQbo } = ctx(["mcp:read", "mcp:write"]);
    const r = await call(c, CREATE);
    expect(out(r)).toMatch(/Change QuickBooks \/ Xero/);
    expect(callQbo).not.toHaveBeenCalled();
  });

  it("a change needs confirmation, then sends one idempotency key", async () => {
    const { c, callQbo } = ctx(["mcp:read", "mcp:accounting_system"]);
    const first = await call(c, CREATE);
    expect(out(first)).toMatch(/NOT EXECUTED/);
    expect(callQbo).not.toHaveBeenCalled();
    const token = tokenFrom(first);
    await call(c, { ...CREATE, confirm: token });
    await call(c, { ...CREATE, confirm: token });
    const keys = callQbo.mock.calls.map((a: any) => a[0].idempotencyKey);
    expect(keys[0]).toMatch(/^[0-9a-f]{40}$/);
    expect(keys[1]).toBe(keys[0]); // a retried confirmed call cannot create a second record
  });

  it("a token for one change does not unlock a different one", async () => {
    const { c, callQbo } = ctx(["mcp:read", "mcp:accounting_system"]);
    const token = tokenFrom(await call(c, CREATE));
    const r = await call(c, { ...CREATE, body: { ...CREATE.body, TotalAmt: 999 }, confirm: token });
    expect(out(r)).toMatch(/NOT EXECUTED/);
    expect(callQbo).not.toHaveBeenCalled();
  });

  it("preview runs nothing in QuickBooks and needs no token", async () => {
    const { c, callQbo } = ctx(["mcp:read", "mcp:accounting_system"]);
    await call(c, { ...CREATE, preview: true });
    expect(callQbo).toHaveBeenCalledWith(expect.objectContaining({ preview: true }));
  });

  it("delete needs the delete grant as well", async () => {
    const { c } = ctx(["mcp:read", "mcp:accounting_system"]);
    expect(out(await call(c, DELETE))).toMatch(/"Delete"/);
  });

  it("send needs the sensitive grant", async () => {
    const { c } = ctx(["mcp:read", "mcp:accounting_system"]);
    expect(out(await call(c, { method: "POST", path: "invoice/5/send" }))).toMatch(/Send email/);
  });

  it("the admin switch stops a change even with every grant and a valid token", async () => {
    const all: McpScope[] = ["mcp:read", "mcp:write", "mcp:delete", "mcp:sensitive", "mcp:accounting_system"];
    const on = ctx(all);
    const token = tokenFrom(await call(on.c, CREATE));
    const off = ctx(all, { writes: false, deletes: false });
    const r = await call(off.c, { ...CREATE, confirm: token });
    expect(out(r)).toMatch(/switched off/);
    expect(off.callQbo).not.toHaveBeenCalled();
  });

  it("the admin switch also binds the generic write and delete tools", async () => {
    const { c, callApi } = ctx(["mcp:read", "mcp:write", "mcp:delete"], { writes: false, deletes: false });
    const r = await handleRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "api_write", arguments: { method: "POST", path: "/api/notes", body: {} } } }, c) as any;
    expect(out(r)).toMatch(/switched off/);
    expect(callApi).not.toHaveBeenCalled();
  });
});
