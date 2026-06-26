"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Search, Building2, FileText, Users, Loader } from "lucide-react";

type Result = { type: string; id: string; label: string; sublabel: string; href: string };

const TYPE_ICON: Record<string, any> = {
  lead: FileText,
  account: Building2,
  customer: Users,
};

export function AdminCommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [idx, setIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const search = useCallback((term: string) => {
    if (term.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    fetch(`/api/admin/search?q=${encodeURIComponent(term.trim())}`)
      .then(r => r.ok ? r.json() : { results: [] })
      .then(d => { setResults(d.results ?? []); setIdx(0); })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setResults([]);
    setIdx(0);
    setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => search(q), 200);
    return () => clearTimeout(t);
  }, [q, open, search]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      if (e.key === "ArrowDown") { e.preventDefault(); setIdx(i => Math.min(i + 1, results.length - 1)); }
      if (e.key === "ArrowUp") { e.preventDefault(); setIdx(i => Math.max(i - 1, 0)); }
      if (e.key === "Enter" && results[idx]) {
        e.preventDefault();
        router.push(results[idx].href);
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, results, idx, router, onClose]);

  if (!open) return null;

  const go = (href: string) => { router.push(href); onClose(); };

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div className="relative w-full max-w-lg rounded-xl shadow-2xl overflow-hidden" style={{ background: "#111726", border: "0.5px solid #202A3E" }} onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 px-4 h-12 border-b border-stone-800">
          <Search size={15} className="text-stone-600 shrink-0" />
          <input ref={inputRef} value={q} onChange={e => setQ(e.target.value)} placeholder="Search leads, accounts, customers…"
            className="flex-1 bg-transparent text-sm text-stone-200 placeholder-stone-600 focus:outline-none" />
          {loading && <Loader size={14} className="animate-spin text-stone-600" />}
        </div>
        <div className="max-h-80 overflow-y-auto py-1">
          {q.trim().length < 2 ? (
            <p className="px-4 py-6 text-xs text-stone-600 text-center">Type at least 2 characters to search</p>
          ) : results.length === 0 && !loading ? (
            <p className="px-4 py-6 text-xs text-stone-600 text-center">No results for &ldquo;{q}&rdquo;</p>
          ) : results.map((r, i) => {
            const Icon = TYPE_ICON[r.type] ?? Search;
            return (
              <button key={`${r.type}-${r.id}`} onClick={() => go(r.href)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-colors ${i === idx ? "bg-violet-500/10" : "hover:bg-stone-800/40"}`}>
                <Icon size={14} className="text-stone-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-stone-200 truncate">{r.label}</div>
                  <div className="text-[11px] text-stone-500 truncate">{r.sublabel}</div>
                </div>
                <span className="text-[10px] text-stone-600 capitalize shrink-0">{r.type}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function useCommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen(o => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return { open, setOpen };
}
