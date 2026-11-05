"use client";

// PAX Console: a chat with your books, using your own AI model. Everything it
// reads, it reads as you — the same permissions as the rest of the app.
// This version only reads; changes are a later phase and will always ask first.

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, MessageSquarePlus, Send, Settings2, Trash2, Database } from "lucide-react";
import { useData } from "@/components/data-provider";
import { PaxModelSettings } from "@/components/pax-model-settings";
import { hasModule, type ModuleKey } from "@/lib/modules";
import { toolLabel, type UiBlock } from "@/lib/pax/ui-shape";
import { providerById } from "@/lib/pax/providers";
import type { PublicModel } from "@/lib/pax/keys";

type Convo = { id: string; title: string; updatedAt: string };
type Shown = UiBlock | { kind: "error"; text: string };

const IDEAS: { area: string; module: ModuleKey; prompts: string[] }[] = [
  { area: "Receivables", module: "receivables", prompts: ["Which invoices are overdue by more than 60 days?", "Which customers owe us the most right now?"] },
  { area: "Payables", module: "payables", prompts: ["Which bills are due this week?", "Show supplier balances that are over 30 days old"] },
  { area: "Accounting", module: "accounting", prompts: ["What was net profit this financial year to date?", "Show the trial balance as at last month end"] },
  { area: "Supply chain", module: "manufacturing", prompts: ["Which purchase orders are late?", "Which items are below their minimum stock?"] },
  { area: "Resources", module: "resources", prompts: ["Who has unapproved timesheets?", "Which projects are over their planned hours?"] },
];

function Bubble({ block }: { block: Shown }) {
  if (block.kind === "user") {
    return <div className="self-end max-w-[80%] rounded-lg bg-stone-800 px-3 py-2 text-[13px] text-stone-100 whitespace-pre-wrap">{block.text}</div>;
  }
  if (block.kind === "tool") {
    return (
      <div className="self-start inline-flex items-center gap-1.5 rounded-lg border border-stone-700 px-2 py-0.5 text-[11px] text-stone-400">
        <Database size={11} />{block.label}
      </div>
    );
  }
  if (block.kind === "error") return <p className="text-[13px] text-red-400 max-w-[68ch]">{block.text}</p>;
  return <p className="text-[15px] leading-relaxed text-stone-200 whitespace-pre-wrap max-w-[68ch]">{block.text}</p>;
}

