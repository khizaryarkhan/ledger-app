// One PAX Console message: stored, sent to the USER'S OWN model, and answered.
//
// The reply streams as newline-delimited JSON, one event per line:
//   {type:"conversation", id}            the conversation this belongs to
//   {type:"tool", name, args}            the model is looking something up
//   {type:"tool_done", name, ok, summary}
//   {type:"text", text}                  the answer
//   {type:"done"} | {type:"error", message}
//
// Everything the model reads, it reads as the signed-in user (lib/pax/context.ts),
// and this version offers it no tool that can change anything (lib/pax/tools.ts).
//
// What is stored is the conversation's WORDS: the user's messages, the model's
// answers and which lookups it made. Tool results (the data itself) are never
// stored and never replayed — they were read under the access the user had at
// that moment, and the model reads again under today's.

import { NextRequest } from "next/server";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { organisations, paxConversations, paxMessages } from "@/db/schema";
import { bad, requireOrg } from "@/lib/api";
import { today } from "@/lib/format";
import { rateLimit } from "@/lib/rate-limit";
import { runAgent, textOnlyHistory, type ChatMessage } from "@/lib/pax/agent";
import { describeProviderError, makeClient } from "@/lib/pax/client";
import { paxToolContext } from "@/lib/pax/context";
import { isAiCall, sameOrigin, userIdOf } from "@/lib/pax/http";
import { acquire } from "@/lib/pax/inflight";
import { getSecretModel } from "@/lib/pax/keys";
import { buildSystemPrompt } from "@/lib/pax/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A model may take several steps, each reading from the app.
export const maxDuration = 120;

const HISTORY_LIMIT = 60;
const MAX_CONVERSATIONS = 200;
const MAX_MESSAGES = 400;
const Body = z.object({
  conversationId: z.string().uuid().optional(),
  message: z.string().trim().min(1, "Type a message first.").max(4000, "That message is too long."),
});

const titleOf = (m: string): string => m.replace(/\s+/g, " ").slice(0, 60);
const countOf = (rows: { n: number }[]): number => Number(rows[0]?.n ?? 0);

