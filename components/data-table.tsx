"use client";

/**
 * DataTable — Excel-style sort + column filter for every data page.
 *
 * Usage:
 *   const dt = useDataTable(myData, COLS);
 *   <table>
 *     <thead><tr>
 *       {COLS.map(col => <ColHeader key={col.key} col={col} dt={dt} />)}
 *     </tr></thead>
 *     <tbody>{dt.rows.map(row => ...)}</tbody>
 *   </table>
 */

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { ChevronUp, ChevronDown, ChevronsUpDown, ListFilter, Search } from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ColDef<T = any> {
  /** Unique key used for sort/filter state */
  key: string;
  /** Column header label */
  label: string;
  /** Value used for sorting — return number or string */
  sortValue?: (row: T) => string | number | null | undefined;
  /** Value shown in the filter dropdown (should be human-readable string) */
  filterLabel?: (row: T) => string;
  /** Disable sort for this column */
  noSort?: boolean;
  /** Disable filter for this column */
  noFilter?: boolean;
  /** Text alignment for the header */
  align?: "left" | "right" | "center";
}

export interface DataTableState {
  rows: any[];
  sortKey: string;
  sortDir: "asc" | "desc";
  handleSort: (key: string) => void;
  colFilters: Record<string, string[]>;
  setColFilter: (key: string, vals: string[]) => void;
  getUniqueValues: (key: string) => string[];
  activeFilterCount: number;
  clearAllFilters: () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useDataTable<T = any>(
  data: T[],
  cols: ColDef<T>[],
  opts?: { defaultSort?: string; defaultDir?: "asc" | "desc" }
): DataTableState {
  const [sortKey, setSortKey] = useState(opts?.defaultSort ?? "");
  const [sortDir, setSortDir] = useState<"asc" | "desc">(opts?.defaultDir ?? "asc");
  const [colFilters, setColFilters] = useState<Record<string, string[]>>({});

  const handleSort = useCallback((key: string) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return key;
      }
      setSortDir("asc");
      return key;
    });
  }, []);

  const getUniqueValues = useCallback(
    (key: string): string[] => {
      const col = cols.find((c) => c.key === key);
      if (!col?.filterLabel) return [];
      const vals = data.map((row) => col.filterLabel!(row) ?? "").filter(Boolean);
      return [...new Set(vals)].sort((a, b) => a.localeCompare(b));
    },
    [data, cols]
  );

  const setColFilter = useCallback((key: string, vals: string[]) => {
    setColFilters((prev) => ({ ...prev, [key]: vals }));
  }, []);

  const clearAllFilters = useCallback(() => setColFilters({}), []);

  const rows = useMemo(() => {
    let result = [...data];

    // Apply column filters
    for (const [key, selectedVals] of Object.entries(colFilters)) {
      if (!selectedVals || selectedVals.length === 0) continue;
      const col = cols.find((c) => c.key === key);
      if (!col?.filterLabel) continue;
      const valSet = new Set(selectedVals);
      result = result.filter((row) => valSet.has(col.filterLabel!(row) ?? ""));
    }

    // Apply sort
    if (sortKey) {
      const col = cols.find((c) => c.key === sortKey);
      if (col?.sortValue) {
        result = result.slice().sort((a, b) => {
          const av = col.sortValue!(a);
          const bv = col.sortValue!(b);
          if (av == null) return 1;
          if (bv == null) return -1;
          let cmp = 0;
          if (typeof av === "number" && typeof bv === "number") {
            cmp = av - bv;
          } else {
            cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
          }
          return sortDir === "asc" ? cmp : -cmp;
        });
      }
    }

    return result;
  }, [data, colFilters, sortKey, sortDir, cols]);

  const activeFilterCount = Object.values(colFilters).filter((v) => v?.length > 0).length;

  return {
    rows,
    sortKey,
    sortDir,
    handleSort,
    colFilters,
    setColFilter,
    getUniqueValues,
    activeFilterCount,
    clearAllFilters,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter dropdown (Excel-style popover)
// ─────────────────────────────────────────────────────────────────────────────

function FilterDropdown({
  colKey,
  allValues,
  selected,
  onChange,
  onClose,
}: {
  colKey: string;
  allValues: string[];
  selected: string[];
  onChange: (vals: string[]) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  // If nothing is in `selected` yet, treat ALL values as selected
  const initialSet = selected.length > 0 ? new Set(selected) : new Set(allValues);
  const [local, setLocal] = useState<Set<string>>(initialSet);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const visible = search
    ? allValues.filter((v) => v.toLowerCase().includes(search.toLowerCase()))
    : allValues;

  const allChecked = visible.length > 0 && visible.every((v) => local.has(v));
  const someChecked = visible.some((v) => local.has(v));

  const toggleAll = () => {
    const next = new Set(local);
    if (allChecked) visible.forEach((v) => next.delete(v));
    else visible.forEach((v) => next.add(v));
    setLocal(next);
  };

  const toggle = (v: string) => {
    const next = new Set(local);
    next.has(v) ? next.delete(v) : next.add(v);
    setLocal(next);
  };

  const apply = () => {
    // If everything is selected → clear filter (= show all)
    if (local.size === allValues.length) onChange([]);
    else onChange([...local]);
    onClose();
  };

  return (
    <div
      ref={ref}
      className="absolute z-[100] top-full left-0 mt-1 w-60 bg-white rounded-lg shadow-2xl ring-1 ring-stone-200 overflow-hidden"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Search within values */}
      <div className="p-2 border-b border-stone-100">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search values…"
            className="w-full h-7 pl-6 pr-2 text-xs rounded border border-stone-200 focus:outline-none focus:border-stone-400"
          />
        </div>
      </div>

      {/* Select All */}
      <div className="px-3 py-2 border-b border-stone-100">
        <label className="flex items-center gap-2 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={allChecked}
            ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked; }}
            onChange={toggleAll}
            className="rounded border-stone-300 text-stone-900 focus:ring-stone-500"
          />
          <span className="text-[12px] font-semibold text-stone-700">(Select All)</span>
          <span className="ml-auto text-[10px] text-stone-400">{visible.length}</span>
        </label>
      </div>

      {/* Value list */}
      <div className="max-h-52 overflow-y-auto py-1">
        {visible.length === 0 && (
          <div className="px-3 py-4 text-center text-xs text-stone-400">No values found</div>
        )}
        {visible.map((v) => (
          <label key={v} className="flex items-center gap-2 px-3 py-1 hover:bg-stone-50 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={local.has(v)}
              onChange={() => toggle(v)}
              className="rounded border-stone-300 text-stone-900 focus:ring-stone-500"
            />
            <span className="text-[12px] text-stone-700 truncate">{v || "(blank)"}</span>
          </label>
        ))}
      </div>

      {/* Actions */}
      <div className="p-2 border-t border-stone-100 flex gap-2">
        <button
          onClick={apply}
          className="flex-1 h-7 bg-stone-900 hover:bg-stone-700 text-white text-xs rounded font-medium transition-colors"
        >
          OK
        </button>
        <button
          onClick={onClose}
          className="flex-1 h-7 bg-stone-100 hover:bg-stone-200 text-stone-700 text-xs rounded transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ColHeader — drop-in sortable + filterable <th>
// ─────────────────────────────────────────────────────────────────────────────

export function ColHeader({
  col,
  dt,
  className = "",
}: {
  col: ColDef;
  dt: DataTableState;
  className?: string;
}) {
  const [showFilter, setShowFilter] = useState(false);
  const isActive = dt.sortKey === col.key;
  const hasFilter = (dt.colFilters[col.key]?.length ?? 0) > 0;
  const allValues = dt.getUniqueValues(col.key);

  const align = col.align ?? "left";
  const alignClass = align === "right" ? "justify-end" : align === "center" ? "justify-center" : "justify-start";

  return (
    <th className={`relative px-3 py-2.5 text-[11px] uppercase tracking-wider text-stone-500 font-semibold select-none ${className}`}>
      <div className={`flex items-center gap-1 ${alignClass}`}>
        {/* Sort button */}
        {!col.noSort ? (
          <button
            onClick={() => dt.handleSort(col.key)}
            className={`flex items-center gap-1 hover:text-stone-900 transition-colors ${isActive ? "text-stone-900" : ""}`}
          >
            <span>{col.label}</span>
            {isActive ? (
              dt.sortDir === "asc"
                ? <ChevronUp size={12} className="text-stone-700" />
                : <ChevronDown size={12} className="text-stone-700" />
            ) : (
              <ChevronsUpDown size={11} className="text-stone-300 group-hover:text-stone-500" />
            )}
          </button>
        ) : (
          <span>{col.label}</span>
        )}

        {/* Filter trigger */}
        {!col.noFilter && allValues.length > 0 && (
          <button
            onClick={(e) => { e.stopPropagation(); setShowFilter((v) => !v); }}
            className={`rounded p-0.5 transition-colors ${
              hasFilter
                ? "text-blue-600 bg-blue-50"
                : "text-stone-300 hover:text-stone-600 hover:bg-stone-100"
            }`}
            title={hasFilter ? "Filter active — click to change" : "Filter"}
          >
            <ListFilter size={11} />
          </button>
        )}
      </div>

      {/* Dropdown */}
      {showFilter && (
        <FilterDropdown
          colKey={col.key}
          allValues={allValues}
          selected={dt.colFilters[col.key] ?? []}
          onChange={(vals) => dt.setColFilter(col.key, vals)}
          onClose={() => setShowFilter(false)}
        />
      )}
    </th>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ActiveFiltersBar — shows which filters are active + clear button
// ─────────────────────────────────────────────────────────────────────────────

export function ActiveFiltersBar({
  dt,
  cols,
}: {
  dt: DataTableState;
  cols: ColDef[];
}) {
  if (dt.activeFilterCount === 0) return null;
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border-b border-blue-100 flex-wrap">
      <ListFilter size={12} className="text-blue-500 shrink-0" />
      <span className="text-[11px] text-blue-700 font-medium">Column filters active:</span>
      {Object.entries(dt.colFilters).map(([key, vals]) => {
        if (!vals?.length) return null;
        const col = cols.find((c) => c.key === key);
        return (
          <span key={key} className="inline-flex items-center gap-1 bg-white ring-1 ring-blue-200 rounded px-2 py-0.5 text-[11px] text-blue-800">
            <strong>{col?.label ?? key}</strong>: {vals.length === 1 ? vals[0] : `${vals.length} values`}
            <button
              onClick={() => dt.setColFilter(key, [])}
              className="ml-0.5 text-blue-400 hover:text-blue-700 font-bold"
            >×</button>
          </span>
        );
      })}
      <button onClick={dt.clearAllFilters} className="ml-auto text-[11px] text-blue-600 hover:text-blue-900 font-medium underline">
        Clear all
      </button>
    </div>
  );
}