export function PaxConsole() {
  const { orgSettings } = useData();
  const [tab, setTab] = useState<"chat" | "model">("chat");
  const [model, setModel] = useState<PublicModel | null | undefined>(undefined);
  const [convos, setConvos] = useState<Convo[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Shown[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const busyRef = useRef(false); // set synchronously, so a double Enter cannot send twice before the state re-renders
  const openSeq = useRef(0);

  const loadConvos = useCallback(async () => {
    try {
      const j = await (await fetch("/api/pax-console/conversations")).json();
      setConvos(j.conversations ?? []);
    } catch { /* the list is a convenience */ }
  }, []);

  useEffect(() => {
    fetch("/api/pax-console/settings").then((r) => r.json()).then((j) => setModel(j.model ?? null)).catch(() => setModel(null));
    loadConvos();
  }, [loadConvos]);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [blocks]);

  async function open(id: string) {
    if (busy) return;
    setTab("chat");
    const seq = ++openSeq.current;
    try {
      const j = await (await fetch(`/api/pax-console/conversations/${id}`)).json();
      if (seq !== openSeq.current) return; // a newer click won
      setActiveId(id);
      setBlocks(j.blocks ?? []);
    } catch {
      setBlocks([{ kind: "error", text: "Could not open that conversation." }]);
    }
  }

  function fresh() {
    if (busy) return;
    setActiveId(null);
    setBlocks([]);
    setTab("chat");
  }

  async function removeConvo(id: string) {
    if (busy) return; // deleting the conversation being answered would leave this screen pointing at nothing
    if (confirmId !== id) return setConfirmId(id);
    setConfirmId(null);
    await fetch(`/api/pax-console/conversations/${id}`, { method: "DELETE" });
    if (activeId === id) { setActiveId(null); setBlocks([]); }
    loadConvos();
  }

  function handle(ev: Record<string, any>) {
    if (ev.type === "conversation") setActiveId(ev.id);
    else if (ev.type === "tool") setBlocks((b) => [...b, { kind: "tool", label: toolLabel(ev.name, JSON.stringify(ev.args ?? {})) }]);
    else if (ev.type === "tool_done" && !ev.ok) {
      // Say so on the lookup's own chip: a refused read must not look like a successful one.
      setBlocks((b) => {
        const last = b.map((x) => x.kind).lastIndexOf("tool");
        return last < 0 ? b : b.map((x, i) => (i === last && x.kind === "tool" ? { ...x, label: `${x.label} (refused or failed)` } : x));
      });
    }
    else if (ev.type === "text" && ev.text) setBlocks((b) => [...b, { kind: "assistant", text: ev.text }]);
    else if (ev.type === "error") setBlocks((b) => [...b, { kind: "error", text: ev.message }]);
  }

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setDraft("");
    setBlocks((b) => [...b, { kind: "user", text: message }]);
    try {
      const res = await fetch("/api/pax-console/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: activeId ?? undefined, message }),
      });
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "Something went wrong. Try again.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (line) { try { handle(JSON.parse(line)); } catch { /* a partial line is finished by the next read */ } }
        }
      }
    } catch (e) {
      setBlocks((b) => [...b, { kind: "error", text: e instanceof Error ? e.message : "Something went wrong. Try again." }]);
    } finally {
      busyRef.current = false;
      setBusy(false);
      loadConvos();
    }
  }

  const ideas = IDEAS.filter((i) => hasModule(orgSettings?.enabledModules, i.module));
  const notConnected = model === null;
  const label = model ? `${providerById(model.provider)?.label ?? model.provider} · ${model.model}` : null;
  const tabBtn = (on: boolean) => `h-8 px-3 rounded-lg text-[12px] ${on ? "bg-stone-700 text-stone-100" : "text-stone-400 hover:text-stone-200 hover:bg-stone-800"}`;

  return (
    <div className="flex flex-col h-[calc(100vh-44px)]">
      <div className="px-6 py-4 border-b border-stone-800 bg-stone-950 flex-shrink-0 flex flex-wrap items-center gap-4">
        <div>
          <h1 className="text-[20px] font-semibold text-white tracking-tight">PAX Console</h1>
          <p className="text-[13px] text-stone-400 mt-0.5">Ask about your books in plain words. You see only what your role allows.</p>
        </div>
        <div className="flex items-center gap-1 ml-2">
          <button type="button" aria-pressed={tab === "chat"} className={tabBtn(tab === "chat")} onClick={() => setTab("chat")}>Chat</button>
          <button type="button" aria-pressed={tab === "model"} className={tabBtn(tab === "model")} onClick={() => setTab("model")}>Your model</button>
        </div>
        <div className="flex-1" />
        {label && <span className="text-[12px] text-stone-400 border border-stone-700 rounded-lg px-2.5 py-1">{label}</span>}
        <span className="text-[12px] text-emerald-400 bg-emerald-500/10 rounded-lg px-2.5 py-1">Read only</span>
      </div>

      {tab === "model" ? (
        <PaxModelSettings model={model ?? null} onChange={setModel} />
      ) : (
        <div className="flex flex-1 min-h-0">
          <aside className="hidden md:flex w-60 flex-shrink-0 flex-col border-r border-stone-800 bg-stone-950/60">
            <div className="p-3">
              <button type="button" onClick={fresh} className="w-full h-8 rounded-lg border border-stone-700 text-[13px] text-stone-200 hover:border-stone-600 inline-flex items-center justify-center gap-2">
                <MessageSquarePlus size={14} />New chat
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-0.5">
              {convos.length === 0 && <p className="px-2 py-1 text-[12px] text-stone-500">Your conversations appear here.</p>}
              {convos.map((c) => (
                <div key={c.id} className={`group flex items-center gap-1 rounded-lg ${activeId === c.id ? "bg-stone-800" : "hover:bg-stone-900"}`}>
                  <button type="button" onClick={() => open(c.id)} className="flex-1 min-w-0 text-left px-2 py-1.5 text-[13px] text-stone-300 truncate">{c.title}</button>
                  <button type="button" aria-label={confirmId === c.id ? "Click again to delete" : "Delete conversation"} onClick={() => removeConvo(c.id)}
                    className={`mr-1 p-1 rounded-lg text-[11px] ${confirmId === c.id ? "text-red-400" : "text-stone-500 opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-400"}`}>
                    {confirmId === c.id ? "Delete?" : <Trash2 size={12} />}
                  </button>
                </div>
              ))}
            </div>
          </aside>

          <section className="flex-1 min-w-0 flex flex-col">
            <div className="flex-1 overflow-y-auto px-6 py-6">
              <div className="max-w-3xl mx-auto flex flex-col gap-4" aria-live="polite">
                {notConnected && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-200 flex flex-wrap items-center gap-3">
                    Connect your AI model to start chatting.
                    <button type="button" onClick={() => setTab("model")} className="h-7 px-3 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-100 inline-flex items-center gap-2"><Settings2 size={13} />Your model</button>
                  </div>
                )}

                {blocks.length === 0 ? (
                  <div className="pt-6">
                    <h2 className="text-[20px] font-semibold text-white tracking-tight">What do you want to know?</h2>
                    <p className="text-[13px] text-stone-400 mt-1 mb-5 max-w-xl">
                      I already know every function in Prime Accountax. Ask in plain words. I read your data as you, so I only see what your role allows, and this version cannot change anything.
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {ideas.map((i) => (
                        <div key={i.area} className="rounded-lg border border-stone-800 bg-stone-900/50 p-3">
                          <p className="text-[11px] font-medium uppercase tracking-wider text-stone-500 mb-1.5">{i.area}</p>
                          {i.prompts.map((p) => (
                            <button key={p} type="button" onClick={() => send(p)} disabled={notConnected || busy}
                              className="block w-full text-left px-2 py-1.5 -mx-1 rounded-lg text-[13px] text-stone-300 hover:bg-stone-800 disabled:opacity-50">{p}</button>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  blocks.map((b, i) => <Bubble key={i} block={b} />)
                )}
                {busy && <div className="self-start inline-flex items-center gap-2 text-[12px] text-stone-500"><Loader2 size={13} className="animate-spin" />Working on it</div>}
                <div ref={endRef} />
              </div>
            </div>

            <form className="px-6 pb-4 pt-2 flex-shrink-0" onSubmit={(e) => { e.preventDefault(); send(draft); }}>
              <div className="max-w-3xl mx-auto rounded-lg border border-stone-700 bg-stone-900 focus-within:border-emerald-500 p-2 flex items-end gap-2">
                <textarea
                  aria-label="Message" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(draft); } }}
                  placeholder={notConnected ? "Connect your model first" : "Ask about invoices, customers, or your books"}
                  className="flex-1 resize-none bg-transparent outline-none text-[13px] text-stone-100 placeholder:text-stone-600 px-1 py-1" />
                <button type="submit" aria-label="Send" disabled={busy || notConnected || !draft.trim()}
                  className="h-8 w-8 flex-shrink-0 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white inline-flex items-center justify-center disabled:opacity-40">
                  <Send size={14} />
                </button>
              </div>
              <p className="max-w-3xl mx-auto mt-1.5 text-[11px] text-stone-500 text-center">Answers come from your own model and your live data. Check important figures before you act on them.</p>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
