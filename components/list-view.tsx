"use client";

/**
 * ListView — the Collections Board List view's table shell, made reusable.
 *
 * The board's list (components/board-list.tsx) is the reference design for
 * every record list in the app: a count + per-currency total toolbar, sort and
 * funnel filters on each header with a popover, filter chips with Clear all, a
 * sticky header, 40px rows, and a footer whose totals sit under the column
 * they total. Before this, each screen hand-rolled its own table and
 * `components/data-table.tsx` drew a different header, a different filter
 * popover and no totals at all — so the same kind of screen looked and behaved
 * differently depending on which module you were in.
 *
 * Deliberately NOT here: anything collections-specific (stage pills, next
 * action, composition strip, activity hub, grouping bands). Those belong to
 * the board; a screen that needs an equivalent builds it on top of this.
 *
 * Usage:
 *   const lv = useListView(rows, COLS, { storageKey: "invoices", summary: "outstanding" });
 *   <ListToolbar lv={lv} noun="invoice" />
 *   <ListChips lv={lv} />
 *   <ListScroll lv={lv} empty="No invoices match the current filters.">
 *     <table className={listTable}>
 *       <ListHead lv={lv} selection={{ all, some, onToggle }} trailing={1} />
 *       <tbody>{lv.rows.map(r => <tr className={listRow(sel)}>…</tr>)}</tbody>
 *       <ListFoot lv={lv} selectable trailing={1} />
 *     </table>
 *   </ListScroll>
 */

import { useState, useMemo, useEffect, type ReactNode } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, Filter, X } from "lucide-react";
import { fmt } from "@/lib/format";

// ─────────────────────────────────────────────────────────────────────────────
// Style tokens — copied from board-list.tsx so the two cannot be told apart.
// Use these rather than re-typing class strings in a screen.
// ─────────────────────────────────────────────────────────────────────────────

export const listTable = "w-full text-[13px]";
export const listCheckbox = "rounded border-stone-600 accent-emerald-600 cursor-pointer";
/** An ordinary data cell. */
export const listCell = "px-2 py-2";
/** The first (checkbox) cell of a row. */
export const listCheckCell = "px-2 py-2.5 pl-4 w-10";
/** THE money column (the one the toolbar totals): its own rule, right-aligned,
 *  tabular — the ledger column. One per table, as on the board. */
export const listMoneyCell = "px-2 py-2 text-right tabular-nums whitespace-nowrap border-l border-stone-800";
/** Any other number / money column — right-aligned, tabular, no rule. */
export const listNumCell = "px-2 py-2 text-right tabular-nums whitespace-nowrap";
/** A row. Selected rows tint emerald, exactly as on the board. */
export const listRow = (selected = false) =>
  `h-[40px] border-b border-stone-800 transition-colors ${selected ? "bg-emerald-500/10 hover:bg-emerald-500/15" : "hover:bg-stone-800/50"}`;

const thCls = "px-2 py-2 text-[11px] font-medium text-stone-500 whitespace-nowrap";
const inputCls = "w-full text-[11px] border border-stone-700 rounded px-1.5 py-1 bg-stone-800 text-stone-300 outline-none focus:ring-1 focus:ring-emerald-500";
const BLANK = "(Blank)";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ListFilterDef<T> =
  /** Contains-match on the text. */
  | { kind: "text"; value: (r: T) => string | null | undefined }
  /** Pick any of the distinct values present. A null/empty value is offered as "(Blank)". */
  | { kind: "multi"; value: (r: T) => string | null | undefined }
  /** Minimum / maximum on a number. */
  | { kind: "range"; value: (r: T) => number | null | undefined };

