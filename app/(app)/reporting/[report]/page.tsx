"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Download, ChevronRight } from "lucide-react";

// ── Report metadata ───────────────────────────────────────────────────────────

const REPORT_META: Record<string, { title: string; needsRange: boolean; needsAsOf: boolean }> = {
  "profit-loss":        { title: "Profit & Loss",     needsRange: true,  needsAsOf: false },
  "balance-sheet":      { title: "Balance Sheet",      needsRange: false, needsAsOf: true  },
  "cash-flow":          { title: "Cash Flow",          needsRange: true,  needsAsOf: false },
  "trial-balance":      { title: "Trial Balance",      needsRange: false, needsAsOf: true  },
  "ar-aging":           { title: "AR Ageing",          needsRange: false, needsAsOf: true  },
  "ap-aging":           { title: "AP Ageing",          needsRange: false, needsAsOf: true  },
  "executive-summary":  { title: "Executive Summary",  needsRange: false, needsAsOf: true  },
  "bank-summary":       { title: "Bank Summary",       needsRange: false, needsAsOf: true  },
};

// ── Date helpers ─────────────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().slice(0, 10); }
function monthStart(d: string) { return d.slice(0, 7) + "-01"; }

// ── QBO report renderer ───────────────────────────────────────────────────────

function parseMoney(v: any) {
  if (v == null || v === "") return null;
  const n = parseFloat(String(v).replace(/[,$£€\s]/g, ""));
  return isNaN(n) ? null : n;
}

