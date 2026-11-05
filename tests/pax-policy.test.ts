import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import { canPropose, checkProposal, DEFAULT_POLICY, normalisePolicy, providerRefusal, recheckStored } from "@/lib/pax/policy";
import { paxToolDefs, runPaxTool } from "@/lib/pax/tools";
import { toUiBlocks } from "@/lib/pax/ui-shape";
import type { McpContext } from "@/lib/mcp/server";

const okResult = { ok: true as const, status: 200, contentType: "application/json", text: '{"QueryResponse":{}}', truncated: false };

function ctx() {
  const callApi = vi.fn(async () => okResult);
  const callQbo = vi.fn(async () => okResult);
  const c: McpContext = {
    scopes: ["mcp:read"], connectionId: "pax:t", confirmSecret: "s", callApi, callQbo,
    aiSwitches: async () => ({ writes: false, deletes: false }), whoami: async () => ({}), audit: async () => {},
  };
  return { c, callApi, callQbo };
}

describe("organisation rules", () => {
  it("allows everything by default", () => {
    expect(providerRefusal(DEFAULT_POLICY, "openai", false)).toBeNull();
    expect(providerRefusal(DEFAULT_POLICY, "ollama", true)).toBeNull();
  });

  it("refuses a provider outside the allowlist and a custom endpoint when those are off", () => {
    const p = normalisePolicy({ allowedProviders: ["anthropic"], allowCustomEndpoints: false });
    expect(providerRefusal(p, "openai", false)).toMatch(/not allowed/);
    expect(providerRefusal(p, "anthropic", false)).toBeNull();
    expect(providerRefusal(normalisePolicy({ allowedProviders: ["x"], allowCustomEndpoints: false }), "x", true)).toMatch(/custom endpoints/);
  });

  it("offers changes only when the admin, the AI write switch AND a trusted model all agree", () => {
    const on = normalisePolicy({ writesEnabled: true });
    expect(canPropose({ policy: on, aiWritesEnabled: true, tier: "full" })).toBe(true);
    expect(canPropose({ policy: on, aiWritesEnabled: false, tier: "full" })).toBe(false);
    expect(canPropose({ policy: on, aiWritesEnabled: true, tier: "read" })).toBe(false);
    expect(canPropose({ policy: DEFAULT_POLICY, aiWritesEnabled: true, tier: "full" })).toBe(false);
  });
});