export async function POST(req: NextRequest) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (isAiCall(session)) return bad("PAX Console cannot be driven by an AI connection.", 403);
  if (!sameOrigin(req)) return bad("Cross-origin request refused", 403);
  const userId = userIdOf(session);

  const limited = await rateLimit(`pax-chat:${userId}`, 30, 300);
  if (!limited.ok) return bad("You are sending messages quickly. Wait a moment and try again.", 429);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Check the message and try again.");
  const { message } = parsed.data;

  const model = await getSecretModel(userId);
  if (!model) return bad("Connect a model first. Open Your model and add your key.", 400);

  let conversationId = parsed.data.conversationId;
  if (conversationId) {
    const [c] = await db.select({ id: paxConversations.id }).from(paxConversations)
      .where(and(eq(paxConversations.id, conversationId), eq(paxConversations.userId, userId), eq(paxConversations.orgId, orgId!))).limit(1);
    if (!c) return bad("Conversation not found.", 404);
    const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(paxMessages).where(eq(paxMessages.conversationId, conversationId));
    if (Number(n) >= MAX_MESSAGES) return bad("This conversation is full. Start a new chat.", 400);
  } else {
    const owned = await db.select({ n: sql<number>`count(*)::int` }).from(paxConversations)
      .where(and(eq(paxConversations.userId, userId), eq(paxConversations.orgId, orgId!)));
    if (countOf(owned) >= MAX_CONVERSATIONS) return bad("You have a lot of conversations. Delete some old ones first.", 400);
  }

  // From here a slot is held until the answer is finished: two answers racing in
  // one conversation would interleave what is stored.
  const releaseUser = acquire(`user:${userId}`);
  if (!releaseUser) return bad("You already have messages being answered. Wait for them to finish.", 429);

  let convId: string;
  let history: ChatMessage[];
  let system: string;
  const userMessage: ChatMessage = { role: "user", content: message };
  const base = Date.now();
  let releaseConv: (() => void) | null = null;
  const releaseAll = () => { releaseUser(); releaseConv?.(); };
  try {
    if (conversationId) {
      convId = conversationId;
    } else {
      const [c] = await db.insert(paxConversations).values({ orgId: orgId!, userId, title: titleOf(message) }).returning({ id: paxConversations.id });
      convId = c.id;
    }
    releaseConv = acquire(`conv:${convId}`, 1);
    if (!releaseConv) { releaseUser(); return bad("That conversation is already being answered.", 429); }

    // Newest 60, words only, starting at a user message.
    const rows = await db.select({ message: paxMessages.message }).from(paxMessages)
      .where(eq(paxMessages.conversationId, convId)).orderBy(desc(paxMessages.createdAt)).limit(HISTORY_LIMIT);
    history = textOnlyHistory(rows.reverse().map((r) => r.message as ChatMessage));
    const firstUser = history.findIndex((m) => m.role === "user");
    history = firstUser === -1 ? [] : history.slice(firstUser);

    // Stored first, so what the user typed is kept even if the model then fails.
    await db.insert(paxMessages).values({ conversationId: convId, role: "user", message: userMessage, createdAt: new Date(base) });

    const [org] = await db.select({
      name: organisations.name, displayName: organisations.displayName, currency: organisations.currency,
      enabledModules: organisations.enabledModules, fiscalYearStartMonth: organisations.fiscalYearStartMonth,
    }).from(organisations).where(eq(organisations.id, orgId!)).limit(1);

    // One line per lookup made earlier in this conversation: what was looked up, never what came back.
    const noteRows = await db.select({ message: paxMessages.message }).from(paxMessages)
      .where(and(eq(paxMessages.conversationId, convId), eq(paxMessages.role, "note")))
      .orderBy(desc(paxMessages.createdAt)).limit(6);
    const lookups = noteRows.reverse()
      .flatMap((r) => String((r.message as { content?: unknown })?.content ?? "").split("\n"))
      .filter(Boolean)
      .slice(-30);

    system = buildSystemPrompt({
      lookups,
      userName: (session?.user as { name?: string | null } | undefined)?.name ?? null,
      role: role ?? "user",
      orgName: org?.displayName || org?.name || "this organisation",
      homeCurrency: org?.currency ?? "",
      enabledModules: org?.enabledModules,
      fiscalYearStartMonth: org?.fiscalYearStartMonth ?? null,
      today: today(),
    });
  } catch (e) {
    releaseAll();
    throw e;
  }
  const ctx = paxToolContext({ requestUrl: req.url, userId, orgId: orgId! });
  const id = convId;

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: Record<string, unknown>) => { try { controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`)); } catch { /* the reader went away */ } };
      const store = (messages: ChatMessage[]) => db.insert(paxMessages).values(messages.map((m, i) => ({
        conversationId: id, role: m.role, message: m, createdAt: new Date(base + 1 + i),
      })));
      send({ type: "conversation", id });
      try {
        const client = await makeClient({ provider: model.provider, baseUrl: model.baseUrl, apiKey: model.apiKey });
        const result = await runAgent({ client, model: model.model, system, history: [...history, userMessage], ctx, emit: (e) => send(e), signal: req.signal });
        // The words and the lookups, not what the lookups returned.
        const words: ChatMessage[] = result.produced.filter((m) => m.role !== "tool");
        // Lookup labels ride along as a `note` row after the words; history and the screen ignore that role.
        if (result.notes.length) words.push({ role: "note" as never, content: result.notes.join("\n").slice(0, 1200) });
        await store(words);
        send({ type: "done" });
      } catch (e) {
        const msg = describeProviderError(e, [model.apiKey]);
        // Keep the conversation readable and alternating: say what happened where the answer would be.
        await store([{ role: "assistant", content: `I could not answer: ${msg}` }]).catch(() => {});
        send({ type: "error", message: msg });
      } finally {
        await db.update(paxConversations).set({ updatedAt: new Date() }).where(eq(paxConversations.id, id)).catch(() => {});
        releaseAll();
        try { controller.close(); } catch { /* already closed by the client */ }
      }
    },
    cancel() { /* the client left; runAgent notices req.signal and stops */ },
  });

  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
}
