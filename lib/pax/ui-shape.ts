// Turns stored OpenAI-format messages into what the chat screen draws: the
// user's words, a chip for each thing the assistant looked up, and its answer.
// Tool results and the system prompt are not shown — they are working material.

/** A change the model proposed, as the screen draws it. `body` is what will actually be sent. */
export interface UiAction {
  id: string;
  method: string;
  path: string;
  query: unknown;
  body: unknown;
  summary: string;
  /** pending | running | applied | rejected | expired | failed */
  status: string;
  result: string | null;
}

export type UiBlock =
  | { kind: "user"; text: string }
  | { kind: "tool"; label: string }
  | { kind: "assistant"; text: string }
  | ({ kind: "action" } & UiAction);

const MAX_LABEL = 90;

export function toolLabel(name: string, rawArgs: unknown): string {
  let args: Record<string, unknown> = {};
  try { const v = JSON.parse(String(rawArgs ?? "{}")); if (v && typeof v === "object") args = v; } catch { /* label from the name alone */ }
  if (name === "api_get" && typeof args.path === "string") return `Read ${args.path}`.slice(0, MAX_LABEL);
  if (name === "list_api_routes") return `Looked up endpoints${typeof args.search === "string" && args.search ? ` for "${args.search}"` : ""}`.slice(0, MAX_LABEL);
  if (name === "analyze") return `Analysed ${typeof args.dataset === "string" ? args.dataset : "data"}${typeof args.groupBy === "string" ? ` by ${args.groupBy}` : ""}`.slice(0, MAX_LABEL);
  if (name === "qbo_api") return `QuickBooks ${typeof args.method === "string" ? args.method : "read"} ${typeof args.path === "string" ? args.path : ""}`.trim().slice(0, MAX_LABEL);
  if (name === "api_write") return `Proposed ${typeof args.method === "string" ? args.method : "a change"} ${typeof args.path === "string" ? args.path : ""}`.trim().slice(0, MAX_LABEL);
  if (name === "whoami") return "Checked who you are";
  return name.slice(0, MAX_LABEL);
}

/**
 * Messages in order, with each proposal card placed after the last message stored before it
 * was made. A card is created while its turn runs, so it lands after that turn's answer and
 * before the next question, which is where a person expects to find it.
 */
export function toUiBlocks(rows: { message: unknown; createdAt?: Date | string }[], actions: (UiAction & { createdAt: Date | string })[] = []): UiBlock[] {
  const out: UiBlock[] = [];
  const pending = [...actions].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
  const flush = (before: number | null) => {
    while (pending.length && (before === null || +new Date(pending[0].createdAt) < before)) {
      const { createdAt: _c, ...a } = pending.shift()!;
      out.push({ kind: "action", ...a });
    }
  };
  for (const r of rows) {
    if (r.createdAt !== undefined) flush(+new Date(r.createdAt));
    const m = r.message as { role?: string; content?: unknown; tool_calls?: { function?: { name?: string; arguments?: unknown } }[] } | null;
    if (!m) continue;
    if (m.role === "user" && typeof m.content === "string") out.push({ kind: "user", text: m.content });
    else if (m.role === "assistant") {
      for (const c of m.tool_calls ?? []) if (c.function?.name) out.push({ kind: "tool", label: toolLabel(c.function.name, c.function.arguments) });
      if (typeof m.content === "string" && m.content.trim()) out.push({ kind: "assistant", text: m.content });
    }
  }
  flush(null);
  return out;
}