function fmtNum(v: number | null) {
  if (v === null) return "";
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

type QboColData = { value: string; id?: string; href?: string }[];

function QboRow({ colData, colCount, depth = 0, isSection = false, isSummary = false }: {
  colData: QboColData; colCount: number; depth?: number; isSection?: boolean; isSummary?: boolean;
}) {
  const label    = colData[0]?.value ?? "";
  const rest     = colData.slice(1);
  const indent   = depth * 16;

  const rowClass = isSection
    ? "bg-stone-900/60 font-semibold text-stone-200"
    : isSummary
    ? "bg-stone-900/30 font-medium text-stone-300 border-t border-stone-800"
    : "text-stone-400 hover:bg-stone-900/20 transition-colors";

  return (
    <tr className={rowClass}>
      <td className="py-1.5 px-3 text-[12px]" style={{ paddingLeft: `${12 + indent}px` }}>
        {label}
      </td>
      {rest.map((c, i) => {
        const n = parseMoney(c.value);
        return (
          <td key={i} className="py-1.5 px-3 text-[12px] text-right tabular-nums">
            {n !== null ? fmtNum(n) : c.value}
          </td>
        );
      })}
      {/* pad missing columns */}
      {Array.from({ length: Math.max(0, colCount - rest.length - 1) }).map((_, i) => (
        <td key={`pad-${i}`} />
      ))}
    </tr>
  );
}

function QboRows({ rows, colCount, depth = 0 }: { rows: any[]; colCount: number; depth?: number }) {
  return (
    <>
      {rows.map((row: any, i: number) => {
        if (row.type === "Section") {
          return (
            <QboSection key={i} section={row} colCount={colCount} depth={depth} />
          );
        }
        if (row.ColData) {
          return <QboRow key={i} colData={row.ColData} colCount={colCount} depth={depth} />;
        }
        return null;
      })}
    </>
  );
}

function QboSection({ section, colCount, depth = 0 }: { section: any; colCount: number; depth?: number }) {
  const [open, setOpen] = useState(true);
  const hasHeader  = !!section.Header?.ColData;
  const hasRows    = section.Rows?.Row?.length > 0;
  const hasSummary = !!section.Summary?.ColData;
  const collapsible = hasRows;

  return (
    <>
      {hasHeader && (
        <tr
          className={`${collapsible ? "cursor-pointer" : ""} bg-stone-900/60`}
          onClick={() => collapsible && setOpen(o => !o)}
        >
          <td className="py-1.5 px-3 text-[12px] font-semibold text-stone-200" style={{ paddingLeft: `${12 + depth * 16}px` }}>
            <span className="flex items-center gap-1">
              {collapsible && (
                <ChevronRight size={11} className={`text-stone-500 transition-transform ${open ? "rotate-90" : ""}`} />
              )}
              {section.Header.ColData[0]?.value}
            </span>
          </td>
          {section.Header.ColData.slice(1).map((c: any, i: number) => {
            const n = parseMoney(c.value);
            return (
              <td key={i} className="py-1.5 px-3 text-[12px] text-right tabular-nums font-semibold text-stone-200">
                {n !== null ? fmtNum(n) : c.value}
              </td>
            );
          })}
        </tr>
      )}
      {open && hasRows && (
        <QboRows rows={section.Rows.Row} colCount={colCount} depth={depth + 1} />
      )}
      {open && hasSummary && (
        <QboRow colData={section.Summary.ColData} colCount={colCount} depth={depth} isSummary />
      )}
    </>
  );
}

function QboReport({ report }: { report: any }) {
  const columns: any[] = report?.Columns?.Column ?? [];
  const colCount = columns.length;
  const topRows: any[] = report?.Rows?.Row ?? [];

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-stone-700">
            {columns.map((col: any, i: number) => (
              <th key={i} className={`py-2 px-3 text-[11px] font-semibold text-stone-400 uppercase tracking-wide ${i > 0 ? "text-right" : ""}`}>
                {col.ColTitle}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <QboRows rows={topRows} colCount={colCount} />
        </tbody>
      </table>
    </div>
  );
}

// ── Xero report renderer ──────────────────────────────────────────────────────

function XeroReport({ report }: { report: any }) {
  const rows: any[] = report?.Rows ?? [];

  // Pull header row for column titles
  const headerRow = rows.find((r: any) => r.RowType === "Header");
  const headers: string[] = headerRow?.Cells?.map((c: any) => c.Value ?? "") ?? [];

  const bodyRows = rows.filter((r: any) => r.RowType !== "Header");

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="border-b border-stone-700">
            {headers.map((h, i) => (
              <th key={i} className={`py-2 px-3 text-[11px] font-semibold text-stone-400 uppercase tracking-wide ${i > 0 ? "text-right" : ""}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <XeroRows rows={bodyRows} depth={0} colCount={headers.length} />
        </tbody>
      </table>
    </div>
  );
}

function XeroRows({ rows, depth, colCount }: { rows: any[]; depth: number; colCount: number }) {
  return (
    <>
      {rows.map((row: any, i: number) => (
        <XeroRowItem key={i} row={row} depth={depth} colCount={colCount} />
      ))}
    </>
  );
}

function XeroRowItem({ row, depth, colCount }: { row: any; depth: number; colCount: number }) {
  const [open, setOpen] = useState(true);

  if (row.RowType === "Section") {
    const hasTitle    = !!row.Title;
    const childRows   = row.Rows ?? [];
    return (
      <>
        {hasTitle && (
          <tr
            className="bg-stone-900/60 cursor-pointer"
            onClick={() => setOpen(o => !o)}
          >
            <td className="py-1.5 px-3 text-[12px] font-semibold text-stone-200" style={{ paddingLeft: `${12 + depth * 16}px` }}>
              <span className="flex items-center gap-1">
                <ChevronRight size={11} className={`text-stone-500 transition-transform ${open ? "rotate-90" : ""}`} />
                {row.Title}
              </span>
            </td>
            {Array.from({ length: colCount - 1 }).map((_, j) => <td key={j} />)}
          </tr>
        )}
        {open && <XeroRows rows={childRows} depth={depth + (hasTitle ? 1 : 0)} colCount={colCount} />}
      </>
    );
  }

  const cells: any[] = row.Cells ?? [];
  const isSummary = row.RowType === "SummaryRow";

  return (
    <tr className={isSummary
      ? "bg-stone-900/30 font-medium text-stone-300 border-t border-stone-800"
      : "text-stone-400 hover:bg-stone-900/20 transition-colors"}>
      {cells.map((c: any, i: number) => {
        const val = c.Value ?? "";
        const n   = i > 0 ? parseMoney(val) : null;
        return (
          <td key={i}
            className={`py-1.5 px-3 text-[12px] ${i > 0 ? "text-right tabular-nums" : ""}`}
            style={i === 0 ? { paddingLeft: `${12 + depth * 16}px` } : undefined}
          >
            {n !== null ? fmtNum(n) : val}
          </td>
        );
      })}
    </tr>
  );
}

// ── Export to CSV ─────────────────────────────────────────────────────────────

function flattenQboRows(rows: any[]): string[][] {
  const out: string[][] = [];
  for (const row of rows) {
    if (row.type === "Section") {
      if (row.Header?.ColData) out.push(row.Header.ColData.map((c: any) => c.value ?? ""));
      if (row.Rows?.Row) out.push(...flattenQboRows(row.Rows.Row));
      if (row.Summary?.ColData) out.push(row.Summary.ColData.map((c: any) => c.value ?? ""));
    } else if (row.ColData) {
      out.push(row.ColData.map((c: any) => c.value ?? ""));
    }
  }
  return out;
}

function flattenXeroRows(rows: any[]): string[][] {
  const out: string[][] = [];
  for (const row of rows) {
    if (row.RowType === "Section") {
      if (row.Title) out.push([row.Title]);
      if (row.Rows) out.push(...flattenXeroRows(row.Rows));
    } else {
      out.push((row.Cells ?? []).map((c: any) => c.Value ?? ""));
    }
  }
  return out;
}

function downloadCsv(provider: string, report: any, reportName: string) {
  let rows: string[][] = [];
  if (provider === "qbo") {
    const cols = (report?.Columns?.Column ?? []).map((c: any) => c.ColTitle ?? "");
    rows = [cols, ...flattenQboRows(report?.Rows?.Row ?? [])];
  } else {
    rows = flattenXeroRows(report?.Rows ?? []);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const a    = document.createElement("a");
  a.href     = URL.createObjectURL(blob);
  a.download = `${reportName.replace(/\s+/g, "-").toLowerCase()}.csv`;
  a.click();
}

// ── Period presets ────────────────────────────────────────────────────────────

type Preset = { label: string; from: string; to: string };

function buildPresets(): Preset[] {
  const now = new Date();
  const y   = now.getFullYear();
  const m   = String(now.getMonth() + 1).padStart(2, "0");
  const today = todayStr();

  const fmtTo = (y: number, m: number) => {
    const last = new Date(y, m, 0);
    return `${y}-${String(m).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`;
  };

  const prevM = now.getMonth() === 0 ? 12 : now.getMonth();
  const prevY = now.getMonth() === 0 ? y - 1 : y;

  return [
    { label: "This month",    from: `${y}-${m}-01`,               to: today },
    { label: "Last month",    from: `${prevY}-${String(prevM).padStart(2,"0")}-01`, to: fmtTo(prevY, prevM) },
    { label: "This quarter",  from: `${y}-${String(Math.floor(now.getMonth() / 3) * 3 + 1).padStart(2,"0")}-01`, to: today },
    { label: "YTD",           from: `${y}-01-01`,                  to: today },
    { label: "Last 12 months",from: `${y-1}-${m}-01`,             to: today },
    { label: "Last year",     from: `${y-1}-01-01`,               to: `${y-1}-12-31` },
  ];
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function ReportPage() {
  const { report: reportType } = useParams<{ report: string }>();
  const meta = REPORT_META[reportType] ?? { title: reportType, needsRange: true, needsAsOf: false };

  const today = todayStr();
  const [from,  setFrom]  = useState(monthStart(today));
  const [to,    setTo]    = useState(today);
  const [asOf,  setAsOf]  = useState(today);
  const [data,  setData]  = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);

  const presets = buildPresets();

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ asOf, from, to });
      const res = await fetch(`/api/reporting/${reportType}?${params}`);
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to load report"); return; }
      setData(json);
    } catch (e: any) {
      setError(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }, [reportType, from, to, asOf]);

  // Auto-run on mount
  useEffect(() => { run(); }, [run]);

  const applyPreset = (p: Preset) => {
    setFrom(p.from);
    setTo(p.to);
    setAsOf(p.to);
  };

  return (
    <div className="p-6 max-w-full mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link href="/reporting" className="p-1.5 rounded-md hover:bg-stone-800 text-stone-500 hover:text-stone-300 transition-colors">
            <ArrowLeft size={15} />
          </Link>
          <div>
            <h1 className="text-base font-semibold text-white">{meta.title}</h1>
            {data && (
              <p className="text-[11px] text-stone-500 mt-0.5">
                {data.provider === "qbo" ? "QuickBooks Online" : "Xero"}
                {data.generatedAt && ` · ${new Date(data.generatedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {data && (
            <button
              onClick={() => downloadCsv(data.provider, data.report, data.reportName)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs text-stone-300 bg-stone-800 hover:bg-stone-700 transition-colors"
            >
              <Download size={12} /> Export CSV
            </button>
          )}
          <button
            onClick={run}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-60"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            {loading ? "Loading…" : "Run Report"}
          </button>
        </div>
      </div>

      {/* Period controls */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        {meta.needsRange && (
          <>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-stone-500">From</label>
              <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="h-7 px-2 text-xs bg-stone-900 border border-stone-700 rounded text-stone-200 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[11px] text-stone-500">To</label>
              <input type="date" value={to} onChange={e => setTo(e.target.value)}
                className="h-7 px-2 text-xs bg-stone-900 border border-stone-700 rounded text-stone-200 focus:outline-none focus:ring-1 focus:ring-blue-500" />
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {presets.map(p => (
                <button
                  key={p.label}
                  onClick={() => applyPreset(p)}
                  className={`px-2 py-0.5 text-[11px] rounded border transition-colors ${
                    from === p.from && to === p.to
                      ? "border-blue-500 bg-blue-500/10 text-blue-400"
                      : "border-stone-700 text-stone-500 hover:border-stone-500 hover:text-stone-300"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </>
        )}
        {meta.needsAsOf && (
          <div className="flex items-center gap-1.5">
            <label className="text-[11px] text-stone-500">As of</label>
            <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)}
              className="h-7 px-2 text-xs bg-stone-900 border border-stone-700 rounded text-stone-200 focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
        )}
      </div>

      {/* Report content */}
      <div className="bg-stone-900/50 rounded-xl ring-1 ring-stone-800 overflow-hidden">
        {loading && (
          <div className="flex items-center justify-center py-20 text-stone-500 text-sm gap-2">
            <RefreshCw size={14} className="animate-spin" /> Loading report…
          </div>
        )}

        {!loading && error && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-sm text-rose-400">{error}</p>
            {error.includes("not enabled") && (
              <Link href="/settings/reporting" className="text-xs text-blue-400 hover:underline">
                Enable Reporting in Settings →
              </Link>
            )}
            {error.includes("not connected") && (
              <Link href="/settings/integrations" className="text-xs text-blue-400 hover:underline">
                Connect QuickBooks or Xero →
              </Link>
            )}
          </div>
        )}

        {!loading && !error && data && (
          data.provider === "qbo"
            ? <QboReport report={data.report} />
            : <XeroReport report={data.report} />
        )}

        {!loading && !error && !data && (
          <div className="flex items-center justify-center py-20 text-stone-600 text-sm">
            Select a period and click Run Report
          </div>
        )}
      </div>
    </div>
  );
}
