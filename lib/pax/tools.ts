// The tools PAX Console offers a model. They are NOT new tools: they are the
// MCP server's own (lib/mcp/server.ts), run through the same `callTool`, so the
// route deny-list, redaction, paging and — above all — the replay of every call
// under the signed-in user's own role are the very same code for both doors.
//
// Phase 1 is read-only. A write tool is not merely hidden from the model: a
// call to anything outside this list is refused here even if a model invents it.

import { callTool, toolsFor, type McpContext } from "@/lib/mcp/server";

export const PAX_READ_TOOLS = ["whoami", "list_api_routes", "api_get"] as const;
export type PaxToolName = (typeof PAX_READ_TOOLS)[number];

export const isPaxReadTool = (name: unknown): name is PaxToolName =>
  typeof name === "string" && (PAX_READ_TOOLS as readonly string[]).includes(name);

/** More than this reaches a model only as noise, and a small model's context is small. */
export const MAX_TOOL_CHARS = 24_000;

export interface OpenAiTool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export function paxToolDefs(): OpenAiTool[] {
  return toolsFor(["mcp:read"])
    .filter((t) => isPaxReadTool(t.name))
    .map((t) => ({ type: "function" as const, function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
}

export type ToolOutcome = { ok: boolean; text: string };

export async function runPaxTool(ctx: McpContext, name: unknown, rawArgs: string | undefined | null): Promise<ToolOutcome> {
  if (!isPaxReadTool(name)) return { ok: false, text: `Refused: ${String(name)} is not available in PAX Console. This version can only read.` };

  let args: Record<string, unknown> = {};
  if (rawArgs && rawArgs.trim()) {
    let parsed: unknown;
    try { parsed = JSON.parse(rawArgs); } catch { return { ok: false, text: "Refused: the arguments were not valid JSON." }; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, text: "Refused: the arguments must be a JSON object." };
    args = parsed as Record<string, unknown>;
  }

  const result = await callTool(name, args, ctx);
  const text = result.content.map((c) => c.text).join("\n");
  const cut = text.length > MAX_TOOL_CHARS;
  return {
    ok: !result.isError,
    text: cut ? `${text.slice(0, MAX_TOOL_CHARS)}\n[cut for the model: ask for fewer fields (fields) or a narrower query (limit, offset, filters)]` : text,
  };
}
