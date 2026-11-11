"use client";

/**
 * One box that finds an item by typing. In "add" mode it also reads an amount
 * ("honey 7", "salt 200g") and hands it to onPick, so a line is name + amount +
 * Enter. Arrow keys move, Enter picks, Escape closes.
 */

import { useMemo, useRef, useState } from "react";
import { Plus, Search } from "lucide-react";
import { kindOf } from "@/lib/inventory/item-kinds";
import { parseEntry } from "@/lib/inventory/bom-rules";
import { controlInset } from "@/components/form-kit";
import type { ItemLite } from "./draft";

export interface PickedEntry { qty: number | null; unit: string }

const MAX_RESULTS = 6;

export function ItemTypeahead({ items, placeholder, mode, exclude, rank, onPick, onCreate, inputId }: {
  items: ItemLite[];
  placeholder: string;
  mode: "search" | "add";
  /** Items that cannot be picked here (already in the recipe, wrong kind). */
  exclude?: (i: ItemLite) => boolean;
  /** Higher sorts first. */
  rank?: (i: ItemLite) => number;
  onPick: (item: ItemLite, entry: PickedEntry) => void;
  /** Shown when nothing matches: "Create it here". Gets the typed name. */
  onCreate?: (name: string) => void;
  inputId?: string;
}) {
  const [q, setQ] = useState("");
  const [hl, setHl] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const entry = mode === "add" ? parseEntry(q) : { query: q.trim(), qty: null as number | null, unit: "" };

  const matches = useMemo(() => {
    const words = entry.query.toLowerCase().split(/\s+/).filter(Boolean);
    if (mode === "add" && !words.length) return [];
    const list = items.filter(i => !(exclude?.(i)) && words.every(w => `${i.name} ${i.code ?? ""}`.toLowerCase().includes(w)));
    if (rank) list.sort((a, b) => rank(b) - rank(a));
    return list.slice(0, MAX_RESULTS);
  }, [items, entry.query, exclude, rank, mode]);

  function pick(i: ItemLite) {
    onPick(i, { qty: entry.qty, unit: entry.unit });
    setQ(""); setHl(0); setOpen(false);
    ref.current?.focus();
  }

  return (
    <div className="relative">
      {mode === "add" ? <Plus size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-primary pointer-events-none" /> : <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-500 pointer-events-none" />}
      <input
        ref={ref} id={inputId} value={q} autoComplete="off" placeholder={placeholder} aria-label={placeholder}
        onChange={e => { setQ(e.target.value); setHl(0); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={e => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); setHl(h => Math.max(0, Math.min(matches.length - 1, h + (e.key === "ArrowDown" ? 1 : -1)))); }
          else if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); if (matches[hl]) pick(matches[hl]); }
          else if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); }
        }}
        className={`${controlInset} pl-9 ${mode === "add" ? "border-dashed" : ""}`}
      />
      {open && q.trim() && (
        <div role="listbox" className="absolute z-30 left-0 right-0 top-full mt-1 rounded-lg border border-stone-700 bg-stone-900 shadow-2xl p-1 max-h-72 overflow-auto">
          {matches.length === 0 ? (
            <div className="px-3 py-2.5 text-[12px] text-stone-400">
              No item called “{entry.query}”.{" "}
              {onCreate && <button type="button" onMouseDown={e => e.preventDefault()} onClick={() => { onCreate(entry.query); setQ(""); setOpen(false); }} className="text-sky-400 font-semibold hover:underline">Create it here</button>}
            </div>
          ) : matches.map((i, ix) => (
            <div key={i.id} role="option" aria-selected={ix === hl}
              onMouseDown={e => e.preventDefault()} onClick={() => pick(i)} onMouseEnter={() => setHl(ix)}
              className={`flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer ${ix === hl ? "bg-stone-800" : ""}`}>
              <span className="text-[11px] font-semibold text-stone-400 border border-stone-700 rounded-lg px-1.5">{kindOf(i.productType).code}</span>
              <span className="text-[13px] text-stone-100 font-medium truncate">{i.name}</span>
              <span className="text-[11px] text-stone-500 font-mono">{i.code}</span>
              {entry.qty != null && <span className="ml-auto text-[12px] text-sky-400 tabular-nums">{entry.qty} {entry.unit || i.baseUom}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
