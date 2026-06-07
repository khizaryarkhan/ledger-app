"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";

const FEATURES = [
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    title: "Live Collections Board",
    desc: "See every outstanding invoice in one view. Filter by customer, region, rep, or stage. Bulk-send reminders in seconds.",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
      </svg>
    ),
    title: "QuickBooks Sync",
    desc: "Invoices, customers, projects, and payments sync automatically from QuickBooks Online. Always up to date, zero manual entry.",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
      </svg>
    ),
    title: "Automated Reminders",
    desc: "Schedule email sequences via Gmail, Microsoft 365, or SMTP. Every email is branded, timestamped, and tracked with a unique reference.",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
    title: "Customer Self-Service Portal",
    desc: "Customers get a secure link to view invoices, set a payment promise date, or raise a dispute — no login required.",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
    ),
    title: "AI Collections Assistant",
    desc: "Ask anything: \"Who owes the most this month?\" or \"Send invoice 7786 to Ali.\" The AI understands your data and acts on it.",
  },
  {
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
    title: "Team & Rep Management",
    desc: "Assign invoices to reps, track follow-ups by region, and give each team member their own focused view.",
  },
];

const STEPS = [
  { n: "01", title: "Connect QuickBooks", desc: "One-click OAuth sync pulls all your invoices, customers, and projects." },
  { n: "02", title: "Set Your Workflow", desc: "Configure email sequences, assign reps, and define collection stages." },
  { n: "03", title: "Chase Automatically", desc: "Overdue invoices get chased on schedule. You get notified of every response." },
  { n: "04", title: "Close Faster", desc: "Track promises, resolve disputes, and watch your DSO drop." },
];

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