export type ListColumn<T> = {
  key: string;
  label: string;
  align?: "left" | "right" | "center";
  /** Sort key. Omit to make the column unsortable. Nulls always sort last. */
  sort?: (r: T) => string | number | null | undefined;
  /** First click sorts descending — for money, age and urgency, where the
   *  interesting end is the top. */
  descFirst?: boolean;
  filter?: ListFilterDef<T>;
  /** Marks a money column: totalled per currency in the footer. The one named
   *  as the view's `summary` also gets the ledger rule. */
  money?: (r: T) => { amount: number; currency?: string | null };
  /** A plain number column that should be summed in the footer (counts, qty). */
  sum?: (r: T) => number;
  /** Hide the column (e.g. a card/list screen that drops one in some mode). */
  hidden?: boolean;
};

type FilterValue = string | string[] | { min?: string; max?: string };
type Filters = Record<string, FilterValue>;

export type ListViewState<T> = {
  /** Filtered + sorted rows — render these. */
  rows: T[];
  /** Everything passed in, before column filters. */
  allRows: T[];
  columns: ListColumn<T>[];
  sortCol: string | null;
  sortDir: "asc" | "desc";
  handleSort: (key: string) => void;
  filters: Filters;
  setFilter: (key: string, v: FilterValue | null) => void;
  clearAll: () => void;
  anyFilter: boolean;
  chips: { key: string; label: string }[];
  /** Distinct values for a multi filter, from the unfiltered rows. */
  optionsFor: (key: string) => string[];
  /** Per-currency total of the `summary` column over the filtered rows. */
  summary: Record<string, number> | null;
  summaryKey: string | null;
  openFilter: string | null;
  setOpenFilter: (k: string | null) => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// Money helpers
// ─────────────────────────────────────────────────────────────────────────────

/** fmt.money renders anything that isn't a 3-letter code as EUR, so the totals
 *  key on the same normalised code — otherwise a blank and an explicit EUR
 *  would print as two separate € lines. */
const normCcy = (c?: string | null) => (/^[A-Z]{3}$/.test(c ?? "") ? (c as string) : "EUR");

export function sumByCurrency<T>(rows: T[], money: (r: T) => { amount: number; currency?: string | null }): Record<string, number> {
  const m: Record<string, number> = {};
  rows.forEach(r => {
    const { amount, currency } = money(r);
    const n = Number(amount);
    if (!n || isNaN(n)) return;
    const c = normCcy(currency);
    m[c] = (m[c] ?? 0) + n;
  });
  return m;
}

const sortedTotals = (t: Record<string, number>) => Object.entries(t).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));

