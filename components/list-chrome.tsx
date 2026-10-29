"use client";

/**
 * The page-level chrome of a record list — everything the Invoices page has
 * around its table, made reusable: a search box, the date-period filter, row
 * selection with its selection bar, and Export Excel.
 *
 * components/list-view.tsx owns the TABLE (sort, column filters, chips,
 * totals). This owns what sits around it. Before this, only the Invoices page
 * had search, a date period, bulk selection or an export, so every other list
 * looked like the same screen and behaved like a lesser one.
 *
 * Usage:
 *   const period = usePeriodFilter("all");
 *   const sel = useRowSelection(lv.rows);
 *   <ListPageHeader …>
 *     <ListSearch value={q} onChange={setQ} placeholder="Search number, supplier…" />
 *     <ListPeriodFilter state={period} label="Date" />
 *   </ListPageHeader>
 *   {sel.count > 0 && <ListSelectionBar summary="…" onClear={sel.clear}>…actions…</ListSelectionBar>}
 *   <ListToolbar …><ListExportButton onClick={…} /></ListToolbar>
 *   <ListHead lv={lv} selection={sel.selection} />
 */

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Search, Download, X } from "lucide-react";
import { SelectField, control } from "@/components/form-kit";
import { localToday } from "@/lib/format";
import { PERIODS, periodWindow, periodLabel, type PeriodId, type DateWindow } from "@/lib/list-period";

// ─────────────────────────────────────────────────────────────────────────────
// Search
// ─────────────────────────────────────────────────────────────────────────────

export function ListSearch({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div className="relative">
      <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        aria-label={placeholder} className={`${control} h-8 w-60 pl-7 pr-2 text-[12px]`} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Date period
// ─────────────────────────────────────────────────────────────────────────────

export type PeriodFilterState = {
  period: PeriodId;
  setPeriod: (p: PeriodId) => void;
  customFrom: string;
  setCustomFrom: (d: string) => void;
  customTo: string;
  setCustomTo: (d: string) => void;
  /** The inclusive window the rows are filtered by — pass to `inWindow`. */
  range: DateWindow;
  label: string;
};

/** `initial` is per screen: Invoices opens on last month; a PO list opens on
 *  "all" so an open order from last quarter is never silently hidden. */
export function usePeriodFilter(initial: PeriodId): PeriodFilterState {
  const [period, setPeriod] = useState<PeriodId>(initial);
  const [customFrom, setCustomFrom] = useState(() => periodWindow("last-month", { from: "", to: "" }).from);
  const [customTo, setCustomTo] = useState(localToday);
  const range = useMemo(() => periodWindow(period, { from: customFrom, to: customTo }), [period, customFrom, customTo]);
  return { period, setPeriod, customFrom, setCustomFrom, customTo, setCustomTo, range, label: periodLabel(period) };
}

export function ListPeriodFilter({ state, label, capAtToday = false }: {
  state: PeriodFilterState;
  /** What the date is — "Invoice date", "Order date". */
  label: string;
  /** Stop the custom "to" at today (the Invoices page's rule). */
  capAtToday?: boolean;
}) {
  return (
    <>
      <SelectField value={state.period} onChange={(e) => state.setPeriod(e.target.value as PeriodId)}
        aria-label={`${label} period`} className="w-auto h-8 text-[12px]">
        {PERIODS.map((p) => <option key={p.id} value={p.id}>{label}: {p.label}</option>)}
      </SelectField>
      {state.period === "custom" && (
        <>
          <input type="date" value={state.customFrom} max={state.customTo} onChange={(e) => state.setCustomFrom(e.target.value)}
            aria-label="From" className={`${control} h-8 w-auto text-[12px]`} />
          <input type="date" value={state.customTo} min={state.customFrom} max={capAtToday ? localToday() : undefined}
            onChange={(e) => state.setCustomTo(e.target.value)} aria-label="To" className={`${control} h-8 w-auto text-[12px]`} />
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Row selection
// ─────────────────────────────────────────────────────────────────────────────

export function useRowSelection<T extends { id: string }>(rows: T[]) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // A bulk action must never operate on rows the user can no longer see —
  // prune the selection when a filter hides them (the board's rule).
  useEffect(() => {
    const visible = new Set(rows.map((r) => r.id));
    setSelected((prev) => ([...prev].some((id) => !visible.has(id)) ? new Set([...prev].filter((id) => visible.has(id))) : prev));
  }, [rows]);

  const all = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const some = selected.size > 0;
  const toggleAll = () => setSelected(all ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOne = (id: string) =>
    setSelected((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const clear = () => setSelected(new Set());

  return {
    selected,
    count: selected.size,
    isSelected: (id: string) => selected.has(id),
    toggleOne,
    clear,
    /** Pass straight to ListHead's `selection`. */
    selection: { all, some, onToggle: toggleAll },
  };
}

export function ListSelectionBar({ summary, onClear, children }: {
  /** "3 selected · €1,200.00" */
  summary: ReactNode;
  onClear: () => void;
  /** The page's own bulk actions. */
  children?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 bg-stone-900 text-white border-b border-stone-800 flex-wrap shrink-0">
      <span className="text-[13px] font-medium">{summary}</span>
      <div className="flex-1" />
      {children}
      <button onClick={onClear} className="text-stone-400 hover:text-white p-1" aria-label="Clear selection"><X size={15} /></button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Export
// ─────────────────────────────────────────────────────────────────────────────

export function ListExportButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="flex items-center gap-1.5 text-[12px] font-medium rounded-md px-2.5 py-1.5 border text-stone-400 border-stone-700 hover:bg-stone-800 transition-colors disabled:opacity-50">
      <Download size={13} /> Export Excel
    </button>
  );
}

export type ExportColumn<T> = {
  header: string;
  value: (row: T) => string | number | null | undefined;
  /** Column width in characters. */
  width?: number;
};

/** Writes the rows to an .xlsx download. The columns are named by the page, so
 *  an export can carry fields the table doesn't show (paid, currency, email). */
export async function exportRowsToExcel<T>({ rows, columns, sheet, filename }: {
  rows: T[]; columns: ExportColumn<T>[]; sheet: string; filename: string;
}): Promise<void> {
  const XLSX = await import("xlsx");
  const data = rows.map((r) => Object.fromEntries(columns.map((c) => [c.header, c.value(r) ?? ""])));
  const ws = XLSX.utils.json_to_sheet(data);
  ws["!cols"] = columns.map((c) => ({ wch: c.width ?? 16 }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheet);
  XLSX.writeFile(wb, filename);
}