describe("a proposed change", () => {
  const good = { method: "POST", path: "/api/invoices/abc/promises", body: { promiseDate: "2026-12-01" }, summary: "Record a promise to pay on 2026-12-01." };

  it("passes the same route rules as an AI connection with write access", () => {
    const r = checkProposal(good);
    expect(r.ok).toBe(true);
  });

  it("refuses deletes, reads, other methods and a missing or oversized summary", () => {
    expect(checkProposal({ ...good, method: "DELETE" })).toMatchObject({ ok: false });
    expect(checkProposal({ ...good, method: "GET" })).toMatchObject({ ok: false });
    expect(checkProposal({ ...good, summary: "" })).toMatchObject({ ok: false });
    expect(checkProposal({ ...good, summary: "x".repeat(301) })).toMatchObject({ ok: false });
  });

  it("refuses routes an AI may never reach, QuickBooks/Xero changes and email sends", () => {
    for (const path of ["/api/admin/customers", "/api/billing/portal", "/api/pax-console/policy", "/api/batch/upload/commit", "/api/email/send"]) {
      expect(checkProposal({ ...good, path }), path).toMatchObject({ ok: false });
    }
  });

  it("refuses routes that delete or undo through a POST (the reviewed hole: /api/invoices/bulk-delete)", () => {
    for (const path of ["/api/invoices/bulk-delete", "/api/customers/bulk-delete", "/api/projects/bulk-delete", "/api/invoices/abc/void", "/api/accounting/purge", "/api/x/merge"]) {
      expect(checkProposal({ ...good, path }), path).toMatchObject({ ok: false });
    }
    // Words that merely contain those letters are not caught.
    expect(checkProposal({ ...good, path: "/api/invoices/abc/promises" }).ok).toBe(true);
  });

  it("is deny-by-default: a route not on the proposable list is refused even when nothing about it looks dangerous", () => {
    for (const path of ["/api/payables/suppliers/abc", "/api/payables/bills/abc/approve", "/api/payables/bills/abc/reject", "/api/invoices/abc/payment", "/api/customers/reclassify", "/api/reps/abc", "/api/projects"]) {
      expect(checkProposal({ ...good, method: path.endsWith("/suppliers/abc") || path.endsWith("/reps/abc") ? "PATCH" : "POST", path }), path).toMatchObject({ ok: false });
    }
    const refused = checkProposal({ ...good, path: "/api/payables/suppliers/abc", method: "PATCH" });
    expect(refused.ok === false && refused.reason).toMatch(/can propose: record a promise to pay/);
  });

  it("accepts each listed change only with its listed method", () => {
    expect(checkProposal({ ...good, method: "PUT" }).ok).toBe(false); // promises is POST only
    expect(checkProposal({ method: "PATCH", path: "/api/tasks/t1", body: { title: "x" }, summary: "Update a task." }).ok).toBe(true);
    expect(checkProposal({ method: "POST", path: "/api/tasks", body: { title: "Call ACME" }, summary: "Create a task." }).ok).toBe(true);
    expect(checkProposal({ method: "PATCH", path: "/api/invoices/abc", body: { collectionStage: "Reminder" }, summary: "Move to Reminder." }).ok).toBe(true);
  });

  it("caps a bulk stage change at 50 invoices and requires the ids", () => {
    const bulk = (ids: unknown) => checkProposal({ method: "POST", path: "/api/invoices/batch-update", body: { ids, collectionStage: "Reminder" }, summary: "Move them." });
    expect(bulk(["a", "b"]).ok).toBe(true);
    expect(bulk(Array.from({ length: 51 }, (_, i) => `i${i}`)).ok).toBe(false);
    expect(bulk([]).ok).toBe(false);
    expect(bulk(undefined).ok).toBe(false);
  });

  it("re-checks a STORED request, so a rule tightened after the proposal still applies", () => {
    expect(recheckStored({ method: "POST", path: "/api/invoices/abc/promises", query: null, body: {}, summary: "ok" })).toEqual({ ok: true });
    expect(recheckStored({ method: "DELETE", path: "/api/invoices/abc", query: null, body: null, summary: "ok" })).toMatchObject({ ok: false });
  });
});

