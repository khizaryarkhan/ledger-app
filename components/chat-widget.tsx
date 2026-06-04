"use client";

import { useState, useRef, useEffect } from "react";
import { MessageCircle, X, Send, Bot, User, Loader2 } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
}

const SUGGESTIONS = [
  "What should I chase today?",
  "What should I do about Reddy Architecture?",
  "Show me the aging breakdown",
  "Send open invoices of Project X to billing@client.com",
];

export function ChatWidget() {
  const [open, setOpen]       = useState(false);
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: "assistant",
      content: "Hi! I'm your AR assistant. You can ask me things like:\n\n• \"Send all open invoices of Project X to abc@example.com CC finance@example.com\"\n• \"What's overdue for Acme Corp?\"\n• \"AR summary for Project Lighthouse\"",
    },
  ]);

  const bottomRef  = useRef<HTMLDivElement>(null);
  const inputRef   = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || loading) return;

    const userMsg: Message = { role: "user", content: trimmed };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmed,
          history: next.slice(-6).map(m => ({ role: m.role, content: m.content })),
        }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.reply ?? "Something went wrong." }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Network error — please try again." }]);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  }

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-5 right-5 z-50 flex items-center gap-2 bg-stone-900 text-white pl-4 pr-5 py-3 rounded-full shadow-lg hover:bg-stone-700 transition-all duration-200 group"
          aria-label="Open AI assistant"
        >
          <MessageCircle size={18} />
          <span className="text-sm font-medium">Ask AI</span>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-5 right-5 z-50 w-[400px] max-h-[600px] flex flex-col bg-white rounded-2xl shadow-2xl ring-1 ring-stone-200 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 bg-stone-900 text-white shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-7 h-7 rounded-full bg-stone-700 flex items-center justify-center">
                <Bot size={14} />
              </div>
              <div>
                <div className="text-sm font-semibold leading-none">AR Assistant</div>
                <div className="text-[10px] text-stone-400 mt-0.5">Powered by GPT-4o</div>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="p-1.5 rounded-md hover:bg-stone-700 transition-colors"
              aria-label="Close"
            >
              <X size={15} />
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-2.5 ${m.role === "user" ? "flex-row-reverse" : "flex-row"}`}>
                {/* Avatar */}
                <div className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center mt-0.5 ${
                  m.role === "user" ? "bg-stone-900" : "bg-stone-100"
                }`}>
                  {m.role === "user"
                    ? <User size={12} className="text-white" />
                    : <Bot size={12} className="text-stone-500" />
                  }
                </div>

                {/* Bubble */}
                <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-stone-900 text-white rounded-tr-sm"
                    : "bg-stone-100 text-stone-800 rounded-tl-sm"
                }`}>
                  {m.content.replace(/\[__PENDING__:[^\]]*\]/g, "").trim()}
                </div>
              </div>
            ))}

            {/* Loading indicator */}
            {loading && (
              <div className="flex gap-2.5">
                <div className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center shrink-0">
                  <Bot size={12} className="text-stone-500" />
                </div>
                <div className="bg-stone-100 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                  <Loader2 size={14} className="text-stone-400 animate-spin" />
                </div>
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Suggestions — only show when just the welcome message */}
          {messages.length === 1 && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5 shrink-0">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="text-[11px] bg-stone-100 hover:bg-stone-200 text-stone-600 px-2.5 py-1 rounded-full transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="px-3 pb-3 pt-2 border-t border-stone-100 shrink-0">
            <div className="flex items-center gap-2 bg-stone-100 rounded-xl px-3 py-2">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything about your AR…"
                disabled={loading}
                className="flex-1 bg-transparent text-sm text-stone-800 placeholder:text-stone-400 outline-none disabled:opacity-50"
              />
              <button
                onClick={() => send(input)}
                disabled={!input.trim() || loading}
                className="shrink-0 w-7 h-7 rounded-lg bg-stone-900 text-white flex items-center justify-center disabled:opacity-30 hover:bg-stone-700 transition-colors"
                aria-label="Send"
              >
                <Send size={13} />
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