/** One currency per line so the decimals align — never joined with " · ". */
export function MoneyStack({ totals, className = "" }: { totals: Record<string, number>; className?: string }) {
  const e = sortedTotals(totals);
  if (e.length === 0) return <span className={className}>{fmt.money(0)}</span>;
  return <>{e.map(([c, v]) => <div key={c} className={className}>{fmt.money(v, c)}</div>)}</>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useListView<T>(data: T[], columns: ListColumn<T>[], opts: {
  /** Filters persist per screen under this key, like the board's working view. */
  storageKey: string;
  defaultSort?: string;
  defaultDir?: "asc" | "desc";
  /** Money column whose per-currency total the toolbar shows. */
  summary?: string;
}): ListViewState<T> {
  const cols = useMemo(() => columns.filter(c => !c.hidden), [columns]);
  const [sortCol, setSortCol] = useState<string | null>(opts.defaultSort ?? null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(opts.defaultDir ?? "asc");
  const [filters, setFilters] = useState<Filters>({});
  const [openFilter, setOpenFilter] = useState<string | null>(null);

  // Hydrate in an effect, not a state initializer, so the first client render
  // matches the server render (same reason as board-list.tsx).
  const storeKey = `list-view:${opts.storageKey}`;
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(storeKey) ?? "{}");
      if (stored && typeof stored.filters === "object" && stored.filters) setFilters(stored.filters);
    } catch {}
    setHydrated(true);
  }, [storeKey]);
  useEffect(() => {
    if (!hydrated) return;
    try { localStorage.setItem(storeKey, JSON.stringify({ filters })); } catch {}
  }, [filters, hydrated, storeKey]);

  const setFilter = (key: string, v: FilterValue | null) => setFilters(p => {
    const n = { ...p };
    const empty = v == null || v === "" || (Array.isArray(v) && v.length === 0) ||
      (typeof v === "object" && !Array.isArray(v) && !v.min && !v.max);
    if (empty) delete n[key]; else n[key] = v!;
    return n;
  });
  const clearAll = () => setFilters({});

  // A stored filter for a column this screen no longer has (renamed/removed)
  // must not silently hide rows with no chip to clear it — ignore it.
  const activeFilters = useMemo(() => {
    const m: Filters = {};
    Object.entries(filters).forEach(([k, v]) => { if (cols.some(c => c.key === k && c.filter)) m[k] = v; });
    return m;
  }, [filters, cols]);

  const optionsFor = (key: string): string[] => {
    const col = cols.find(c => c.key === key);
    if (!col?.filter || col.filter.kind !== "multi") return [];
    const f = col.filter;
    const s = new Set<string>();
    data.forEach(r => s.add(((f.value(r) ?? "") as string).trim() || BLANK));
    return [...s].sort((a, b) => a === BLANK ? 1 : b === BLANK ? -1 : a.localeCompare(b));
  };

  const filtered = useMemo(() => data.filter(r => {
    for (const [k, v] of Object.entries(activeFilters)) {
      const f = cols.find(c => c.key === k)!.filter!;
      if (f.kind === "text") {
        const q = String(v).trim().toLowerCase();
        if (q && !String(f.value(r) ?? "").toLowerCase().includes(q)) return false;
      } else if (f.kind === "multi") {
        const sel = v as string[];
        const val = ((f.value(r) ?? "") as string).trim() || BLANK;
        if (!sel.includes(val)) return false;
      } else {
        const { min, max } = v as { min?: string; max?: string };
        const n = Number(f.value(r) ?? 0);
        if (min !== undefined && min !== "" && n < Number(min)) return false;
        if (max !== undefined && max !== "" && n > Number(max)) return false;
      }
    }
    return true;
  }), [data, activeFilters, cols]);

  const rows = useMemo(() => {
    const col = cols.find(c => c.key === sortCol);
    if (!col?.sort) return filtered;
    const dir = sortDir === "asc" ? 1 : -1;
    const get = col.sort;
    return [...filtered].sort((a, b) => {
      const av = get(a), bv = get(b);
      const an = av == null || av === "", bn = bv == null || bv === "";
      if (an && bn) return 0;
      if (an) return 1;   // blanks last in BOTH directions
      if (bn) return -1;
      const c = typeof av === "number" && typeof bv === "number"
        ? av - bv
        : String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
      return c * dir;
    });
  }, [filtered, cols, sortCol, sortDir]);

  const handleSort = (key: string) => {
    const col = cols.find(c => c.key === key);
    setSortDir(prev => sortCol === key ? (prev === "asc" ? "desc" : "asc") : (col?.descFirst ? "desc" : "asc"));
    setSortCol(key);
  };

  const chips = useMemo(() => Object.entries(activeFilters).map(([k, v]) => {
    const col = cols.find(c => c.key === k)!;
    const f = col.filter!;
    let label: string;
    if (f.kind === "text") label = `${col.label} ~ "${v}"`;
    else if (f.kind === "multi") {
      const vals = v as string[];
      label = `${col.label}: ${vals.length > 2 ? `${vals.length} selected` : vals.join(", ")}`;
    } else {
      const { min, max } = v as { min?: string; max?: string };
      label = `${col.label}${min ? ` ≥ ${min}` : ""}${max ? ` ≤ ${max}` : ""}`;
    }
    return { key: k, label };
  }), [activeFilters, cols]);

  const summaryCol = opts.summary ? cols.find(c => c.key === opts.summary && c.money) : undefined;
  const summary = useMemo(() => summaryCol?.money ? sumByCurrency(rows, summaryCol.money) : null, [rows, summaryCol]);

  return {
    rows, allRows: data, columns: cols, sortCol, sortDir, handleSort,
    filters: activeFilters, setFilter, clearAll, anyFilter: chips.length > 0, chips,
    optionsFor, summary, summaryKey: summaryCol?.key ?? null, openFilter, setOpenFilter,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Page header — same anatomy as the Collections Board's header
// ─────────────────────────────────────────────────────────────────────────────

export function ListPageHeader({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children?: ReactNode }) {
  return (
    <div className="px-6 py-4 border-b border-stone-800 flex items-center justify-between gap-4 bg-stone-950 flex-shrink-0 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-[20px] font-semibold text-white tracking-tight">{title}</h1>
        {subtitle && <p className="text-[13px] text-stone-400 mt-0.5">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </div>
  );
}

/** Full-height page frame: header, toolbar, chips, then the scrolling table. */
export function ListPage({ children }: { children: ReactNode }) {
  // h-screen would overshoot by the 44px app top bar (see board page).
  return <div className="flex flex-col h-[calc(100vh-44px)]">{children}</div>;
}

/** Divider between the controls that choose WHICH rows and the ones that
 *  choose how they're drawn — the board's Cards/List separator. */
export const ListDivider = () => <span className="w-px h-6 bg-stone-800 mx-1" />;

// ─────────────────────────────────────────────────────────────────────────────
// Toolbar — "N invoices · €12,345.00 (filtered) · 3 selected"
// ─────────────────────────────────────────────────────────────────────────────

export function ListToolbar<T>({ lv, noun, plural, selected = 0, filtered, children }: {
  lv: ListViewState<T>;
  noun: string;
  plural?: string;
  selected?: number;
  /** Page-level filters (header search/selects) also make the view "filtered". */
  filtered?: boolean;
  children?: ReactNode;
}) {
  const n = lv.rows.length;
  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-stone-800 bg-stone-900 shrink-0 flex-wrap gap-y-1.5">
      <span className="text-[12px] text-stone-400">
        <span className="font-semibold text-stone-200">{n}</span> {n === 1 ? noun : (plural ?? `${noun}s`)}
        {lv.summary && (
          <>
            {" · "}
            <span className="font-semibold text-stone-200 tabular-nums">
              {sortedTotals(lv.summary).map(([c, v]) => fmt.money(v, c)).join(" · ") || fmt.money(0)}
            </span>
          </>
        )}
        {(lv.anyFilter || filtered) && <span className="text-stone-600"> (filtered)</span>}
        {selected ? ` · ${selected} selected` : ""}
      </span>
      {children && <div className="flex items-center gap-2">{children}</div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Active filter chips
// ─────────────────────────────────────────────────────────────────────────────

export function ListChips<T>({ lv }: { lv: ListViewState<T> }) {
  if (lv.chips.length === 0) return null;
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 border-b border-stone-800 bg-stone-950 shrink-0 flex-wrap">
      {lv.chips.map(c => (
        <span key={c.key} className="inline-flex items-center gap-1 text-[11px] text-emerald-300 bg-emerald-500/10 border border-emerald-900 rounded-full pl-2.5 pr-1.5 py-1">
          {c.label}
          <button onClick={() => lv.setFilter(c.key, null)} className="text-emerald-700 hover:text-emerald-300" aria-label={`Clear ${c.label}`}><X size={11} /></button>
        </span>
      ))}
      <button onClick={lv.clearAll} className="text-[11px] text-stone-500 hover:text-rose-400 font-medium">Clear all</button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Scroll container + empty state
// ─────────────────────────────────────────────────────────────────────────────

export function ListScroll<T>({ lv, empty, children }: { lv: ListViewState<T>; empty: ReactNode; children: ReactNode }) {
  return (
    <>
      {/* Click-away for header filter popovers. MUST stay BELOW the sticky
          thead (z-20): the popovers render inside the thead's stacking
          context, so an overlay above it swallows clicks inside them. */}
      {lv.openFilter && <div className="fixed inset-0 z-10" onClick={() => lv.setOpenFilter(null)} />}
      <div className="flex-1 overflow-auto">
        {children}
        {/* Keyed on the FILTERED rows, not the input — the board keys on its
            input, so a filter that matches nothing leaves a bare header. */}
        {lv.rows.length === 0 && (
          <div className="text-center text-[13px] text-stone-400 py-16">{empty}</div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Header
// ─────────────────────────────────────────────────────────────────────────────

export function ListHead<T>({ lv, selection, trailing = 0 }: {
  lv: ListViewState<T>;
  /** Omit for a screen without row selection. */
  selection?: { all: boolean; some: boolean; onToggle: () => void };
  /** Extra header cells after the columns (e.g. an actions column). */
  trailing?: number | ReactNode;
}) {
  return (
    <thead className="sticky top-0 bg-stone-900 z-20">
      <tr className="border-b border-stone-800 text-left">
        {selection && (
          <th className="px-3 py-2.5 w-10">
            <input type="checkbox" checked={selection.all}
              ref={el => { if (el) el.indeterminate = selection.some && !selection.all; }}
              onChange={selection.onToggle} className={listCheckbox} aria-label="Select all" />
          </th>
        )}
        {lv.columns.map(col => <HeadCell key={col.key} lv={lv} col={col} />)}
        {typeof trailing === "number"
          ? Array.from({ length: trailing }, (_, i) => <th key={`t${i}`} className={thCls} />)
          : trailing}
      </tr>
    </thead>
  );
}

function HeadCell<T>({ lv, col }: { lv: ListViewState<T>; col: ListColumn<T> }) {
  const active = col.key in lv.filters;
  const open = lv.openFilter === col.key;
  const right = col.align === "right";
  const alignCls = right ? "text-right" : col.align === "center" ? "text-center" : "";
  return (
    <th className={`${thCls} ${alignCls} relative group/th ${col.key === lv.summaryKey ? "border-l border-stone-800" : ""}`}>
      <span className="inline-flex items-center gap-0.5">
        {col.sort ? (
          <button onClick={() => lv.handleSort(col.key)} className="inline-flex items-center gap-1 hover:text-stone-200 transition-colors group">
            {col.label}
            {lv.sortCol === col.key
              ? lv.sortDir === "asc" ? <ChevronUp size={11} className="text-emerald-400" /> : <ChevronDown size={11} className="text-emerald-400" />
              : <ChevronsUpDown size={11} className="text-stone-600 group-hover:text-stone-400" />}
          </button>
        ) : col.label}
        {col.filter && (
          <button onClick={() => lv.setOpenFilter(open ? null : col.key)} aria-label={`Filter ${col.label}`}
            className={`p-0.5 rounded hover:bg-stone-800 transition-opacity ${active ? "text-emerald-400" : "text-stone-600 opacity-0 group-hover/th:opacity-100 focus-visible:opacity-100 hover:text-stone-300"}`}>
            <Filter size={11} fill={active ? "currentColor" : "none"} />
          </button>
        )}
      </span>
      {open && col.filter && <FilterPopover lv={lv} col={col} right={right} />}
    </th>
  );
}

function FilterPopover<T>({ lv, col, right }: { lv: ListViewState<T>; col: ListColumn<T>; right: boolean }) {
  const f = col.filter!;
  const v = lv.filters[col.key];
  const close = () => lv.setOpenFilter(null);
  return (
    <div className={`absolute ${right ? "right-0" : "left-0"} top-full mt-1 z-40 ${f.kind === "range" ? "w-52" : "w-60"} bg-stone-950 border border-stone-700 rounded-lg shadow-2xl p-3 normal-case font-normal tracking-normal text-left space-y-2`}
      onClick={e => e.stopPropagation()}>
      {f.kind === "text" && (
        <input autoFocus value={(v as string) ?? ""} onChange={e => lv.setFilter(col.key, e.target.value)}
          placeholder={`Filter ${col.label.toLowerCase()}…`} className={inputCls}
          onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") close(); }} />
      )}
      {f.kind === "multi" && (() => {
        const sel = new Set((v as string[]) ?? []);
        const toggle = (o: string) => { sel.has(o) ? sel.delete(o) : sel.add(o); lv.setFilter(col.key, [...sel]); };
        const opts = lv.optionsFor(col.key);
        return (
          <div className="max-h-52 overflow-y-auto space-y-1">
            {opts.length === 0 && <div className="text-[12px] text-stone-600">No values</div>}
            {opts.map(o => (
              <label key={o} className="flex items-center gap-2 text-[12px] text-stone-300 cursor-pointer hover:text-white">
                <input type="checkbox" checked={sel.has(o)} onChange={() => toggle(o)} className={listCheckbox} />
                <span className={`truncate ${o === BLANK ? "italic text-stone-500" : ""}`}>{o}</span>
              </label>
            ))}
          </div>
        );
      })()}
      {f.kind === "range" && (() => {
        const r = (v as { min?: string; max?: string }) ?? {};
        return (
          <>
            <input type="number" autoFocus value={r.min ?? ""} onChange={e => lv.setFilter(col.key, { ...r, min: e.target.value })} placeholder="Minimum (≥)" className={`${inputCls} text-right`} />
            <input type="number" value={r.max ?? ""} onChange={e => lv.setFilter(col.key, { ...r, max: e.target.value })} placeholder="Maximum (≤)" className={`${inputCls} text-right`} />
          </>
        );
      })()}
      <div className="flex items-center justify-between pt-1 border-t border-stone-800">
        <button onClick={() => lv.setFilter(col.key, null)} className="text-[11px] text-stone-500 hover:text-rose-400">Clear</button>
        <button onClick={close} className="text-[11px] font-semibold text-emerald-400 hover:text-emerald-300">Done</button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Footer — totals under the columns they total
// ─────────────────────────────────────────────────────────────────────────────

export function ListFoot<T>({ lv, noun, plural, selectable = false, trailing = 0 }: {
  lv: ListViewState<T>;
  noun: string;
  plural?: string;
  selectable?: boolean;
  trailing?: number;
}) {
  const cols = lv.columns;
  const first = cols.findIndex(c => c.money || c.sum);
  if (first < 0) return null;
  // Counted from the columns actually rendered, never hard-coded — the board's
  // footer once used colSpan={12} in a 9-column table and never lined up.
  const leading = (selectable ? 1 : 0) + first;
  const n = lv.rows.length;
  return (
    <tfoot>
      <tr className="border-t-2 border-stone-800 bg-stone-900/60 font-semibold">
        {leading > 0 && (
          <td colSpan={leading} className="px-3 py-2.5 text-[12px] text-stone-400 text-right">
            {n} {n === 1 ? noun : (plural ?? `${noun}s`)}
          </td>
        )}
        {cols.slice(first).map(c => (
          <td key={c.key} className={`px-2 py-2.5 tabular-nums whitespace-nowrap ${c.align === "right" || c.money || c.sum ? "text-right" : ""} ${c.key === lv.summaryKey ? "border-l border-stone-800" : ""}`}>
            {c.money
              ? <MoneyStack totals={sumByCurrency(lv.rows, c.money)} className="text-white text-[13px] font-semibold" />
              : c.sum
                ? <span className="text-white text-[13px] font-semibold">{fmt.qty(lv.rows.reduce((s, r) => s + (Number(c.sum!(r)) || 0), 0))}</span>
                : null}
          </td>
        ))}
        {Array.from({ length: trailing }, (_, i) => <td key={`t${i}`} />)}
      </tr>
    </tfoot>
  );
}
