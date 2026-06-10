"use client";

import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";

const FEATURES = [
  {
    grad: "from-emerald-400/20 to-emerald-600/5",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    title: "Live Collections Board",
    desc: "See every outstanding invoice in one view. Filter by customer, region, rep, project, due date, or stage, and bulk-send reminders in seconds.",
  },
  {
    grad: "from-teal-400/20 to-teal-600/5",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
      </svg>
    ),
    title: "QuickBooks & Xero Sync",
    desc: "Invoices, customers, projects, contacts, and payments sync automatically from QuickBooks Online and Xero — always current, zero manual entry.",
  },
  {
    grad: "from-emerald-400/20 to-teal-600/5",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
      </svg>
    ),
    title: "Automated Reminders",
    desc: "Schedule branded collection emails via Gmail, Microsoft 365, or SMTP with smart follow-up sequences — every message tracked with a unique reference.",
  },
  {
    grad: "from-teal-400/20 to-emerald-600/5",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
      </svg>
    ),
    title: "Customer Self-Service Portal",
    desc: "Customers get a secure link to view invoices, set a payment promise date, pay, or raise a dispute — no login required.",
  },
  {
    grad: "from-emerald-400/20 to-emerald-600/5",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
    ),
    title: "AI Collections Assistant",
    desc: "Ask what needs attention, who owes the most, or which invoices are overdue — then trigger the next action instantly, in plain language.",
  },
  {
    grad: "from-teal-400/20 to-teal-600/5",
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
    title: "Team & Rep Management",
    desc: "Assign invoices to reps, track follow-ups by region, project, or team, and maintain clear ownership visibility across the whole pipeline.",
  },
];

const STEPS = [
  { n: "01", title: "Connect QuickBooks or Xero", desc: "One-click accounting sync pulls invoices, customers, contacts, projects, and payment data into Prime Accountax." },
  { n: "02", title: "Set Your Workflow", desc: "Configure email sequences, assign reps, define collection stages, and set escalation rules." },
  { n: "03", title: "Chase Automatically", desc: "Overdue invoices are followed up on schedule, while your team gets notified of replies, disputes, and payment promises." },
  { n: "04", title: "Close Faster", desc: "Track promises, resolve disputes, reduce DSO, and keep every stakeholder aligned." },
];

const ROLES = [
  {
    title: "Customer",
    desc: "View invoices, pay, promise a date, or raise a dispute.",
    accent: "text-sky-400",
    ring: "border-sky-500/30",
    glow: "shadow-sky-500/10",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
  },
  {
    title: "Accountant",
    desc: "Manage collections, track follow-ups, and close faster.",
    accent: "text-emerald-400",
    ring: "border-emerald-500/30",
    glow: "shadow-emerald-500/10",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 01-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0115 18.257V17.25m6-12V15a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 15V5.25m18 0A2.25 2.25 0 0018.75 3H5.25A2.25 2.25 0 003 5.25m18 0V12a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 12V5.25" />
      </svg>
    ),
  },
  {
    title: "Project Manager / Rep",
    desc: "Assign, follow up, and keep projects on track.",
    accent: "text-teal-400",
    ring: "border-teal-500/30",
    glow: "shadow-teal-500/10",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
    ),
  },
];

// ── FAQ — answer-optimised for search engines AND AI answer engines ──────────
// Each question is phrased the way a buyer (or an AI on their behalf) would ask,
// and each answer leads with a clear, declarative statement about the product.
const FAQS = [
  {
    q: "What is the best AR management tool for QuickBooks Online?",
    a: "Prime Accountax is an accounts receivable management and collections platform built for QuickBooks Online. It automatically syncs your invoices, customers, and payments from QuickBooks, then automates collection reminders, tracks payment promises and disputes, and gives your team a real-time view of every outstanding invoice so you get paid faster.",
  },
  {
    q: "How do I automate accounts receivable collections in QuickBooks?",
    a: "Connect QuickBooks Online to Prime Accountax in one click. It pulls in your open invoices and customers, then sends scheduled, branded payment reminders by email (Gmail, Microsoft 365, or SMTP) on a cadence you define. Replies, promises to pay, and disputes are tracked automatically, so collections run without manual chasing.",
  },
  {
    q: "Can Prime Accountax send automatic invoice payment reminders?",
    a: "Yes. You can build smart follow-up sequences that send branded reminder emails before and after the due date. Every email is tracked with a unique reference, and customers can pay, promise a payment date, or raise a dispute from a secure self-service portal — no login required.",
  },
  {
    q: "Does Prime Accountax work with both QuickBooks Online and Xero?",
    a: "Yes. Prime Accountax integrates with both QuickBooks Online and Xero. Invoices, customers, contacts, projects, and payments sync automatically, so your accounts receivable data stays current with zero manual entry.",
  },
  {
    q: "How does Prime Accountax help reduce DSO and get invoices paid faster?",
    a: "By automating reminder sequences, surfacing overdue and high-risk invoices, tracking payment promises, and keeping accountants, sales reps, and customers aligned on one shared view, Prime Accountax shortens the collection cycle and reduces Days Sales Outstanding (DSO).",
  },
  {
    q: "Who is Prime Accountax for?",
    a: "Prime Accountax is built for accounting firms and finance teams that use QuickBooks Online or Xero and need to manage accounts receivable and collections across customers, accountants, project managers, and sales reps in one shared workflow.",
  },
  {
    q: "How much does Prime Accountax cost?",
    a: "Prime Accountax is a subscription priced at $99 per month per organization, with QuickBooks Online and Xero sync included. You can sign up at primeaccountax.com.",
  },
  {
    q: "Is my QuickBooks and Xero data secure in Prime Accountax?",
    a: "Yes. Every organization's data is fully isolated — your QuickBooks and Xero invoices, customers, and payments are only ever visible to your own organization, never to any other customer.",
  },
];

