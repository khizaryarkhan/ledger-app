// The conversation loop: send the history to the user's model, run whatever
// tools it asks for, feed the results back, and stop when it answers in words.
//
// The model client is injected, so the loop is proven in tests with a fake one
// and no network. Nothing here knows about HTTP, the database or the app's
// permissions — those live in the tool context it is given.

import type { McpContext } from "@/lib/mcp/server";
import { paxToolDefs, runPaxTool } from "./tools";
import { toolLabel } from "./ui-shape";

export const MAX_STEPS = 6;
/** A model that asks for dozens of calls at once is looping; answer the first few, refuse the rest. */
export const MAX_CALLS_PER_STEP = 3;
/** Stop starting new work this long after a turn begins, so the turn can still be saved before the platform's own limit. */
export const TURN_BUDGET_MS = 100_000;

const EMPTY_ANSWER = "I could not produce an answer. Try rephrasing the question.";
const OUT_OF_TIME = "I ran out of time before I could finish. Ask me to continue, or narrow the question.";
const STEP_LIMIT = "I reached my step limit before I could finish. Ask me to continue, or narrow the question.";

export interface ChatClient {
  chat: { completions: { create(body: Record<string, unknown>, opts?: { signal?: AbortSignal }): Promise<any> } };
}

/** An OpenAI-format message. Kept loose: it is stored and replayed as-is. */
export type ChatMessage = Record<string, any> & { role: "system" | "user" | "assistant" | "tool" };

export type AgentEvent =
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "tool_done"; name: string; ok: boolean; summary: string }
  | { type: "text"; text: string };

export interface AgentResult {
  /** Only the messages this turn added — the caller stores them. */
  produced: ChatMessage[];
  finalText: string;
  steps: number;
  /** One line per lookup made, kept between messages so a follow-up is not blind. Never the data itself. */
  notes: string[];
}

/**
 * What an earlier turn contributes to a later one: the words only. Tool results
 * are never replayed. They were read under the access the user had THEN, so
 * replaying them after a demotion would hand the model data the user can no
 * longer see — and the model simply reads again, under today's access.
 */
export function textOnlyHistory(messages: ChatMessage[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if ((m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim()) {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}

const firstLine = (t: string): string => (t.split("\n", 1)[0] ?? "").slice(0, 100);

function safeArgs(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") return {};
  try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
}

export async function runAgent(opts: {
  client: ChatClient;
  model: string;
  system: string;
  history: ChatMessage[];
  ctx: McpContext;
  emit: (e: AgentEvent) => void;
  maxSteps?: number;
  signal?: AbortSignal;
  /** Epoch ms after which no new step starts. */
  deadline?: number;
}): Promise<AgentResult> {
  const produced: ChatMessage[] = [];
  const notes: string[] = [];
  const tools = paxToolDefs();
  const maxSteps = opts.maxSteps ?? MAX_STEPS;
  const deadline = opts.deadline ?? Date.now() + TURN_BUDGET_MS;

  const finish = (text: string, steps: number): AgentResult => {
    produced.push({ role: "assistant", content: text });
    opts.emit({ type: "text", text });
    return { produced, finalText: text, steps, notes };
  };

  for (let step = 1; step <= maxSteps; step++) {
    if (opts.signal?.aborted) throw new Error("Cancelled.");
    if (Date.now() > deadline) return finish(OUT_OF_TIME, step - 1);

    const res = await opts.client.chat.completions.create(
      {
        model: opts.model,
        messages: [{ role: "system", content: opts.system }, ...opts.history, ...produced],
        tools,
        tool_choice: "auto",
      },
      { signal: opts.signal },
    );
    const msg = res?.choices?.[0]?.message;
    if (!msg) throw new Error("The model returned no answer.");

    // A provider that omits a call's id would get a reply nobody can match; give it one.
    const raw: any[] = Array.isArray(msg.tool_calls) ? msg.tool_calls.filter((c: any) => c?.function?.name) : [];
    const calls = raw.map((c, i) => ({ id: String(c.id || `call_${step}_${i}`), name: String(c.function.name), args: c.function.arguments ?? "{}" }));

    if (!calls.length) {
      const text = typeof msg.content === "string" && msg.content.trim() ? msg.content : EMPTY_ANSWER;
      produced.push({ role: "assistant", content: text });
      opts.emit({ type: "text", text });
      return { produced, finalText: text, steps: step, notes };
    }

    produced.push({
      role: "assistant",
      content: msg.content ?? null,
      tool_calls: calls.map((c) => ({ id: c.id, type: "function", function: { name: c.name, arguments: c.args } })),
    });

    // Every tool call must be answered, or the next request is rejected by the API.
    for (let i = 0; i < calls.length; i++) {
      const c = calls[i];
      if (i >= MAX_CALLS_PER_STEP) {
        produced.push({ role: "tool", tool_call_id: c.id, content: "Skipped: too many tool calls at once. Ask for fewer, one step at a time." });
        continue;
      }
      if (opts.signal?.aborted) throw new Error("Cancelled.");
      opts.emit({ type: "tool", name: c.name, args: safeArgs(c.args) });
      const out = await runPaxTool(opts.ctx, c.name, c.args);
      opts.emit({ type: "tool_done", name: c.name, ok: out.ok, summary: firstLine(out.text) });
      notes.push(`${toolLabel(c.name, c.args)} (${out.ok ? firstLine(out.text) : "refused or failed"})`);
      produced.push({ role: "tool", tool_call_id: c.id, content: out.text });
    }
  }

  return finish(STEP_LIMIT, maxSteps);
}
