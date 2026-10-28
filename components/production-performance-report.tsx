"use client";

/**
 * Production Performance — planned vs actual for Manufacturing Orders and job
 * work, with delay, downtime and scrap reasons (0115). Every figure comes from
 * /api/production/performance, which applies lib/inventory/production-performance.ts.
 * Downtime is also RECORDED here (Log downtime), since it belongs to a work
 * centre as much as to any one order.
 */

import { useEffect, useState } from "react";
import { Gauge, Plus } from "lucide-react";
import { ReportShell } from "@/components/ui";
import { SelectField, control, controlInset, Drawer, DrawerFooter, Field } from "@/components/form-kit";
import { formatDate, localToday, fmt } from "@/lib/format";
import { listTable, listRow } from "@/components/list-view";
import { DOWNTIME_REASONS } from "@/lib/inventory/production-performance";

type Timing = { orders: number; scored: number; onTimePct: number | null; onTimeVsOriginalPct: number | null; avgDaysLate: number | null; overdue: number; rescheduled: number; avgStartSlip: number | null };
type Pareto = { code: string; label: string; count: number; value: number }[];
type Data = {
  production: {
    timing: Timing; yieldPct: number | null; goodQty: number; rejectedQty: number; scrapCost: number;
    hours: { workCentre: string; actual: number; planned: number; efficiencyPct: number | null }[];
    delayReasons: Pareto; scrapReasons: Pareto;
    orders: { id: string; moNo: string | null; item: string; status: string; timing: string; plannedStart: string | null; actualStart: string | null; due: string | null; originalDue: string | null; finish: string | null; daysLate: number | null; reschedules: number; delayReason: string | null; delayNote: string | null }[];
  };
  downtime: { totalMinutes: number; unplannedMinutes: number; stops: number; open: number; reasons: Pareto; byWorkCentre: { workCentre: string; minutes: number; unplanned: number; stops: number }[] };
  jobWork: {
    timing: Timing; delayReasons: Pareto; wastageReasons: Pareto;
    vendors: (Timing & { vendor: string; yieldPct: number | null; wastageValue: number })[];
    orders: { id: string; docNumber: string | null; vendor: string; status: string; timing: string; dispatched: string; due: string | null; originalDue: string | null; finish: string | null; daysLate: number | null; revisions: number; delayReason: string | null; delayNote: string | null }[];
  };
};

const pct = (n: number | null) => (n == null ? "—" : `${n}%`);
const band = (n: number | null) => (n == null ? "text-stone-500" : n >= 95 ? "text-emerald-400" : n >= 80 ? "text-amber-400" : "text-rose-400");
const hrs = (m: number) => (m < 60 ? `${m} min` : `${Math.round((m / 60) * 10) / 10} h`);
const d = (v: string | null) => (v ? formatDate(v) : "—");
const th = "text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-800";
const TIMING_CHIP: Record<string, string> = {
  OnTime: "bg-emerald-500/12 text-emerald-400 border-emerald-800/50",
  Late: "bg-amber-500/12 text-amber-400 border-amber-800/50",
  Overdue: "bg-rose-500/12 text-rose-400 border-rose-800/50",
  Open: "bg-stone-800 text-stone-300 border-stone-700",
  NoDueDate: "bg-stone-800 text-stone-500 border-stone-700",
};
const TIMING_LABEL: Record<string, string> = { OnTime: "On time", Late: "Late", Overdue: "Overdue", Open: "Open", NoDueDate: "No due date" };

function Tiles({ tiles }: { tiles: [string, string, string][] }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-5">
      {tiles.map(([label, value, cls]) => (
        <div key={label} className="rounded-lg bg-stone-900 border border-stone-800 px-3 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-stone-500">{label}</div>
          <div className={`text-[18px] font-semibold tabular-nums ${cls}`}>{value}</div>
        </div>
      ))}
    </div>
  );
}

