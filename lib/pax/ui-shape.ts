// Turns stored OpenAI-format messages into what the chat screen draws: the
// user's words, a chip for each thing the assistant looked up, and its answer.
// Tool results and the system prompt are not shown — they are working material.

export type UiBlock =
  | { kind: "user"; text: string }
  | { kind: "tool"; label: string }
  | { kind: "assistant"; text: string };

const MAX_LABEL = 90;

export function toolLabel(name: string, rawArgs: unknown): string {
  let args: Record<string, unknown> = {};
  try { const v = JSON.parse(String(rawArgs ?? "{}")); if (v && typeof v === "object") args = v; } catch { /* label from the name alone */ }
  if (name === "api_get" && typeof args.path === "string") return `Read ${args.path}`.slice(0, MAX_LABEL);
  if (name === "list_api_routes") return `Looked up endpoints${typeof args.search === "string" && args.search ? ` for "${args.search}"` : ""}`.slice(0, MAX_LABEL);
  if (name === "whoami") return "Checked who you are";
  return name.slice(0, MAX_LABEL);
}

export function toUiBlocks(rows: { message: unknown }[]): UiBlock[] {
  const out: UiBlock[] = [];
  for (const r of rows) {
    const m = r.message as { role?: string; content?: unknown; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] } | null;
    if (!m) continue;
    if (m.role === "user" && typeof m.content === "string") out.push({ kind: "user", text: m.content });
    else if (m.role === "assistant") {
      for (const c of m.tool_calls ?? []) if (c.function?.name) out.push({ kind: "tool", label: toolLabel(c.function.name, c.function.arguments) });
      if (typeof m.content === "string" && m.content.trim()) out.push({ kind: "assistant", text: m.content });
    }
  }
  return out;
}
