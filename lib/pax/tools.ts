// The tools PAX Console offers a model. They are NOT a second tool set: whoami,
// list_api_routes and api_get are the MCP server's own (lib/mcp/server.ts), run
// through the same `callTool`, so the route deny-list, redaction, paging and —
// above all — the replay of every call under the signed-in user's own role are
// the very same code for both doors.
//
// `analyze` is PAX Console's own read tool: it asks the app for totals computed
// on the server (receivables by stage, payments in a range), because a model
// cannot total thousands of invoices by paging a 500-row list. It is still a call
// to the app under the user's token, so rep scope and role checks apply.
//
// Phase 1 is read-only. A write tool is not merely hidden from the model: a
// call to anything outside this list is refused here even if a model invents it.

import { callTool, formatResult, toolsFor, type McpContext } from "@/lib/mcp/server";
import { MAX_LIMIT, PAYMENT_GROUPS, RECEIVABLE_GROUPS } from "./analysis";

export const PAX_READ_TOOLS = ["whoami", "list_api_routes", "api_get", "analyze"] as const;
export type PaxToolName = (typeof PAX_READ_TOOLS)[number];

export const isPaxReadTool = (name: unknown): name is PaxToolName =>
  typeof name === "string" && (PAX_READ_TOOLS as readonly string[]).includes(name);

/** More than this reaches a model only as noise, and a small model's context is small. */
export const MAX_TOOL_CHARS = 24_000;

export const ANALYZE_PATH = "/api/pax-console/analyze";

export interface OpenAiTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

const ANALYZE_TOOL: OpenAiTool = {
  type: "function",
  function: {
    name: "analyze",
    description:
      "Totals and lists computed on the server, so you never have to page through records. " +
      "dataset receivables: open balances as at asOf (default today), grouped by groupBy (stage, escalated_to, escalation_type, customer, project, bucket, currency, disputed). " +
      "Narrow it with filters: stage (array), bucket (array), customer (name contains), currency, escalatedTo (name contains), minDaysPastDue, disputed. " +
      "It returns totals per currency, the groups, and the largest items with their invoice numbers. " +
      "dataset payments: payments received between from and to (YYYY-MM-DD; both default to today), grouped by day, month, customer, method or currency. " +
      "Amounts are never added across currencies. Use this instead of reading /api/invoices or looping over customers.",
    parameters: {
      type: "object",
      properties: {
        dataset: { type: "string", enum: ["receivables", "payments"] },
        groupBy: { type: "string", enum: [...new Set([...RECEIVABLE_GROUPS, ...PAYMENT_GROUPS])], description: "For receivables: stage, customer, project, currency, bucket, escalated_to, escalation_type, disputed. For payments: day, month, customer, method, currency." },
        asOf: { type: "string", description: "Receivables only. YYYY-MM-DD." },
        from: { type: "string", description: "Payments only. YYYY-MM-DD." },
        to: { type: "string", description: "Payments only. YYYY-MM-DD." },
        limit: { type: "number", description: `Groups or rows to return (1-${MAX_LIMIT}, default 30).` },
        withRows: { type: "boolean", description: "Receivables: also list the largest items when grouping." },
        filters: {
          type: "object",
          properties: {
            stage: { type: "array", items: { type: "string" } },
            bucket: { type: "array", items: { type: "string" } },
            customer: { type: "string" },
            currency: { type: "string" },
            escalatedTo: { type: "string" },
            minDaysPastDue: { type: "number" },
            disputed: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
      required: ["dataset"],
      additionalProperties: false,
    },
  },
};

export function paxToolDefs(): OpenAiTool[] {
  const shared = toolsFor(["mcp:read"])
    .filter((t) => isPaxReadTool(t.name))
    .map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  return [...shared, ANALYZE_TOOL];
}

export type ToolOutcome = { ok: boolean; text: string };

const cut = (text: string): string =>
  text.length > MAX_TOOL_CHARS
    ? `${text.slice(0, MAX_TOOL_CHARS)}\n[cut for the model: ask for fewer fields (fields) or a narrower query (limit, offset, filters)]`
    : text;

async function runAnalyze(ctx: McpContext, args: Record<string, unknown>): Promise<ToolOutcome> {
  const result = await ctx.callApi({ method: "POST", path: ANALYZE_PATH, body: args });
  // A read, audited as one (the call itself is a POST only because it carries a body).
  await ctx.audit({ method: "GET", path: ANALYZE_PATH, scope: "mcp:read", status: result.ok ? result.status : null }).catch(() => {});
  const formatted = formatResult(result);
  return { ok: !formatted.isError, text: cut(formatted.content.map((c) => c.text).join("\n")) };
}

export async function runPaxTool(ctx: McpContext, name: unknown, rawArgs: string | undefined | null): Promise<ToolOutcome> {
  if (!isPaxReadTool(name)) return { ok: false, text: `Refused: ${String(name)} is not available in PAX Console. This version can only read.` };

  let args: Record<string, unknown> = {};
  if (rawArgs && rawArgs.trim()) {
    let parsed: unknown;
    try { parsed = JSON.parse(rawArgs); } catch { return { ok: false, text: "Refused: the arguments were not valid JSON." }; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, text: "Refused: the arguments must be a JSON object." };
    args = parsed as Record<string, unknown>;
  }

  if (name === "analyze") return runAnalyze(ctx, args);

  const result = await callTool(name, args, ctx);
  return { ok: !result.isError, text: cut(result.content.map((c) => c.text).join("\n")) };
}
