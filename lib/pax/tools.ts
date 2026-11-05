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
import { redactText } from "@/lib/mcp/policy";
import { checkProposal, MAX_SUMMARY_CHARS, type Proposal } from "./policy";

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

export type ToolOutcome = { ok: boolean; text: string };

/**
 * What THIS conversation may use beyond the four read tools. Decided by the server per
 * message (role, the organisation's switches, the model's tier) — never by the model.
 */
export interface PaxToolEnv {
  /** api_write is offered: it only ever PROPOSES, through `propose`. */
  canPropose?: boolean;
  /** qbo_api is offered, read-only (organisation admins only; the route enforces that too). */
  canQbo?: boolean;
  propose?: (p: Proposal) => Promise<ToolOutcome>;
}

const PROPOSE_TOOL: OpenAiTool = {
  type: "function",
  function: {
    name: "api_write",
    description:
      "PROPOSE a change to the app (POST, PUT or PATCH to an app API route). Nothing is changed by this call: it shows the user a card with your summary and an Apply button, " +
      "and the change happens only if they press it. Before proposing, read what you need so the request is exact (find the route with list_api_routes; its body{} lists field names). " +
      "Write summary as one plain sentence saying what will change and to which records. After proposing, tell the user to review the card; never say it is done. " +
      "Deleting, changing QuickBooks/Xero, sending email and changing settings are not available.",
    parameters: {
      type: "object",
      properties: {
        method: { type: "string", enum: ["POST", "PUT", "PATCH"] },
        path: { type: "string", description: "Route path starting with /api/, no query string." },
        query: { type: "object", additionalProperties: true },
        body: { type: "object", additionalProperties: true },
        summary: { type: "string", description: `One plain sentence for the user to read before applying (max ${MAX_SUMMARY_CHARS} characters).` },
      },
      required: ["method", "path", "summary"],
      additionalProperties: false,
    },
  },
};

/** The MCP server's own QuickBooks tool, narrowed to GET: here it can only read. */
function qboReadTool(): OpenAiTool | null {
  const t = toolsFor(["mcp:read"]).find((x) => x.name === "qbo_api");
  if (!t) return null;
  const schema = t.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
  return {
    type: "function",
    function: {
      name: "qbo_api",
      description: "In PAX Console this tool can only READ (method GET); it cannot create, change, delete, send or move money. " + t.description,
      parameters: { ...schema, properties: { ...(schema.properties ?? {}), method: { type: "string", enum: ["GET"] } }, required: ["path"] },
    },
  };
}

export function paxToolDefs(env: PaxToolEnv = {}): OpenAiTool[] {
  const shared = toolsFor(["mcp:read"])
    .filter((t) => isPaxReadTool(t.name))
    .map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
  const out: OpenAiTool[] = [...shared, ANALYZE_TOOL];
  if (env.canQbo) { const q = qboReadTool(); if (q) out.push(q); }
  if (env.canPropose && env.propose) out.push(PROPOSE_TOOL);
  return out;
}

const isOffered = (name: unknown, env: PaxToolEnv): boolean =>
  isPaxReadTool(name) || (name === "qbo_api" && env.canQbo === true) || (name === "api_write" && env.canPropose === true && !!env.propose);

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

export async function runPaxTool(ctx: McpContext, name: unknown, rawArgs: string | undefined | null, env: PaxToolEnv = {}): Promise<ToolOutcome> {
  if (!isOffered(name, env)) return { ok: false, text: `Refused: ${String(name)} is not available in PAX Console in this conversation.` };

  let args: Record<string, unknown> = {};
  if (rawArgs && rawArgs.trim()) {
    let parsed: unknown;
    try { parsed = JSON.parse(rawArgs); } catch { return { ok: false, text: "Refused: the arguments were not valid JSON." }; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, text: "Refused: the arguments must be a JSON object." };
    args = parsed as Record<string, unknown>;
  }

  if (name === "analyze") return runAnalyze(ctx, args);

  if (name === "api_write") {
    const checked = checkProposal(args);
    if (checked.ok === false) return { ok: false, text: `Refused: ${checked.reason}` };
    return env.propose!(checked.proposal);
  }

  if (name === "qbo_api" && String(args.method ?? "GET").toUpperCase() !== "GET") {
    return { ok: false, text: "Refused: PAX Console can only read from QuickBooks. Tell the user to make that change in QuickBooks or in the app." };
  }
  // Employee records hold SSNs and dates of birth; the app's own routes refuse them for AI, so this does too.
  if (name === "qbo_api" && /\bemployee\b|taxidentifier/i.test(JSON.stringify([args.path, args.query]))) {
    return { ok: false, text: "Refused: employee records hold personal identifiers and are not available to PAX Console." };
  }

  const result = await callTool(name, args, ctx);
  let text = result.content.map((c) => c.text).join("\n");
  // The QuickBooks API redacts credentials only. Here the answer goes to a third-party model, so it gets
  // the same personal-identifier redaction as every app route (SSN, date of birth, tax ids).
  if (name === "qbo_api") text = redactText(text, "personal").text;
  return { ok: !result.isError, text: cut(text) };
}
