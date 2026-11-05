import { describe, expect, it, vi } from "vitest";
import { MAX_CALLS_PER_STEP, runAgent, textOnlyHistory, type AgentEvent, type ChatClient } from "@/lib/pax/agent";
import { MAX_TOOL_CHARS, PAX_READ_TOOLS, paxToolDefs, runPaxTool } from "@/lib/pax/tools";
import type { McpContext } from "@/lib/mcp/server";

function fakeCtx(over: Partial<McpContext> = {}) {
  const callApi = vi.fn(async () => ({ ok: true as const, status: 200, contentType: "application/json", text: '{"invoices":[{"id":"1"}]}', truncated: false }));
  const audit = vi.fn(async () => {});
  const ctx: McpContext = {
    scopes: ["mcp:read"],
    connectionId: "pax:test",
    confirmSecret: "secret",
    callApi,
    callQbo: vi.fn(async () => ({ ok: false as const, error: "no" })),
    aiSwitches: async () => ({ writes: false, deletes: false }),
    whoami: async () => ({ user: { email: "a@b.c" } }),
    audit,
    ...over,
  };
  return { ctx, callApi, audit };
}

const toolCall = (id: string, name: string, args: unknown) => ({ id, type: "function", function: { name, arguments: typeof args === "string" ? args : JSON.stringify(args) } });
const answer = (msg: Record<string, unknown>) => ({ choices: [{ message: msg }] });

function scripted(replies: unknown[]) {
  const create = vi.fn(async (_body: Record<string, unknown>) => {
    const next = replies.shift();
    if (next === undefined) throw new Error("the fake model ran out of replies");
    return next;
  });
  const client: ChatClient = { chat: { completions: { create } } };
  return { client, create };
}

describe("tools a model is offered", () => {
  it("are exactly the three read tools — nothing that writes, deletes or reaches QuickBooks", () => {
    expect(paxToolDefs().map((t) => t.function.name).sort()).toEqual([...PAX_READ_TOOLS].sort());
  });

  it("refuses a tool outside the list even when a model invents it", async () => {
    const { ctx, callApi } = fakeCtx();
    for (const name of ["api_write", "api_delete", "qbo_api", "drop_tables"]) {
      const r = await runPaxTool(ctx, name, '{"method":"POST","path":"/api/invoices"}');
      expect(r.ok, name).toBe(false);
      expect(r.text, name).toMatch(/not available in PAX Console/);
    }
    expect(callApi).not.toHaveBeenCalled();
  });

  it("refuses arguments that are not a JSON object", async () => {
    const { ctx, callApi } = fakeCtx();
    expect((await runPaxTool(ctx, "api_get", "{bad")).ok).toBe(false);
    expect((await runPaxTool(ctx, "api_get", "[1,2]")).ok).toBe(false);
    expect(callApi).not.toHaveBeenCalled();
  });

  it("reads through the app as the user and audits the read", async () => {
    const { ctx, callApi, audit } = fakeCtx();
    const r = await runPaxTool(ctx, "api_get", '{"path":"/api/invoices"}');
    expect(r.ok).toBe(true);
    expect(r.text).toContain("HTTP 200");
    expect(callApi).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/api/invoices" }));
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ method: "GET", path: "/api/invoices" }));
  });

  it.each(["/api/admin/organisations", "/api/pax-console/settings", "/api/billing/portal", "/api/mcp"])("never reads %s", async (path) => {
    const { ctx, callApi } = fakeCtx();
    const r = await runPaxTool(ctx, "api_get", JSON.stringify({ path }));
    expect(r.ok).toBe(false);
    expect(r.text).toMatch(/Refused/);
    expect(callApi).not.toHaveBeenCalled();
  });

  it("cuts an oversized result for the model and says how to narrow it", async () => {
    const big = "x".repeat(MAX_TOOL_CHARS * 2);
    const { ctx } = fakeCtx({ callApi: async () => ({ ok: true, status: 200, contentType: "text/plain", text: big, truncated: false }) });
    const r = await runPaxTool(ctx, "api_get", '{"path":"/api/invoices"}');
    expect(r.text.length).toBeLessThan(MAX_TOOL_CHARS + 400);
    expect(r.text).toMatch(/cut for the model/);
  });
});

describe("what is replayed from earlier turns", () => {
  it("keeps the words and drops tool results, empty steps and lookups", () => {
    const h = textOnlyHistory([
      { role: "user", content: "How many invoices?" },
      { role: "assistant", content: null, tool_calls: [toolCall("1", "api_get", { path: "/api/invoices" })] },
      { role: "tool", tool_call_id: "1", content: "HTTP 200 secret rows" },
      { role: "assistant", content: "You have 1." },
      { role: "assistant", content: "   " },
    ]);
    expect(h).toEqual([{ role: "user", content: "How many invoices?" }, { role: "assistant", content: "You have 1." }]);
    expect(JSON.stringify(h)).not.toMatch(/secret rows|tool_calls/);
  });
});

