"use client";

/**
 * Dashboard charts and tables, shared by every graph on the employee dashboard
 * so they read as one system: horizontal bars on a real axis (round ticks,
 * gridlines), value labels, a hover tooltip, and a "Show table" that opens the
 * figures behind the chart as its own full-width card underneath.
 * No chart library: a bar is a width, and the axis comes from lib/resources/chart-scale.
 */
import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { niceScale } from "@/lib/resources/chart-scale";
import { fmt } from "@/lib/format";

// Chart colours are data colours, not theme colours: they must read the same on the dark and light themes.
export const C_LOGGED = "#3b82f6";
export const C_PLANNED = "#f97316";
export const PALETTE = ["#3b82f6", "#f97316", "#10b981", "#eab308", "#ec4899", "#8b5cf6", "#06b6d4", "#84cc16"];

export interface ChartSeries { key: string; label: string; color: string }
export interface ChartRow { id: string; label: string; values: Record<string, number> }

interface Tip { x: number; y: number; row: ChartRow }

export function ChartLegend({ series }: { series: ChartSeries[] }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-5 gap-y-1.5 mt-4">
      {series.map((s) => (
        <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-stone-400">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: s.color }} />{s.label}
        </span>
      ))}
    </div>
  );
}

/** Grouped (one bar per series, side by side) or stacked bars, one row per item. */
export function HBarChart({ rows, series, axisTitle = "Hours", labelWidth = 190, stacked = false, empty }: {
  rows: ChartRow[]; series: ChartSeries[]; axisTitle?: string; labelWidth?: number; stacked?: boolean; empty: string;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  if (rows.length === 0) return <p className="text-[13px] text-stone-400 py-6 text-center">{empty}</p>;

  const total = (r: ChartRow) => series.reduce((s, x) => s + (r.values[x.key] ?? 0), 0);
  const biggest = Math.max(0, ...rows.map((r) => (stacked ? total(r) : Math.max(...series.map((s) => r.values[s.key] ?? 0)))));
  const scale = niceScale(biggest);
  const pct = (v: number) => `${Math.min(100, (v / scale.max) * 100)}%`;
  const barH = stacked ? 22 : 14;
  const rowH = stacked ? 40 : series.length * barH + (series.length - 1) * 4 + 18;

  return (
    <div>
      <div className="grid" style={{ gridTemplateColumns: `${labelWidth}px minmax(0,1fr)` }}>
        <div>
          {rows.map((r) => (
            <div key={r.id} className="flex items-center justify-end pr-3 text-[12px] text-stone-300 text-right leading-tight" style={{ height: rowH }} title={r.label}>
              <span className="line-clamp-2">{r.label}</span>
            </div>
          ))}
        </div>
        <div className="relative">
          {/* gridlines */}
          {scale.ticks.map((t) => (
            <div key={t} className="absolute top-0 bottom-0 border-l border-stone-800" style={{ left: pct(t) }} />
          ))}
          {rows.map((r) => (
            <div key={r.id} className="relative flex flex-col justify-center gap-1 rounded-sm hover:bg-stone-800/40" style={{ height: rowH }}
              onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, row: r })} onMouseLeave={() => setTip(null)}>
              {stacked ? (
                <div className="flex items-center gap-2">
                  <div className="flex overflow-hidden rounded-r-md" style={{ width: pct(total(r)), height: barH }}>
                    {series.map((s) => (r.values[s.key] ?? 0) > 0 ? (
                      <div key={s.key} style={{ width: `${(r.values[s.key] / Math.max(total(r), 1e-9)) * 100}%`, background: s.color }} />
                    ) : null)}
                  </div>
                  <span className="text-[11px] tabular-nums text-stone-400">{fmt.num2(total(r))}</span>
                </div>
              ) : series.map((s) => {
                const v = r.values[s.key] ?? 0;
                return (
                  <div key={s.key} className="flex items-center gap-2" style={{ height: barH }}>
                    <div className="rounded-r-md" style={{ width: pct(v), height: "100%", background: s.color, minWidth: v > 0 ? 2 : 0 }} />
                    <span className="text-[11px] tabular-nums text-stone-400">{fmt.num2(v)}</span>
                  </div>
                );
              })}
            </div>
          ))}
          {/* axis */}
          <div className="relative h-6 border-t border-stone-700 mt-1">
            {scale.ticks.map((t) => (
              <span key={t} className="absolute top-1 text-[11px] tabular-nums text-stone-500 -translate-x-1/2" style={{ left: pct(t) }}>{t}</span>
            ))}
          </div>
          <div className="text-center text-[11px] text-stone-500">{axisTitle}</div>
        </div>
      </div>
      <ChartLegend series={series} />
      {tip && (
        <div className="fixed z-50 pointer-events-none rounded-md bg-stone-950 ring-1 ring-stone-700 px-3 py-2 shadow-lg" style={{ left: tip.x + 14, top: tip.y + 14 }}>
          <div className="text-[12px] font-semibold text-stone-100 mb-1 max-w-[260px]">{tip.row.label}</div>
          {series.map((s) => (
            <div key={s.key} className="flex items-center gap-2 text-[11px] text-stone-300">
              <span className="w-2 h-2 rounded-full" style={{ background: s.color }} />{s.label}: <span className="tabular-nums text-stone-100">{fmt.num2(tip.row.values[s.key] ?? 0)} h</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The button inside a chart card that opens or closes the table card below. */
export function TableToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} aria-expanded={open}
      className="mt-5 inline-flex items-center gap-1.5 h-8 px-3 rounded-md ring-1 ring-stone-600 text-[12px] font-medium text-stone-300 hover:text-stone-100 hover:ring-stone-400 transition">
      {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}{open ? "Hide table" : "Show table"}
    </button>
  );
}

/** A chart card: soft surface, a clear title, optional right-hand summary. */
export function ChartCard({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg ring-1 ring-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/70 shadow-sm">
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-stone-800">
        <h3 className="text-[13px] font-semibold text-stone-100">{title}</h3>
        <div className="ml-auto text-[12px] text-stone-400 tabular-nums">{right}</div>
      </header>
      <div className="px-5 pt-5 pb-4">{children}</div>
    </section>
  );
}

/** The table card that opens under a chart. */
export function TableCard({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg ring-1 ring-stone-800 bg-stone-900 overflow-x-auto">
      <table className="w-full text-[13px] border-collapse">{children}</table>
    </div>
  );
}

export const TH = "px-4 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wider text-stone-400 border-b border-stone-800 whitespace-nowrap";
export const THR = `${TH} !text-right`;
export const TD = "px-4 py-2.5 text-stone-200 border-b border-stone-800/60";
export const TDR = `${TD} text-right tabular-nums`;
/** A figure worth a look: hours worked on something that was never planned. */
export const TD_FLAG = "bg-rose-500/15 !text-rose-300 font-semibold";
export const TD_TOTAL = "font-semibold text-white bg-stone-800/40";

export function CodeCell({ code, color }: { code: string | null; color?: string }) {
  return (
    <td className={`${TD} whitespace-nowrap`}>
      {color && <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle" style={{ background: color }} />}
      <span className="font-medium">{code ?? "—"}</span>
    </td>
  );
}