/** A reason list with a bar per reason, widest = largest. */
function ParetoCard({ title, rows, unit }: { title: string; rows: Pareto; unit: (v: number) => string }) {
  const max = Math.max(1, ...rows.map(r => r.value));
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900/40 p-3">
      <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">{title}</div>
      {rows.length === 0 && <div className="text-[12px] text-stone-600 py-2">Nothing recorded in this period.</div>}
      {rows.map(r => (
        <div key={r.code} className="mb-1.5">
          <div className="flex justify-between text-[12px]">
            <span className={r.code === "unrecorded" ? "text-amber-400" : "text-stone-300"}>{r.label}</span>
            <span className="tabular-nums text-stone-400">{unit(r.value)} · {r.count}</span>
          </div>
          <div className="h-1.5 rounded-full bg-stone-800 mt-0.5">
            <div className={`h-1.5 rounded-full ${r.code === "unrecorded" ? "bg-amber-500/60" : "bg-teal-500/70"}`} style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TimingChip({ s }: { s: string }) {
  return <span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${TIMING_CHIP[s] ?? TIMING_CHIP.Open}`}>{TIMING_LABEL[s] ?? s}</span>;
}

function LogDowntimeDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [wcs, setWcs] = useState<{ id: string; name: string; code: string | null }[]>([]);
  const [mos, setMos] = useState<{ id: string; moNo: string | null; status: string }[]>([]);
  const now = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  const [f, setF] = useState({ workCentreId: "", moId: "", reason: "breakdown", startedAt: now, endedAt: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/production/work-centres").then(r => r.json()).then(x => setWcs(Array.isArray(x) ? x : [])).catch(() => setWcs([]));
    fetch("/api/production/mos").then(r => r.json())
      .then(x => setMos((Array.isArray(x) ? x : []).filter((m: { status: string }) => ["Released", "InProgress"].includes(m.status))))
      .catch(() => setMos([]));
  }, []);
  async function save() {
    setSaving(true); setErr(null);
    const body = {
      workCentreId: f.workCentreId || null, moId: f.moId || null, reason: f.reason, notes: f.notes || null,
      startedAt: f.startedAt ? new Date(f.startedAt).toISOString() : undefined,
      endedAt: f.endedAt ? new Date(f.endedAt).toISOString() : null,
    };
    const r = await fetch("/api/production/downtime", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    setSaving(false);
    if (!r.ok) { setErr(j?.error || "Could not record downtime"); return; }
    onSaved();
  }
  return (
    <Drawer title="Log downtime" subtitle="A work centre or order that was not producing." onClose={onClose}
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Record" err={err} />}>
      <div className="space-y-3">
        <Field label="Work centre">
          <SelectField inset value={f.workCentreId} onChange={e => setF({ ...f, workCentreId: e.target.value })}>
            <option value="">—</option>
            {wcs.map(w => <option key={w.id} value={w.id}>{w.code ? `${w.code} · ${w.name}` : w.name}</option>)}
          </SelectField>
        </Field>
        <Field label="Manufacturing order" hint="Optional. Released or in-progress orders only.">
          <SelectField inset value={f.moId} onChange={e => setF({ ...f, moId: e.target.value })}>
            <option value="">—</option>
            {mos.map(m => <option key={m.id} value={m.id}>{m.moNo ?? m.id.slice(0, 8)}</option>)}
          </SelectField>
        </Field>
        <Field label="Reason" required>
          <SelectField inset value={f.reason} onChange={e => setF({ ...f, reason: e.target.value })}>
            {DOWNTIME_REASONS.map(r => <option key={r.code} value={r.code}>{r.label}{r.planned ? " (planned)" : ""}</option>)}
          </SelectField>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Stopped at" required>
            <input type="datetime-local" value={f.startedAt} onChange={e => setF({ ...f, startedAt: e.target.value })} className={controlInset} />
          </Field>
          <Field label="Restarted at" hint="Leave blank if still down.">
            <input type="datetime-local" value={f.endedAt} onChange={e => setF({ ...f, endedAt: e.target.value })} className={controlInset} />
          </Field>
        </div>
        <Field label="Notes">
          <textarea rows={3} value={f.notes} onChange={e => setF({ ...f, notes: e.target.value })} className={controlInset} />
        </Field>
      </div>
    </Drawer>
  );
}

export function ProductionPerformanceReport() {
  const today = localToday();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [tab, setTab] = useState<"production" | "downtime" | "jobwork">("production");
  const [data, setData] = useState<Data | null>(null);
  const [logging, setLogging] = useState(false);

  async function load() {
    setData(null);
    const q = new URLSearchParams({ from, to, asOf: today });
    const x = await fetch(`/api/production/performance?${q}`).then(r => r.json()).catch(() => null);
    setData(x && x.production ? x : null);
  }
  useEffect(() => { load(); }, [from, to]);

  const p = data?.production, dt = data?.downtime, jw = data?.jobWork;
  const TABS: [typeof tab, string][] = [["production", "Manufacturing orders"], ["downtime", "Downtime"], ["jobwork", "Job work"]];

  return (
    <ReportShell title="Production Performance" sub="Planned vs actual for manufacturing orders and job work, with the reasons behind every delay, stoppage and reject."
      icon={Gauge} onRefresh={load} loading={data === null}>
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div className="flex rounded-md ring-1 ring-stone-700 overflow-hidden">
          {TABS.map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`h-8 px-3 text-[12px] ${tab === k ? "bg-stone-700 text-stone-100" : "bg-stone-800 text-stone-400 hover:text-stone-200"}`}>{label}</button>
          ))}
        </div>
        <label className="text-[11px] text-stone-500">Due from
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${control} h-8 text-[12px] mt-0.5`} />
        </label>
        <label className="text-[11px] text-stone-500">to
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={`${control} h-8 text-[12px] mt-0.5`} />
        </label>
        {tab === "downtime" && (
          <button onClick={() => setLogging(true)} className="ml-auto h-8 px-3 rounded-md bg-teal-600 hover:bg-teal-500 text-white text-[12px] inline-flex items-center gap-1.5">
            <Plus size={14} /> Log downtime
          </button>
        )}
      </div>

      {data === null && <div className="text-[13px] text-stone-500 py-8 text-center">Loading…</div>}

      {p && tab === "production" && (
        <>
          <Tiles tiles={[
            ["On time", pct(p.timing.onTimePct), band(p.timing.onTimePct)],
            ["vs first due date", pct(p.timing.onTimeVsOriginalPct), band(p.timing.onTimeVsOriginalPct)],
            ["Overdue orders", String(p.timing.overdue), p.timing.overdue ? "text-rose-400" : "text-stone-200"],
            ["Avg days late", p.timing.avgDaysLate == null ? "—" : String(p.timing.avgDaysLate), "text-stone-200"],
            ["Yield", pct(p.yieldPct), band(p.yieldPct)],
            ["Scrap cost", fmt.money(p.scrapCost), p.scrapCost ? "text-rose-400" : "text-stone-200"],
          ]} />
          <div className="grid md:grid-cols-3 gap-3 mb-5">
            <ParetoCard title="Why orders were late" rows={p.delayReasons} unit={v => `${v}`} />
            <ParetoCard title="Why output was rejected (qty)" rows={p.scrapReasons} unit={v => fmt.qty(v)} />
            <div className="rounded-lg border border-stone-800 bg-stone-900/40 p-3">
              <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">Hours: planned vs actual</div>
              {p.hours.length === 0 && <div className="text-[12px] text-stone-600 py-2">No completion runs with operations in this period.</div>}
              {p.hours.map(h => (
                <div key={h.workCentre} className="flex justify-between text-[12px] mb-1">
                  <span className="text-stone-300">{h.workCentre}</span>
                  <span className="tabular-nums text-stone-400">{h.planned} / {h.actual} h · <span className={band(h.efficiencyPct)}>{pct(h.efficiencyPct)}</span></span>
                </div>
              ))}
            </div>
          </div>
          <div className="rounded-lg border border-stone-800 overflow-x-auto">
            <table className={listTable}>
              <thead><tr className={th}>
                <th className="text-left px-3 py-2">Order</th><th className="text-left px-2 py-2">Item</th>
                <th className="text-left px-2 py-2">Planned start</th><th className="text-left px-2 py-2">Actual start</th>
                <th className="text-left px-2 py-2">Due</th><th className="text-left px-2 py-2">Finished</th>
                <th className="text-right px-2 py-2">Days late</th><th className="text-left px-2 py-2">Reason</th><th className="text-left px-3 py-2">State</th>
              </tr></thead>
              <tbody>
                {p.orders.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-[13px] text-stone-500">No finished, overdue or rescheduled orders in this period.</td></tr>}
                {p.orders.map(o => (
                  <tr key={o.id} className={listRow(false)}>
                    <td className="px-3 py-2 font-mono text-[12px] text-stone-300">{o.moNo ?? "—"}</td>
                    <td className="px-2 py-2 text-stone-200">{o.item}</td>
                    <td className="px-2 py-2 text-stone-400">{d(o.plannedStart)}</td>
                    <td className="px-2 py-2 text-stone-400">{d(o.actualStart)}</td>
                    <td className="px-2 py-2 text-stone-400">{d(o.due)}
                      {o.reschedules > 0 && <div className="text-[10px] text-amber-400">moved {o.reschedules}× · first {d(o.originalDue)}</div>}
                    </td>
                    <td className="px-2 py-2 text-stone-400">{d(o.finish)}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${(o.daysLate ?? 0) > 0 ? "text-rose-400" : "text-stone-500"}`}>{o.daysLate ?? "—"}</td>
                    <td className="px-2 py-2 text-stone-400" title={o.delayNote ?? undefined}>{o.delayReason ?? ((o.daysLate ?? 0) > 0 ? <span className="text-amber-400">Not recorded</span> : "—")}</td>
                    <td className="px-3 py-2"><TimingChip s={o.timing} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {dt && tab === "downtime" && (
        <>
          <Tiles tiles={[
            ["Total downtime", hrs(dt.totalMinutes), "text-stone-200"],
            ["Unplanned", hrs(dt.unplannedMinutes), dt.unplannedMinutes ? "text-rose-400" : "text-stone-200"],
            ["Stoppages", String(dt.stops), "text-stone-200"],
            ["Still down", String(dt.open), dt.open ? "text-rose-400" : "text-stone-200"],
          ]} />
          <div className="grid md:grid-cols-2 gap-3">
            <ParetoCard title="Downtime by reason" rows={dt.reasons} unit={hrs} />
            <div className="rounded-lg border border-stone-800 bg-stone-900/40 p-3">
              <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2">By work centre</div>
              {dt.byWorkCentre.length === 0 && <div className="text-[12px] text-stone-600 py-2">No stoppages recorded in this period.</div>}
              {dt.byWorkCentre.map(w => (
                <div key={w.workCentre} className="flex justify-between text-[12px] mb-1">
                  <span className="text-stone-300">{w.workCentre}</span>
                  <span className="tabular-nums text-stone-400">{hrs(w.minutes)} · unplanned {hrs(w.unplanned)} · {w.stops} stops</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {jw && tab === "jobwork" && (
        <>
          <Tiles tiles={[
            ["Returned on time", pct(jw.timing.onTimePct), band(jw.timing.onTimePct)],
            ["vs first date", pct(jw.timing.onTimeVsOriginalPct), band(jw.timing.onTimeVsOriginalPct)],
            ["Overdue", String(jw.timing.overdue), jw.timing.overdue ? "text-rose-400" : "text-stone-200"],
            ["Avg days late", jw.timing.avgDaysLate == null ? "—" : String(jw.timing.avgDaysLate), "text-stone-200"],
            ["Re-dated", String(jw.timing.rescheduled), jw.timing.rescheduled ? "text-amber-400" : "text-stone-200"],
          ]} />
          <div className="grid md:grid-cols-2 gap-3 mb-5">
            <ParetoCard title="Why returns were late" rows={jw.delayReasons} unit={v => `${v}`} />
            <ParetoCard title="Why material was lost (value)" rows={jw.wastageReasons} unit={v => fmt.money(v)} />
          </div>
          <div className="rounded-lg border border-stone-800 overflow-x-auto mb-5">
            <table className={listTable}>
              <thead><tr className={th}>
                <th className="text-left px-3 py-2">Job worker</th><th className="text-right px-2 py-2">Orders</th>
                <th className="text-right px-2 py-2">On time</th><th className="text-right px-2 py-2">vs first date</th>
                <th className="text-right px-2 py-2">Avg days late</th><th className="text-right px-2 py-2">Overdue</th>
                <th className="text-right px-2 py-2">Yield</th><th className="text-right px-3 py-2">Wastage</th>
              </tr></thead>
              <tbody>
                {jw.vendors.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-[13px] text-stone-500">No job work in this period.</td></tr>}
                {jw.vendors.map(v => (
                  <tr key={v.vendor} className={listRow(false)}>
                    <td className="px-3 py-2 text-stone-200">{v.vendor}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-stone-400">{v.orders}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${band(v.onTimePct)}`}>{pct(v.onTimePct)}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${band(v.onTimeVsOriginalPct)}`}>{pct(v.onTimeVsOriginalPct)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-stone-400">{v.avgDaysLate ?? "—"}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${v.overdue ? "text-rose-400" : "text-stone-500"}`}>{v.overdue}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${band(v.yieldPct)}`}>{pct(v.yieldPct)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-300">{fmt.money(v.wastageValue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="rounded-lg border border-stone-800 overflow-x-auto">
            <table className={listTable}>
              <thead><tr className={th}>
                <th className="text-left px-3 py-2">Order</th><th className="text-left px-2 py-2">Job worker</th>
                <th className="text-left px-2 py-2">Dispatched</th><th className="text-left px-2 py-2">Expected back</th>
                <th className="text-left px-2 py-2">Closed</th><th className="text-right px-2 py-2">Days late</th>
                <th className="text-left px-2 py-2">Reason</th><th className="text-left px-3 py-2">State</th>
              </tr></thead>
              <tbody>
                {jw.orders.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-[13px] text-stone-500">No closed, overdue or re-dated orders in this period.</td></tr>}
                {jw.orders.map(o => (
                  <tr key={o.id} className={listRow(false)}>
                    <td className="px-3 py-2 font-mono text-[12px] text-stone-300">{o.docNumber ?? "—"}</td>
                    <td className="px-2 py-2 text-stone-200">{o.vendor}</td>
                    <td className="px-2 py-2 text-stone-400">{d(o.dispatched)}</td>
                    <td className="px-2 py-2 text-stone-400">{d(o.due)}
                      {o.revisions > 0 && <div className="text-[10px] text-amber-400">moved {o.revisions}× · first {d(o.originalDue)}</div>}
                    </td>
                    <td className="px-2 py-2 text-stone-400">{d(o.finish)}</td>
                    <td className={`px-2 py-2 text-right tabular-nums ${(o.daysLate ?? 0) > 0 ? "text-rose-400" : "text-stone-500"}`}>{o.daysLate ?? "—"}</td>
                    <td className="px-2 py-2 text-stone-400" title={o.delayNote ?? undefined}>{o.delayReason ?? ((o.daysLate ?? 0) > 0 ? <span className="text-amber-400">Not recorded</span> : "—")}</td>
                    <td className="px-3 py-2"><TimingChip s={o.timing} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {logging && <LogDowntimeDrawer onClose={() => setLogging(false)} onSaved={() => { setLogging(false); load(); }} />}
    </ReportShell>
  );
}