describe("turn safety", () => {
  const base = { model: "m", system: "S", history: [{ role: "user" as const, content: "Hi" }] };

  it("gives a tool call an id when the provider omits one, and answers that same id", async () => {
    const { ctx } = fakeCtx();
    const noId = { type: "function", function: { name: "api_get", arguments: '{"path":"/api/invoices"}' } };
    const { client } = scripted([answer({ content: null, tool_calls: [noId] }), answer({ content: "ok" })]);
    const r = await runAgent({ ...base, client, ctx, emit: () => {} });
    const id = r.produced[0].tool_calls[0].id;
    expect(id).toBeTruthy();
    expect(r.produced[1].tool_call_id).toBe(id);
  });

  it("replaces an empty answer with a visible one", async () => {
    const { ctx } = fakeCtx();
    const { client } = scripted([answer({ content: "   " })]);
    const r = await runAgent({ ...base, client, ctx, emit: () => {} });
    expect(r.finalText).toMatch(/could not produce an answer/);
    expect(r.produced[0].content).toBe(r.finalText);
  });

  it("stops when the caller has gone, without calling the model", async () => {
    const { ctx } = fakeCtx();
    const gone = new AbortController();
    gone.abort();
    const { client, create } = scripted([answer({ content: "x" })]);
    await expect(runAgent({ ...base, client, ctx, emit: () => {}, signal: gone.signal })).rejects.toThrow(/Cancelled/);
    expect(create).not.toHaveBeenCalled();
  });

  it("stops starting work once the time budget is spent, and still returns an answer to save", async () => {
    const { ctx } = fakeCtx();
    const { client, create } = scripted([answer({ content: "x" })]);
    const r = await runAgent({ ...base, client, ctx, emit: () => {}, deadline: Date.now() - 1 });
    expect(create).not.toHaveBeenCalled();
    expect(r.finalText).toMatch(/ran out of time/);
    expect(r.produced).toHaveLength(1);
  });
});

describe("the conversation loop", () => {
  const base = { model: "m", system: "SYSTEM", history: [{ role: "user" as const, content: "How many invoices?" }] };

  it("runs a tool, hands the result back, and returns the model's answer", async () => {
    const { ctx } = fakeCtx();
    const { client, create } = scripted([
      answer({ content: null, tool_calls: [toolCall("c1", "api_get", { path: "/api/invoices" })] }),
      answer({ content: "You have 1 invoice." }),
    ]);
    const events: AgentEvent[] = [];
    const r = await runAgent({ ...base, client, ctx, emit: (e) => events.push(e) });

    expect(r.finalText).toBe("You have 1 invoice.");
    expect(r.steps).toBe(2);
    expect(r.produced.map((m) => m.role)).toEqual(["assistant", "tool", "assistant"]);
    expect(r.produced[0].tool_calls[0].function.name).toBe("api_get");
    expect(r.produced[1].tool_call_id).toBe("c1");
    expect(events.map((e) => e.type)).toEqual(["tool", "tool_done", "text"]);

    // The second request carried the system prompt first, the history, and the tool result.
    const second = create.mock.calls[1][0] as { messages: { role: string }[] };
    expect(second.messages[0]).toEqual({ role: "system", content: "SYSTEM" });
    expect(second.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
  });

  it("offers the model only the read tools", async () => {
    const { ctx } = fakeCtx();
    const { client, create } = scripted([answer({ content: "Hi." })]);
    await runAgent({ ...base, client, ctx, emit: () => {} });
    const body = create.mock.calls[0][0] as { tools: { function: { name: string } }[] };
    expect(body.tools.map((t) => t.function.name).sort()).toEqual([...PAX_READ_TOOLS].sort());
  });

  it("answers an invented write tool with a refusal and never touches the app", async () => {
    const { ctx, callApi } = fakeCtx();
    const { client } = scripted([
      answer({ content: null, tool_calls: [toolCall("w1", "api_write", { method: "POST", path: "/api/invoices", body: {} })] }),
      answer({ content: "I can only read in this version." }),
    ]);
    const r = await runAgent({ ...base, client, ctx, emit: () => {} });
    expect(r.produced[1].content).toMatch(/not available in PAX Console/);
    expect(callApi).not.toHaveBeenCalled();
  });

  it("answers every tool call, even those beyond the per-step cap", async () => {
    const { ctx } = fakeCtx();
    const many = Array.from({ length: MAX_CALLS_PER_STEP + 2 }, (_, i) => toolCall(`c${i}`, "api_get", { path: "/api/invoices" }));
    const { client } = scripted([answer({ content: null, tool_calls: many }), answer({ content: "Done." })]);
    const r = await runAgent({ ...base, client, ctx, emit: () => {} });
    const tools = r.produced.filter((m) => m.role === "tool");
    expect(tools).toHaveLength(many.length);
    expect(tools.slice(MAX_CALLS_PER_STEP).every((m) => /Skipped/.test(m.content))).toBe(true);
  });

  it("stops at the step limit instead of looping forever", async () => {
    const { ctx } = fakeCtx();
    const loop = () => answer({ content: null, tool_calls: [toolCall("c", "api_get", { path: "/api/invoices" })] });
    const { client, create } = scripted([loop(), loop(), loop(), loop(), loop()]);
    const r = await runAgent({ ...base, client, ctx, emit: () => {}, maxSteps: 3 });
    expect(create).toHaveBeenCalledTimes(3);
    expect(r.finalText).toMatch(/step limit/);
  });

  it("fails clearly when the model returns nothing", async () => {
    const { ctx } = fakeCtx();
    const { client } = scripted([{ choices: [] }]);
    await expect(runAgent({ ...base, client, ctx, emit: () => {} })).rejects.toThrow(/no answer/);
  });
});