describe("tools in a conversation", () => {
  it("offers api_write and qbo_api only when the server says so", () => {
    const names = (env = {}) => paxToolDefs(env).map((t) => t.function.name);
    expect(names()).not.toContain("api_write");
    expect(names()).not.toContain("qbo_api");
    expect(names({ canPropose: true })).not.toContain("api_write"); // no propose callback, nothing to offer
    expect(names({ canPropose: true, propose: async () => ({ ok: true, text: "" }) })).toContain("api_write");
    expect(names({ canQbo: true })).toContain("qbo_api");
  });

  it("refuses a tool the conversation was not offered, even if a model invents it", async () => {
    const { c, callApi, callQbo } = ctx();
    for (const name of ["api_write", "qbo_api"]) {
      const r = await runPaxTool(c, name, '{"method":"POST","path":"/api/x","summary":"s"}');
      expect(r.ok, name).toBe(false);
    }
    expect(callApi).not.toHaveBeenCalled();
    expect(callQbo).not.toHaveBeenCalled();
  });

  it("api_write only PROPOSES: it never calls the app", async () => {
    const { c, callApi, callQbo } = ctx();
    const propose = vi.fn(async () => ({ ok: true, text: "Proposed." }));
    const args = JSON.stringify({ method: "POST", path: "/api/invoices/abc/promises", body: { promiseDate: "2026-12-01" }, summary: "Record a promise." });
    const r = await runPaxTool(c, "api_write", args, { canPropose: true, propose });
    expect(r.ok).toBe(true);
    expect(propose).toHaveBeenCalledTimes(1);
    expect(callApi).not.toHaveBeenCalled();
    expect(callQbo).not.toHaveBeenCalled();
  });

  it("an invalid proposal is refused before anything is stored", async () => {
    const { c } = ctx();
    const propose = vi.fn(async () => ({ ok: true, text: "" }));
    const r = await runPaxTool(c, "api_write", JSON.stringify({ method: "DELETE", path: "/api/invoices/abc", summary: "Delete it" }), { canPropose: true, propose });
    expect(r.ok).toBe(false);
    expect(propose).not.toHaveBeenCalled();
  });

  it("qbo_api refuses employee records and redacts personal identifiers in what it returns", async () => {
    const { c, callQbo } = ctx();
    const env = { canQbo: true };
    const emp = await runPaxTool(c, "qbo_api", JSON.stringify({ method: "GET", path: "query", query: { query: "select * from Employee" } }), env);
    expect(emp.ok).toBe(false);
    expect(callQbo).not.toHaveBeenCalled();
    callQbo.mockResolvedValueOnce({ ...okResult, text: '{"Vendor":{"DisplayName":"Acme","TaxIdentifier":"123-45-6789","SSN":"999-99-9999"}}' });
    const r = await runPaxTool(c, "qbo_api", JSON.stringify({ method: "GET", path: "vendor/1" }), env);
    expect(r.text).toContain("Acme");
    expect(r.text).not.toContain("123-45-6789");
    expect(r.text).not.toContain("999-99-9999");
  });

  it("qbo_api reads, and refuses every other method", async () => {
    const { c, callQbo } = ctx();
    const env = { canQbo: true };
    const read = await runPaxTool(c, "qbo_api", JSON.stringify({ method: "GET", path: "query", query: { query: "select * from Payment" } }), env);
    expect(read.ok).toBe(true);
    expect(callQbo).toHaveBeenCalledTimes(1);
    for (const method of ["POST", "DELETE"]) {
      const r = await runPaxTool(c, "qbo_api", JSON.stringify({ method, path: "invoice", body: { Id: "1" } }), env);
      expect(r.ok, method).toBe(false);
    }
    expect(callQbo).toHaveBeenCalledTimes(1);
  });
});

describe("who may run a stored proposal", () => {
  const read = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");

  it("only the user-click route executes a pending action; nothing the model can reach does", () => {
    // The model's side: tools, the chat route and the agent loop must never run a stored action.
    for (const f of ["lib/pax/tools.ts", "lib/pax/agent.ts", "app/api/pax-console/chat/route.ts"]) {
      expect(read(f), f).not.toMatch(/callInternalApi/);
    }
    // The chat route only INSERTS a proposal; it never reads one back to run it.
    expect(read("app/api/pax-console/chat/route.ts")).not.toMatch(/status:\s*"running"|status:\s*"applied"/);
    // The click route is the one that runs it, and it claims atomically and re-checks first.
    const act = read("app/api/pax-console/actions/[id]/route.ts");
    expect(act).toMatch(/callInternalApi/);
    expect(act).toMatch(/recheckStored/);
    expect(act).toMatch(/isAiCall\(session\)/);
    expect(act).toMatch(/status: "running"/);
  });
});

describe("conversation blocks with proposals", () => {
  const action = { id: "a1", method: "POST", path: "/api/x", query: null, body: null, summary: "Do it", status: "pending", result: null };

  it("places a card after the answer of the turn it was made in and before the next question", () => {
    const rows = [
      { message: { role: "user", content: "q1" }, createdAt: "2026-11-05T10:00:00.000Z" },
      { message: { role: "assistant", content: "a1" }, createdAt: "2026-11-05T10:00:00.003Z" },
      { message: { role: "user", content: "q2" }, createdAt: "2026-11-05T10:05:00.000Z" },
    ];
    const blocks = toUiBlocks(rows, [{ ...action, createdAt: "2026-11-05T10:00:04.000Z" }]);
    expect(blocks.map((b) => b.kind)).toEqual(["user", "assistant", "action", "user"]);
  });

  it("keeps a card that is newer than every message", () => {
    const blocks = toUiBlocks([{ message: { role: "user", content: "q" }, createdAt: "2026-11-05T10:00:00.000Z" }], [{ ...action, createdAt: "2026-11-05T11:00:00.000Z" }]);
    expect(blocks.at(-1)?.kind).toBe("action");
  });
});