export default function LandingPage() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="bg-stone-950 text-stone-100 min-h-screen font-sans antialiased">

      {/* ── NAV ── */}
      <nav className="fixed top-0 inset-x-0 z-50 border-b border-stone-800/60 bg-stone-950/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <span className="font-semibold text-white tracking-tight">Prime Accountax</span>
          </div>

          {/* Desktop nav */}
          <div className="hidden md:flex items-center gap-6 text-sm text-stone-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-white transition-colors">How it works</a>
            <a href="#stats" className="hover:text-white transition-colors">Results</a>
          </div>

          <div className="hidden md:flex items-center gap-3">
            <Link href="/login" className="text-sm text-stone-400 hover:text-white px-4 py-2 rounded-lg transition-colors">
              Sign in
            </Link>
            <Link href="/login" className="text-sm font-medium bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2 rounded-lg transition-colors">
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
          <div className="md:hidden border-t border-stone-800 bg-stone-950 px-5 pb-4 space-y-1">
            {["features", "how-it-works", "stats"].map(id => (
              <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)}
                className="block py-2.5 text-sm text-stone-400 hover:text-white capitalize">{id.replace("-", " ")}</a>
            ))}
            <div className="pt-3 flex flex-col gap-2">
              <Link href="/login" className="text-sm text-center text-stone-400 border border-stone-700 hover:border-stone-500 px-4 py-2.5 rounded-lg transition-colors">Sign in</Link>
              <Link href="/login" className="text-sm text-center font-medium bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2.5 rounded-lg transition-colors">Get started →</Link>
            </div>
          </div>
        )}
      </nav>

      {/* ── HERO ── */}
      <section className="relative pt-32 pb-24 px-5 overflow-hidden">
        {/* Background glow */}
        <div className="absolute inset-0 -z-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[500px] bg-emerald-500/10 rounded-full blur-3xl" />
        </div>

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3.5 py-1.5 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            AR Management for Accounting Firms
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight leading-[1.1] text-white mb-6">
            Stop chasing invoices.<br />
            <span className="text-emerald-400">Start collecting.</span>
          </h1>

          <p className="text-lg text-stone-400 max-w-2xl mx-auto leading-relaxed mb-10">
            A complete accounts receivable platform — syncs with QuickBooks, automates your collection emails, and gives your team a real-time view of every outstanding invoice.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/login"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-sm px-7 py-3.5 rounded-xl transition-all hover:shadow-lg hover:shadow-emerald-500/25 active:scale-[0.98]">
              Open the dashboard
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
            <a href="#features"
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 text-stone-300 hover:text-white border border-stone-700 hover:border-stone-500 text-sm px-7 py-3.5 rounded-xl transition-colors">
              See features
            </a>
          </div>
        </div>

        {/* Dashboard preview card */}
        <div className="relative max-w-5xl mx-auto mt-16">
          <div className="rounded-2xl border border-stone-700/60 bg-stone-900/60 overflow-hidden shadow-2xl shadow-black/40 backdrop-blur">
            {/* Fake browser chrome */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-stone-700/60 bg-stone-900">
              <div className="w-3 h-3 rounded-full bg-stone-700" />
              <div className="w-3 h-3 rounded-full bg-stone-700" />
              <div className="w-3 h-3 rounded-full bg-stone-700" />
              <div className="ml-3 flex-1 h-5 bg-stone-800 rounded-md max-w-xs text-xs text-stone-600 flex items-center px-3">primeaccountax.com/board</div>
            </div>
            {/* Fake dashboard content */}
            <div className="p-6">
              {/* Stats row */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                {[
                  { label: "Total Outstanding", value: "PKR 4.2M", up: true },
                  { label: "Overdue Invoices", value: "28", up: false },
                  { label: "Promises This Week", value: "12", up: true },
                  { label: "Emails Sent Today", value: "34", up: true },
                ].map(s => (
                  <div key={s.label} className="rounded-xl bg-stone-800/60 p-3.5">
                    <div className="text-xs text-stone-500 mb-1">{s.label}</div>
                    <div className="text-lg font-semibold text-white">{s.value}</div>
                    <div className={`text-xs mt-0.5 ${s.up ? "text-emerald-400" : "text-rose-400"}`}>
                      {s.up ? "↑ 8% vs last month" : "↑ 3 new today"}
                    </div>
                  </div>
                ))}
              </div>
              {/* Fake table rows */}
              <div className="rounded-xl border border-stone-700/40 overflow-hidden">
                <div className="grid grid-cols-5 gap-3 px-4 py-2.5 bg-stone-800/40 text-xs text-stone-500 font-medium">
                  <span>Customer</span><span>Invoice</span><span>Amount</span><span>Stage</span><span>Response</span>
                </div>
                {[
                  { cust: "Al Baraka Group", inv: "INV-1042", amt: "PKR 280,000", stage: "2nd Chase", resp: "Promise", color: "text-amber-400", dot: "bg-amber-400" },
                  { cust: "Fatima Industries", inv: "INV-0987", amt: "PKR 145,000", stage: "1st Chase", resp: "Sent", color: "text-blue-400", dot: "bg-blue-400" },
                  { cust: "Metro Logistics", inv: "INV-1101", amt: "PKR 520,000", stage: "Overdue", resp: "Disputed", color: "text-rose-400", dot: "bg-rose-400" },
                  { cust: "Pak Agri Ltd", inv: "INV-0912", amt: "PKR 95,000", stage: "3rd Chase", resp: "No Reply", color: "text-stone-500", dot: "bg-stone-600" },
                ].map(row => (
                  <div key={row.inv} className="grid grid-cols-5 gap-3 px-4 py-3 border-t border-stone-700/30 text-sm items-center hover:bg-stone-800/20 transition-colors">
                    <span className="text-stone-200 font-medium truncate">{row.cust}</span>
                    <span className="text-stone-400 font-mono text-xs">{row.inv}</span>
                    <span className="text-stone-300">{row.amt}</span>
                    <span className="text-stone-400 text-xs">{row.stage}</span>
                    <span className={`flex items-center gap-1.5 text-xs font-medium ${row.color}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${row.dot}`} />{row.resp}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          {/* Glow under card */}
          <div className="absolute -bottom-6 left-1/2 -translate-x-1/2 w-3/4 h-8 bg-emerald-500/20 blur-2xl rounded-full" />
        </div>
      </section>

      {/* ── STATS ── */}
      <section id="stats" className="py-16 px-5 border-y border-stone-800">
        <div className="max-w-4xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-8 text-center">
          {[
            { n: 85, suffix: "%", label: "Reduction in manual chasing" },
            { n: 40, suffix: "%", label: "Faster invoice collection" },
            { n: 100, suffix: "%", label: "QuickBooks sync accuracy" },
            { n: 3, suffix: "x", label: "More responses from customers" },
          ].map(s => (
            <div key={s.label}>
              <div className="text-4xl font-bold text-emerald-400 mb-1">
                <Counter end={s.n} suffix={s.suffix} />
              </div>
              <div className="text-sm text-stone-500">{s.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── FEATURES ── */}
      <section id="features" className="py-20 px-5">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">Everything your AR team needs</h2>
            <p className="text-stone-400 text-lg max-w-xl mx-auto">Built specifically for accounting firms managing collections on behalf of clients.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map(f => (
              <div key={f.title} className="group rounded-2xl border border-stone-800 bg-stone-900/40 p-6 hover:border-emerald-500/40 hover:bg-stone-900/80 transition-all duration-200">
                <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4 group-hover:bg-emerald-500/20 transition-colors">
                  {f.icon}
                </div>
                <h3 className="text-base font-semibold text-white mb-2">{f.title}</h3>
                <p className="text-sm text-stone-400 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section id="how-it-works" className="py-20 px-5 bg-stone-900/30">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-3">Up and running in minutes</h2>
            <p className="text-stone-400 text-lg">No complex setup. Connect QuickBooks and your team is collecting.</p>
          </div>
          <div className="relative">
            {/* Connecting line */}
            <div className="hidden md:block absolute left-[22px] top-8 bottom-8 w-px bg-gradient-to-b from-emerald-500/40 via-emerald-500/20 to-transparent" />
            <div className="space-y-8">
              {STEPS.map((s, i) => (
                <div key={s.n} className="flex gap-6 items-start">
                  <div className="flex-shrink-0 w-11 h-11 rounded-full border-2 border-emerald-500/50 bg-stone-950 flex items-center justify-center text-xs font-bold text-emerald-400 z-10">
                    {s.n}
                  </div>
                  <div className="pt-2">
                    <h3 className="text-base font-semibold text-white mb-1">{s.title}</h3>
                    <p className="text-sm text-stone-400 leading-relaxed">{s.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="py-24 px-5">
        <div className="max-w-2xl mx-auto text-center">
          <div className="rounded-2xl border border-emerald-500/20 bg-gradient-to-b from-emerald-500/5 to-transparent p-12">
            <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">Ready to get paid faster?</h2>
            <p className="text-stone-400 mb-8 text-lg">Sign in to your Prime Accountax collections dashboard.</p>
            <Link href="/login"
              className="inline-flex items-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold px-8 py-4 rounded-xl transition-all hover:shadow-lg hover:shadow-emerald-500/30 text-sm active:scale-[0.98]">
              Open dashboard
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
              </svg>
            </Link>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t border-stone-800 py-8 px-5">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4 text-sm text-stone-500">
          <div className="flex items-center gap-2">
            <div className="w-5 h-5 rounded bg-emerald-500 flex items-center justify-center">
              <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
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

    </div>
  );
}