// JSON-LD structured data — read by Google (rich results) and AI answer engines.
const JSONLD = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://primeaccountax.com/#organization",
      name: "Prime Accountax",
      url: "https://primeaccountax.com",
      description:
        "Accounts receivable management and collections software for QuickBooks Online and Xero.",
    },
    {
      "@type": "WebSite",
      "@id": "https://primeaccountax.com/#website",
      url: "https://primeaccountax.com",
      name: "Prime Accountax",
      publisher: { "@id": "https://primeaccountax.com/#organization" },
    },
    {
      "@type": "SoftwareApplication",
      name: "Prime Accountax",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: "https://primeaccountax.com",
      description:
        "Prime Accountax is an accounts receivable (AR) management and collections platform for QuickBooks Online and Xero. Sync invoices and customers, automate payment reminders, track promises and disputes, and get paid faster.",
      offers: { "@type": "Offer", price: "99", priceCurrency: "USD" },
      featureList: [
        "Live collections board",
        "QuickBooks Online & Xero sync",
        "Automated payment reminders",
        "Customer self-service portal",
        "AI collections assistant",
        "Team & rep management",
      ],
    },
    {
      "@type": "FAQPage",
      mainEntity: FAQS.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
};

// ── Chat Widget ──────────────────────────────────────────────────────────────
type ChatMessage = { role: "user" | "assistant"; content: string };

const QUICK_STARTERS = [
  "How does QBO sync work?",
  "Who is this built for?",
  "How is this different from QuickBooks?",
];

function ChatWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [hasNewMsg, setHasNewMsg] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const WELCOME: ChatMessage = {
    role: "assistant",
    content: "Hi! I'm Aria 👋 I can answer any questions about Prime Accountax — how it works, what it does, pricing, integrations, anything. What would you like to know?",
  };

  useEffect(() => {
    if (open) {
      if (messages.length === 0) setMessages([WELCOME]);
      setHasNewMsg(false);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = useCallback(async (text: string) => {
    const msg = text.trim();
    if (!msg || loading) return;
    setInput("");
    const next: ChatMessage[] = [...messages, { role: "user", content: msg }];
    setMessages(next);
    setLoading(true);
    try {
      const history = next.slice(0, -1).map(m => ({ role: m.role, content: m.content }));
      const res = await fetch("/api/public/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg, history }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.reply ?? "Sorry, something went wrong." }]);
      if (!open) setHasNewMsg(true);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Sorry, I couldn't connect. Please try again." }]);
    } finally {
      setLoading(false);
    }
  }, [messages, loading, open]);

  return (
    <>
      {/* Floating button */}
      <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
        {/* Nudge bubble — shown before first open */}
        {!open && messages.length === 0 && (
          <div className="bg-white text-stone-800 text-sm font-medium px-4 py-2.5 rounded-2xl rounded-br-sm shadow-xl max-w-[200px] text-right animate-bounce-slow">
            Got questions? Ask Aria ✨
          </div>
        )}

        {hasNewMsg && !open && (
          <div className="absolute -top-1 -left-1 w-3 h-3 bg-rose-500 rounded-full animate-pulse" />
        )}

        <button
          onClick={() => setOpen(v => !v)}
          className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-400 shadow-xl shadow-emerald-500/30 flex items-center justify-center transition-all hover:scale-105 active:scale-95"
          aria-label="Open chat"
        >
          {open ? (
            <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
          )}
        </button>
      </div>

      {/* Chat panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[360px] max-w-[calc(100vw-24px)] rounded-2xl border border-stone-700/60 bg-stone-950 shadow-2xl shadow-black/60 flex flex-col overflow-hidden"
          style={{ maxHeight: "520px" }}>

          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3.5 bg-stone-900 border-b border-stone-800 shrink-0">
            <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-white">Aria</div>
              <div className="flex items-center gap-1.5 text-[11px] text-stone-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                Prime Accountax · Always online
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="text-stone-500 hover:text-stone-200 p-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                {m.role === "assistant" && (
                  <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 mr-2 text-[10px] font-bold">A</div>
                )}
                <div className={`max-w-[82%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-emerald-600 text-white rounded-br-sm"
                    : "bg-stone-800 text-stone-200 rounded-bl-sm"
                }`}>
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="w-6 h-6 rounded-full bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5 mr-2 text-[10px] font-bold">A</div>
                <div className="bg-stone-800 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-500 animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-500 animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="w-1.5 h-1.5 rounded-full bg-stone-500 animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Quick starters — only show when just the welcome message is showing */}
          {messages.length === 1 && !loading && (
            <div className="px-4 pb-3 flex flex-wrap gap-2 shrink-0">
              {QUICK_STARTERS.map(q => (
                <button key={q} onClick={() => send(q)}
                  className="text-[11px] text-emerald-400 border border-emerald-800 bg-emerald-500/5 hover:bg-emerald-500/15 rounded-full px-3 py-1.5 transition-colors text-left">
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="px-3 pb-3 pt-2 border-t border-stone-800 shrink-0">
            <form onSubmit={e => { e.preventDefault(); send(input); }} className="flex items-center gap-2 bg-stone-800 border border-stone-700 rounded-xl px-3 py-2">
              <input
                ref={inputRef}
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask anything about Prime Accountax…"
                className="flex-1 bg-transparent text-sm text-stone-200 placeholder-stone-500 outline-none"
                disabled={loading}
              />
              <button type="submit" disabled={loading || !input.trim()}
                className="text-emerald-400 hover:text-emerald-300 disabled:opacity-30 transition-colors shrink-0">
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                </svg>
              </button>
            </form>
            <p className="text-center text-[10px] text-stone-600 mt-1.5">Powered by Prime Accountax AI</p>
          </div>
        </div>
      )}
    </>
  );
}

// ── Animated number counter ───────────────────────────────────────────────────
function Counter({ end, suffix = "" }: { end: number; suffix?: string }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        let start = 0;
        const step = end / 40;
        const timer = setInterval(() => {
          start += step;
          if (start >= end) { setCount(end); clearInterval(timer); }
          else setCount(Math.floor(start));
        }, 40);
      },
      { threshold: 0.5 }
    );
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [end]);
  return <span ref={ref}>{count}{suffix}</span>;
}

// ── Scroll-reveal wrapper ──────────────────────────────────────────────────────
function Reveal({ children, className = "", delay = 0 }: { children: React.ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { el.classList.add("lp-in"); io.disconnect(); } },
      { threshold: 0.12 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`lp-reveal ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

// ── 3D mouse-tilt hook ─────────────────────────────────────────────────────────
// Writes the transform directly to the DOM via requestAnimationFrame so the
// dashboard never triggers a React re-render on mouse move (keeps it buttery).
function useTilt(max = 6) {
  const ref = useRef<HTMLDivElement>(null);
  const frame = useRef<number>(0);
  const onMove = (e: React.MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    const py = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const rx = Math.max(-1, Math.min(1, px)) * max;
    const ry = Math.max(-1, Math.min(1, py)) * max;
    if (frame.current) cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      // Instant follow (no CSS transition) — rAF already caps to 60fps
      el.style.transition = "none";
      el.style.transform = `perspective(1400px) rotateY(${rx}deg) rotateX(${-ry}deg)`;
    });
  };
  const reset = () => {
    if (frame.current) cancelAnimationFrame(frame.current);
    const el = ref.current;
    if (!el) return;
    // Smooth ease back to flat only when the pointer leaves
    el.style.transition = "transform 450ms cubic-bezier(0.16,1,0.3,1)";
    el.style.transform = "perspective(1400px) rotateY(0deg) rotateX(0deg)";
  };
  return { ref, onMove, reset };
}

// ── Particle field — deterministic positions (no hydration mismatch) ───────────
const PARTICLES = [
  { l: "8%", d: "0s", s: 3, dur: "11s" }, { l: "18%", d: "2s", s: 2, dur: "14s" },
  { l: "27%", d: "5s", s: 4, dur: "12s" }, { l: "36%", d: "1s", s: 2, dur: "16s" },
  { l: "45%", d: "7s", s: 3, dur: "13s" }, { l: "54%", d: "3s", s: 2, dur: "15s" },
  { l: "63%", d: "6s", s: 4, dur: "11s" }, { l: "72%", d: "2s", s: 2, dur: "17s" },
  { l: "81%", d: "8s", s: 3, dur: "12s" }, { l: "90%", d: "4s", s: 2, dur: "14s" },
  { l: "13%", d: "9s", s: 2, dur: "18s" }, { l: "58%", d: "10s", s: 3, dur: "13s" },
];
function ParticleField() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden>
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="absolute bottom-0 rounded-full bg-emerald-400/40"
          style={{
            left: p.l,
            width: p.s,
            height: p.s,
            animation: `lp-rise ${p.dur} linear ${p.d} infinite`,
          }}
        />
      ))}
    </div>
  );
}

// ── Collaboration diagram — self-contained animated SVG (scales cleanly) ───────
function CollaborationDiagram() {
  return (
    <svg viewBox="0 0 1000 300" className="w-full h-auto" aria-hidden>
      <defs>
        <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.1" />
          <stop offset="50%" stopColor="#10b981" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#2dd4bf" stopOpacity="0.1" />
        </linearGradient>
        <radialGradient id="hubGlow">
          <stop offset="0%" stopColor="#10b981" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
        </radialGradient>
        <filter id="soft"><feGaussianBlur stdDeviation="2.2" /></filter>
      </defs>

      {/* Hub glow */}
      <circle cx="500" cy="60" r="90" fill="url(#hubGlow)" className="lp-glow" />

      {/* Connection paths (drawn in) */}
      {[
        "M 170 230 C 300 180, 380 110, 500 70",
        "M 500 240 C 500 180, 500 130, 500 78",
        "M 830 230 C 700 180, 620 110, 500 70",
      ].map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="url(#lineGrad)"
          strokeWidth="2"
          pathLength={1}
          className="lp-draw"
          style={{ animationDelay: `${0.3 + i * 0.25}s` }}
        />
      ))}

      {/* Traveling pulses along each path (SMIL — robust everywhere) */}
      {[
        "M 170 230 C 300 180, 380 110, 500 70",
        "M 500 240 C 500 180, 500 130, 500 78",
        "M 830 230 C 700 180, 620 110, 500 70",
      ].map((d, i) => (
        <circle key={`p${i}`} r="3.5" fill="#34d399" filter="url(#soft)">
          <animateMotion dur="3s" begin={`${1 + i * 0.5}s`} repeatCount="indefinite" path={d} />
          <animate attributeName="opacity" values="0;1;1;0" dur="3s" begin={`${1 + i * 0.5}s`} repeatCount="indefinite" />
        </circle>
      ))}

      {/* Central hub node */}
      <g>
        <rect x="420" y="34" width="160" height="52" rx="14" fill="#0c0a09" stroke="#10b981" strokeOpacity="0.5" />
        <circle cx="446" cy="60" r="9" fill="#10b981" />
        <text x="446" y="64" textAnchor="middle" fontSize="12" fontWeight="700" fill="#fff">P</text>
        <text x="468" y="56" fontSize="12.5" fontWeight="700" fill="#fff">Prime Accountax</text>
        <text x="468" y="72" fontSize="9.5" fill="#a8a29e">Real-time AR view</text>
      </g>

      {/* Role node dots */}
      {[
        { x: 170, y: 230, c: "#38bdf8", t: "Customer" },
        { x: 500, y: 240, c: "#10b981", t: "Accountant" },
        { x: 830, y: 230, c: "#2dd4bf", t: "PM / Rep" },
      ].map((n) => (
        <g key={n.t}>
          <circle cx={n.x} cy={n.y} r="20" fill={n.c} fillOpacity="0.12" stroke={n.c} strokeOpacity="0.5" />
          <circle cx={n.x} cy={n.y} r="6" fill={n.c} />
        </g>
      ))}
    </svg>
  );
}

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const tilt = useTilt(6);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="relative bg-stone-950 text-stone-100 min-h-screen font-sans antialiased overflow-x-hidden">

      {/* ── Structured data (SEO + AI answer engines) ── */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(JSONLD) }}
      />

      {/* ── Global background (static — no per-frame repaint) ── */}
      <div className="fixed inset-0 -z-10 pointer-events-none" aria-hidden>
        <div className="absolute inset-0" style={{
          background: "radial-gradient(60% 50% at 20% 0%, rgba(16,185,129,0.10), transparent), radial-gradient(50% 50% at 85% 20%, rgba(45,212,191,0.08), transparent), radial-gradient(60% 60% at 50% 100%, rgba(16,185,129,0.06), transparent)",
        }} />
        <div className="absolute inset-0 opacity-[0.04]" style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.6) 1px, transparent 1px)",
          backgroundSize: "56px 56px",
        }} />
      </div>

      {/* ── NAV ── */}
      <nav className={`fixed top-0 inset-x-0 z-50 border-b transition-all duration-300 ${scrolled ? "border-stone-800/80 bg-stone-950/85 backdrop-blur-xl shadow-lg shadow-black/20" : "border-transparent bg-transparent"}`}>
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/40">
              <span className="text-white font-bold text-lg leading-none">P</span>
            </div>
            <span className="font-semibold text-white tracking-tight">Prime Accountax</span>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-6 text-sm text-stone-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-white transition-colors">How it works</a>
            <a href="#stats" className="hover:text-white transition-colors">Results</a>
            <a href="#faq" className="hover:text-white transition-colors">FAQ</a>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Link href="/login" className="text-sm text-stone-400 hover:text-white px-4 py-2 rounded-lg transition-colors">
              Sign in
            </Link>
            <Link href="/register" className="group text-sm font-medium bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2 rounded-lg transition-all hover:shadow-lg hover:shadow-emerald-500/30 active:scale-95">
              Get started →
            </Link>
          </div>

          {/* Mobile hamburger */}
          <button className="md:hidden p-2 rounded-lg text-stone-400 hover:text-white" onClick={() => setMenuOpen(v => !v)}>
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {menuOpen
                ? <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                : <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />}
            </svg>
          </button>
        </div>

        {/* Mobile menu */}
        {menuOpen && (
          <div className="md:hidden border-t border-stone-800 bg-stone-950/95 backdrop-blur-xl px-5 pb-4 space-y-1">
            {["features", "how-it-works", "stats", "faq"].map(id => (
              <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}
                className="block py-2.5 text-sm text-stone-400 hover:text-white capitalize">{id.replace("-", " ")}</a>
            ))}
            <div className="pt-3 flex flex-col gap-2">
              <Link href="/login" className="text-sm text-center text-stone-400 border border-stone-700 hover:border-stone-500 px-4 py-2.5 rounded-lg transition-colors">Sign in</Link>
              <Link href="/register" className="text-sm text-center font-medium bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2.5 rounded-lg transition-colors">Get started →</Link>
            </div>
          </div>
        )}
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-32 pb-20 px-5 overflow-hidden">
        <ParticleField />
        {/* Background glow orbs */}
        <div className="absolute inset-0 -z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-10 left-1/2 -translate-x-1/2 w-[860px] h-[520px] bg-emerald-500/10 rounded-full blur-3xl lp-glow" />
          <div className="absolute top-40 -left-20 w-72 h-72 bg-teal-500/10 rounded-full blur-3xl lp-float-slow" />
          <div className="absolute top-60 -right-20 w-72 h-72 bg-emerald-500/10 rounded-full blur-3xl lp-float-delay" />
        </div>

        <div className="relative max-w-4xl mx-auto text-center">
          <Reveal>
            <div className="inline-flex items-center gap-2 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3.5 py-1.5 mb-6 backdrop-blur">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              AI AR Management for Accounting Firms
            </div>
          </Reveal>

          <Reveal delay={80}>
            <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] text-white mb-6">
              Stop chasing invoices.<br />
              <span className="bg-gradient-to-r from-emerald-400 via-teal-300 to-emerald-400 bg-clip-text text-transparent">Start collecting.</span>
            </h1>
          </Reveal>

          <Reveal delay={160}>
            <p className="text-lg text-stone-400 max-w-2xl mx-auto leading-relaxed mb-10">
              A complete accounts receivable platform — sync with QuickBooks and Xero, automate collection emails, and keep Customers, Accountants, Project Managers, and Reps aligned with a real-time view of every outstanding invoice.
            </p>
          </Reveal>

          <Reveal delay={240}>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <Link href="/register"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-sm px-7 py-3.5 rounded-xl transition-all hover:shadow-xl hover:shadow-emerald-500/30 hover:-translate-y-0.5 active:scale-[0.98]">
                Get started
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                </svg>
              </Link>
              <Link href="/login"
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 text-stone-300 hover:text-white border border-stone-700 hover:border-emerald-500/50 text-sm px-7 py-3.5 rounded-xl transition-all hover:bg-stone-900/50">
                Sign in
              </Link>
            </div>
          </Reveal>
        </div>

        {/* 3D floating dashboard */}
        <div className="relative max-w-5xl mx-auto mt-20 lp-3d" onMouseMove={tilt.onMove} onMouseLeave={tilt.reset}>
          {/* floating mini cards */}
          <div className="hidden lg:block absolute -left-10 top-16 z-20 lp-float">
            <div className="rounded-xl border border-emerald-500/30 bg-stone-900/95 px-4 py-3 shadow-xl shadow-emerald-500/10">
              <div className="text-[10px] text-stone-500">Payment promised</div>
              <div className="text-sm font-semibold text-emerald-400">€28,000 · Fri</div>
            </div>
          </div>
          <div className="hidden lg:block absolute -right-8 top-40 z-20 lp-float-delay">
            <div className="rounded-xl border border-teal-500/30 bg-stone-900/95 px-4 py-3 shadow-xl shadow-teal-500/10">
              <div className="text-[10px] text-stone-500">Reminder sent</div>
              <div className="text-sm font-semibold text-white">INV-1042 ✓</div>
            </div>
          </div>

          <div
            ref={tilt.ref}
            className="lp-preserve rounded-2xl border border-emerald-500/20 bg-stone-900 overflow-hidden shadow-2xl shadow-emerald-900/30 will-change-transform"
            style={{ transform: "perspective(1400px) rotateY(0deg) rotateX(0deg)" }}
          >
            {/* glowing top edge */}
            <div className="h-px w-full bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent" />
            {/* Fake browser chrome */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-700/60 bg-stone-900/80">
              <div className="w-3 h-3 rounded-full bg-rose-500/60" />
              <div className="w-3 h-3 rounded-full bg-amber-500/60" />
              <div className="w-3 h-3 rounded-full bg-emerald-500/60" />
              <div className="ml-3 flex-1 h-5 bg-stone-800 rounded-md max-w-xs text-xs text-stone-600 flex items-center px-3">primeaccountax.com/dashboard</div>
            </div>

            <div className="p-6">
              {/* Stats row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                {[
                  { label: "Total AR", value: "€2.89M", sub: "262 open", up: true },
                  { label: "Overdue", value: "€1.95M", sub: "186 invoices", up: false },
                  { label: "Open Invoices", value: "262", sub: "across 48 customers", up: true },
                  { label: "Avg Days Outstanding", value: "41d", sub: "↓ 6d this quarter", up: true },
                ].map(s => (
                  <div key={s.label} className="rounded-xl bg-stone-800/50 border border-stone-700/40 p-3.5 hover:border-emerald-500/30 transition-colors">
                    <div className="text-[11px] text-stone-500 mb-1">{s.label}</div>
                    <div className="text-lg font-semibold text-white tabular-nums">{s.value}</div>
                    <div className={`text-[11px] mt-0.5 ${s.up ? "text-emerald-400" : "text-rose-400"}`}>{s.sub}</div>
                  </div>
                ))}
              </div>

              <div className="grid lg:grid-cols-3 gap-4">
                {/* Collections trend chart */}
                <div className="lg:col-span-2 rounded-xl border border-stone-700/40 bg-stone-900/40 p-4">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[12px] font-semibold text-stone-300">Collections trend</span>
                    <span className="text-[10px] text-emerald-400 bg-emerald-500/10 rounded-full px-2 py-0.5">+18% MoM</span>
                  </div>
                  <svg viewBox="0 0 320 110" className="w-full h-28" preserveAspectRatio="none">
                    <defs>
                      <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#10b981" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                      </linearGradient>
                    </defs>
                    {[20, 45, 70, 95].map(y => (
                      <line key={y} x1="0" y1={y} x2="320" y2={y} stroke="#ffffff" strokeOpacity="0.05" />
                    ))}
                    <path d="M0,90 L40,78 L80,82 L120,60 L160,64 L200,42 L240,46 L280,26 L320,18 L320,110 L0,110 Z" fill="url(#chartFill)" />
                    <path
                      d="M0,90 L40,78 L80,82 L120,60 L160,64 L200,42 L240,46 L280,26 L320,18"
                      fill="none" stroke="#34d399" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                      className="lp-chart-line"
                    />
                    <circle cx="320" cy="18" r="4" fill="#34d399" className="lp-glow" />
                  </svg>
                </div>

                {/* Aging summary */}
                <div className="rounded-xl border border-stone-700/40 bg-stone-900/40 p-4">
                  <span className="text-[12px] font-semibold text-stone-300">Aging summary</span>
                  <div className="space-y-2.5 mt-3">
                    {[
                      { l: "Current", w: "46%", c: "bg-emerald-500" },
                      { l: "1–30d", w: "28%", c: "bg-amber-400" },
                      { l: "31–90d", w: "18%", c: "bg-orange-500" },
                      { l: "90+ d", w: "8%", c: "bg-rose-600" },
                    ].map(b => (
                      <div key={b.l} className="flex items-center gap-2 text-[11px]">
                        <span className="w-12 text-stone-500">{b.l}</span>
                        <span className="flex-1 h-2 bg-stone-800 rounded-full overflow-hidden">
                          <span className={`block h-full ${b.c} rounded-full`} style={{ width: b.w }} />
                        </span>
                        <span className="w-8 text-right text-stone-400">{b.w}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Recent activity + invoice status */}
              <div className="grid md:grid-cols-2 gap-4 mt-4">
                <div className="rounded-xl border border-stone-700/40 bg-stone-900/40 p-4">
                  <span className="text-[12px] font-semibold text-stone-300">Recent activity</span>
                  <div className="space-y-2.5 mt-3">
                    {[
                      { c: "bg-emerald-400", t: "Al Baraka promised payment — Fri" },
                      { c: "bg-sky-400", t: "Reminder sent to Fatima Industries" },
                      { c: "bg-rose-400", t: "Metro Logistics raised a dispute" },
                    ].map((a, i) => (
                      <div key={i} className="flex items-center gap-2.5 text-[11.5px] text-stone-300">
                        <span className={`w-1.5 h-1.5 rounded-full ${a.c}`} />
                        {a.t}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="rounded-xl border border-stone-700/40 bg-stone-900/40 p-4">
                  <span className="text-[12px] font-semibold text-stone-300">Invoice status · INV-1042</span>
                  <div className="mt-3 flex items-center gap-2">
                    <span className="text-[11px] text-amber-400 bg-amber-500/10 rounded-full px-2 py-0.5">Promise to Pay</span>
                    <span className="text-[11px] text-stone-500">€28,000 · due Fri</span>
                  </div>
                  <div className="mt-3 h-1.5 bg-stone-800 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full" style={{ width: "72%" }} />
                  </div>
                  <div className="mt-1.5 text-[10px] text-stone-500">3 of 4 follow-up steps complete</div>
                </div>
              </div>
            </div>
          </div>
          {/* Glow under card */}
          <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 w-3/4 h-10 bg-emerald-500/25 blur-3xl rounded-full lp-glow" />
        </div>
      </section>

      {/* ── COLLABORATION ── */}
      <section className="relative py-20 px-5">
        <div className="max-w-5xl mx-auto">
          <Reveal className="text-center mb-10">
            <h2 className="text-2xl md:text-3xl font-bold text-white mb-3">One shared view for everyone</h2>
            <p className="text-stone-400 max-w-2xl mx-auto">Close the gap between finance, operations, and your customers. Everyone sees the same real-time picture of every invoice.</p>
          </Reveal>

          <Reveal delay={100}>
            <div className="relative rounded-3xl border border-stone-800/80 bg-stone-900/30 backdrop-blur-sm p-6 md:p-8">
              <CollaborationDiagram />
              <div className="grid md:grid-cols-3 gap-4 mt-6">
                {ROLES.map((r, i) => (
                  <Reveal key={r.title} delay={i * 120}>
                    <div className={`lp-shimmer-parent rounded-2xl border ${r.ring} bg-stone-900/60 p-5 shadow-lg ${r.glow} hover:-translate-y-1 transition-transform duration-300`}>
                      <div className={`w-10 h-10 rounded-xl bg-stone-800/80 flex items-center justify-center mb-3 ${r.accent}`}>
                        {r.icon}
                      </div>
                      <h3 className="text-sm font-semibold text-white mb-1.5">{r.title}</h3>
                      <p className="text-[13px] text-stone-400 leading-relaxed">{r.desc}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── STATS ── */}
      <section id="stats" className="relative py-16 px-5 border-y border-stone-800">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { n: 85, suffix: "%", label: "Reduction in manual chasing" },
            { n: 40, suffix: "%", label: "Faster invoice collection" },
            { n: 100, suffix: "%", label: "QuickBooks & Xero sync visibility" },
            { n: 3, suffix: "x", label: "More responses from customers" },
          ].map((s, i) => (
            <Reveal key={s.label} delay={i * 100}>
              <div className="text-4xl font-bold bg-gradient-to-b from-emerald-300 to-teal-500 bg-clip-text text-transparent mb-1 tabular-nums">
                <Counter end={s.n} suffix={s.suffix} />
              </div>
              <div className="text-sm text-stone-500">{s.label}</div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="relative py-24 px-5">
        <div className="max-w-6xl mx-auto">
          <Reveal className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Everything your AR team needs</h2>
            <p className="text-stone-400 text-base max-w-3xl mx-auto leading-relaxed">
              Bring accountants, sales reps, project managers, and customers into one shared AR workflow. Track every follow-up, coordinate internal ownership, and give customers a self-service portal to promise payment dates or raise disputes — so receivables keep moving without losing context across finance, operations, and revenue teams.
            </p>
          </Reveal>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 lp-3d">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 90}>
                <div className="group lp-shimmer-parent h-full rounded-2xl border border-stone-800 bg-stone-900/40 p-6 hover:border-emerald-500/40 hover:bg-stone-900/80 transition-all duration-300 hover:-translate-y-1.5 hover:shadow-xl hover:shadow-emerald-900/20">
                  <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${f.grad} ring-1 ring-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4 group-hover:scale-110 group-hover:ring-emerald-400/40 transition-all duration-300`}>
                    {f.icon}
                  </div>
                  <h3 className="text-base font-semibold text-white mb-2">{f.title}</h3>
                  <p className="text-sm text-stone-400 leading-relaxed">{f.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="relative py-24 px-5 bg-stone-900/30">
        <div className="max-w-5xl mx-auto">
          <Reveal className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">Up and running in minutes</h2>
            <p className="text-stone-400 text-lg">No complex setup. Connect QuickBooks or Xero and your team is collecting.</p>
          </Reveal>

          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Timeline */}
            <div className="relative">
              <div className="absolute left-[22px] top-6 bottom-6 w-px bg-gradient-to-b from-emerald-500/60 via-emerald-500/30 to-transparent" />
              <div className="space-y-8">
                {STEPS.map((s, i) => (
                  <Reveal key={s.n} delay={i * 120}>
                    <div className="flex gap-6 items-start">
                      <div className="relative flex-shrink-0 w-11 h-11 rounded-full border-2 border-emerald-500/50 bg-stone-950 flex items-center justify-center text-xs font-bold text-emerald-400 z-10">
                        {s.n}
                        <span className="absolute inset-0 rounded-full bg-emerald-500/20 blur-md lp-glow" />
                      </div>
                      <div className="pt-1.5">
                        <h3 className="text-base font-semibold text-white mb-1">{s.title}</h3>
                        <p className="text-sm text-stone-400 leading-relaxed">{s.desc}</p>
                      </div>
                    </div>
                  </Reveal>
                ))}
              </div>
            </div>

            {/* Integration hub */}
            <Reveal delay={150}>
              <div className="relative aspect-square max-w-sm mx-auto">
                {/* orbit rings */}
                <div className="absolute inset-4 rounded-full border border-emerald-500/20 lp-spin-slow" />
                <div className="absolute inset-12 rounded-full border border-teal-500/20 lp-spin-rev" />
                {/* center hub */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-24 h-24 rounded-2xl bg-stone-900 border border-emerald-500/40 flex flex-col items-center justify-center shadow-2xl shadow-emerald-500/20 lp-float">
                    <span className="text-emerald-400 text-3xl font-bold">P</span>
                    <span className="text-[9px] text-stone-500 mt-0.5">Prime Accountax</span>
                  </div>
                </div>
                {/* satellites */}
                {[
                  { label: "QuickBooks", pos: "top-0 left-1/2 -translate-x-1/2", c: "text-emerald-400 border-emerald-500/30" },
                  { label: "Xero", pos: "top-1/2 right-0 -translate-y-1/2", c: "text-sky-400 border-sky-500/30" },
                  { label: "Reminders", pos: "bottom-0 left-1/2 -translate-x-1/2", c: "text-teal-400 border-teal-500/30" },
                  { label: "Team", pos: "top-1/2 left-0 -translate-y-1/2", c: "text-amber-400 border-amber-500/30" },
                ].map((sat, i) => (
                  <div key={sat.label} className={`absolute ${sat.pos} ${i % 2 === 0 ? "lp-float" : "lp-float-delay"}`}>
                    <div className={`rounded-xl bg-stone-900/95 border ${sat.c} px-3 py-2 text-[11px] font-semibold shadow-lg`}>
                      {sat.label}
                    </div>
                  </div>
                ))}
              </div>
            </Reveal>
          </div>
        </div>
      </section>

      {/* ── FAQ (SEO + AEO) ── */}
      <section id="faq" className="relative py-24 px-5">
        <div className="max-w-3xl mx-auto">
          <Reveal className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">Frequently asked questions</h2>
            <p className="text-stone-400">Accounts receivable &amp; collections for QuickBooks Online and Xero — answered.</p>
          </Reveal>
          <div className="space-y-3">
            {FAQS.map((f, i) => (
              <Reveal key={i} delay={(i % 4) * 60}>
                <details className="group rounded-xl border border-stone-800 bg-stone-900/40 px-5 py-4 open:bg-stone-900/70 open:border-emerald-500/30 transition-colors">
                  <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-[15px] font-medium text-white">
                    <span>{f.q}</span>
                    <span className="text-stone-500 group-open:rotate-45 transition-transform text-2xl leading-none shrink-0">+</span>
                  </summary>
                  <p className="mt-3 text-sm text-stone-400 leading-relaxed">{f.a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative py-24 px-5">
        <div className="max-w-3xl mx-auto">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl border border-emerald-500/25 bg-gradient-to-b from-emerald-500/10 via-stone-900/60 to-transparent p-10 md:p-14 text-center backdrop-blur-xl shadow-2xl shadow-emerald-900/30">
              {/* glow */}
              <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-96 h-40 bg-emerald-500/20 blur-3xl rounded-full lp-glow" />

              {/* 3D chart with upward arrow */}
              <div className="relative mx-auto mb-8 w-40 h-24 lp-bob">
                <svg viewBox="0 0 160 96" className="w-full h-full">
                  {[0, 1, 2, 3].map(i => (
                    <rect key={i} x={14 + i * 34} y={70 - i * 14} width="20" height={14 + i * 14} rx="3"
                      fill="#10b981" fillOpacity={0.3 + i * 0.18} />
                  ))}
                  <path d="M10,74 L46,60 L82,52 L130,22" fill="none" stroke="#34d399" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M118,22 L130,22 L130,34" fill="none" stroke="#34d399" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>

              <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Ready to get paid faster?</h2>
              <p className="text-stone-400 mb-8 text-lg max-w-xl mx-auto">
                Sign in to your Prime Accountax collection dashboard and start managing receivables with QuickBooks and Xero connected.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                <Link href="/register"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold px-8 py-4 rounded-xl transition-all hover:shadow-xl hover:shadow-emerald-500/30 hover:-translate-y-0.5 text-sm active:scale-[0.98]">
                  Get started
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
                  </svg>
                </Link>
                <Link href="/login"
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 text-stone-300 hover:text-white border border-stone-700 hover:border-emerald-500/50 px-8 py-4 rounded-xl transition-all text-sm">
                  Open dashboard
                </Link>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="relative border-t border-stone-800 py-8 px-5">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-stone-500">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-emerald-500 flex items-center justify-center">
              <span className="text-white font-bold text-xs leading-none">P</span>
            </div>
            <span>© {new Date().getFullYear()} Prime Accountax (Pvt) Ltd</span>
          </div>
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="hover:text-stone-300 transition-colors">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-stone-300 transition-colors">Terms of Service</Link>
            <Link href="/login" className="hover:text-stone-300 transition-colors">Sign in</Link>
          </div>
        </div>
      </footer>

      {/* ── AI CHAT WIDGET ── */}
      <ChatWidget />

    </div>
  );
}
