"use client";

import { useState, useEffect } from "react";
import {
  Camera, Lightbulb, AlertTriangle, Info, Printer, ChevronRight,
} from "lucide-react";

// ── Content model ────────────────────────────────────────────────────────────
export type GuideBlock =
  | { type: "p"; text: string }
  | { type: "subhead"; text: string }
  | { type: "steps"; items: string[] }
  | { type: "bullets"; items: string[] }
  | { type: "callout"; tone?: "tip" | "warn" | "info"; text: string }
  | { type: "figure"; title: string; caption?: string; where?: string };

export type GuideSection = {
  id: string;
  title: string;
  icon?: any;
  intro?: string;
  blocks: GuideBlock[];
};

// ── Screenshot placeholder ────────────────────────────────────────────────────
// A clearly-marked slot the team can later replace with a real <img>. `where`
// tells whoever captures the screenshot exactly which screen/URL to grab.
function Figure({ title, caption, where }: { title: string; caption?: string; where?: string }) {
  return (
    <figure className="my-4 rounded-xl border border-dashed border-stone-700 bg-stone-900/40 overflow-hidden">
      <div className="aspect-[16/8] flex flex-col items-center justify-center gap-2 text-center px-6">
        <div className="w-11 h-11 rounded-full bg-stone-800 flex items-center justify-center">
          <Camera size={18} className="text-stone-500" />
        </div>
        <p className="text-[13px] font-medium text-stone-300">{title}</p>
        {where && (
          <p className="text-[11px] text-stone-500">
            Capture: <span className="text-stone-400 font-mono">{where}</span>
          </p>
        )}
        <span className="text-[10px] uppercase tracking-widest text-stone-600 font-semibold">Screenshot</span>
      </div>
      {caption && (
        <figcaption className="border-t border-stone-800 px-4 py-2 text-[11px] text-stone-500">{caption}</figcaption>
      )}
    </figure>
  );
}

function Callout({ tone = "tip", text }: { tone?: "tip" | "warn" | "info"; text: string }) {
  const map = {
    tip:  { icon: Lightbulb,     ring: "ring-emerald-500/30", bg: "bg-emerald-500/5",  fg: "text-emerald-400", label: "Tip" },
    warn: { icon: AlertTriangle, ring: "ring-amber-500/30",   bg: "bg-amber-500/5",    fg: "text-amber-400",   label: "Important" },
    info: { icon: Info,          ring: "ring-sky-500/30",     bg: "bg-sky-500/5",      fg: "text-sky-400",     label: "Note" },
  }[tone];
  const Icon = map.icon;
  return (
    <div className={`my-4 rounded-lg ring-1 ${map.ring} ${map.bg} px-4 py-3 flex gap-3`}>
      <Icon size={15} className={`${map.fg} mt-0.5 shrink-0`} />
      <div>
        <span className={`text-[11px] font-semibold ${map.fg} uppercase tracking-wider`}>{map.label}</span>
        <p className="text-[13px] text-stone-300 leading-relaxed mt-0.5">{text}</p>
      </div>
    </div>
  );
}

function renderBlock(b: GuideBlock, i: number) {
  switch (b.type) {
    case "p":
      return <p key={i} className="text-[13.5px] text-stone-400 leading-relaxed my-3">{b.text}</p>;
    case "subhead":
      return <h3 key={i} className="text-sm font-semibold text-white mt-6 mb-1">{b.text}</h3>;
    case "steps":
      return (
        <ol key={i} className="my-3 space-y-2">
          {b.items.map((s, j) => (
            <li key={j} className="flex gap-3 text-[13.5px] text-stone-300 leading-relaxed">
              <span className="shrink-0 w-5 h-5 rounded-full bg-emerald-500/15 text-emerald-400 text-[11px] font-semibold flex items-center justify-center mt-0.5">{j + 1}</span>
              <span dangerouslySetInnerHTML={{ __html: s }} />
            </li>
          ))}
        </ol>
      );
    case "bullets":
      return (
        <ul key={i} className="my-3 space-y-1.5">
          {b.items.map((s, j) => (
            <li key={j} className="flex gap-2.5 text-[13.5px] text-stone-400 leading-relaxed">
              <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-stone-600 mt-2" />
              <span dangerouslySetInnerHTML={{ __html: s }} />
            </li>
          ))}
        </ul>
      );
    case "callout":
      return <Callout key={i} tone={b.tone} text={b.text} />;
    case "figure":
      return <Figure key={i} title={b.title} caption={b.caption} where={b.where} />;
  }
}

// ── Layout: sticky TOC + sections ─────────────────────────────────────────────
export function GuideLayout({ title, subtitle, sections }: {
  title: string; subtitle: string; sections: GuideSection[];
}) {
  const [active, setActive] = useState(sections[0]?.id);

  useEffect(() => {
    const obs = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -70% 0px", threshold: 0 },
    );
    sections.forEach(s => { const el = document.getElementById(s.id); if (el) obs.observe(el); });
    return () => obs.disconnect();
  }, [sections]);

  return (
    <div className="max-w-6xl mx-auto px-5 py-8">
      {/* Header */}
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">{title}</h1>
          <p className="text-sm text-stone-500 mt-1 max-w-2xl">{subtitle}</p>
        </div>
        <button
          onClick={() => window.print()}
          className="print:hidden shrink-0 flex items-center gap-2 h-9 px-3.5 text-xs font-medium rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 transition-colors">
          <Printer size={14} /> Print / Save as PDF
        </button>
      </div>

      <div className="flex gap-8">
        {/* TOC */}
        <nav className="print:hidden hidden lg:block w-56 shrink-0">
          <div className="sticky top-6 space-y-0.5">
            <p className="text-[10px] font-semibold text-stone-600 uppercase tracking-widest px-2.5 pb-1.5">On this page</p>
            {sections.map(s => {
              const Icon = s.icon;
              const on = active === s.id;
              return (
                <a key={s.id} href={`#${s.id}`}
                  className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-[12.5px] transition-colors ${
                    on ? "bg-stone-800 text-white font-medium" : "text-stone-500 hover:text-stone-300 hover:bg-stone-900"}`}>
                  {Icon && <Icon size={13} className={on ? "text-emerald-400" : "text-stone-600"} />}
                  <span className="flex-1 truncate">{s.title}</span>
                  {on && <ChevronRight size={11} className="text-stone-600" />}
                </a>
              );
            })}
          </div>
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0 max-w-3xl">
          {sections.map(s => {
            const Icon = s.icon;
            return (
              <section key={s.id} id={s.id} className="scroll-mt-20 mb-12">
                <div className="flex items-center gap-2.5 mb-1 pb-2 border-b border-stone-800">
                  {Icon && (
                    <span className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <Icon size={15} className="text-emerald-400" />
                    </span>
                  )}
                  <h2 className="text-lg font-semibold text-white">{s.title}</h2>
                </div>
                {s.intro && <p className="text-[13.5px] text-stone-400 leading-relaxed mt-3">{s.intro}</p>}
                {s.blocks.map(renderBlock)}
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
