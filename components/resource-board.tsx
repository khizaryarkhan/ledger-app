"use client";

/**
 * Resource Board — the Resource Management module's daily working screen.
 * A from-scratch date-axis grid (no prior calendar/gantt component existed
 * to adapt): resource rows, day columns for the selected week, an
 * allocation pill per overlapping assignment, and an "Over-allocated" flag
 * computed by the API from summed allocationPercent — this is Phase 1
 * (capacity & scheduling only, no time-tracking/billing).
 */

import { useEffect, useMemo, useState } from "react";
import { CalendarClock, ChevronLeft, ChevronRight, Plus, RefreshCw, AlertTriangle, X, Loader, Check } from "lucide-react";
import { Field, Section, SelectField, controlInset } from "@/components/form-kit";

const ASSIGNABLE_LABEL: Record<string, string> = { project: "Project", manufacturing_order: "Manufacturing Order", job_work_order: "Job Work Order" };
const ASSIGNABLE_ENDPOINT: Record<string, string> = { project: "/api/projects", manufacturing_order: "/api/production/mos", job_work_order: "/api/inventory/jobwork" };
function assignableOptionLabel(type: string, row: any): string {
  if (type === "project") return row.name;
  if (type === "manufacturing_order") return `${row.moNo} — ${row.outputItem?.name ?? ""}`;
  return row.docNumber ? `${row.docNumber}` : row.id;
}

function startOfWeek(d: Date) { const x = new Date(d); const day = x.getDay(); x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
const iso = (d: Date) => d.toISOString().slice(0, 10);
const dowLabel = (d: Date) => d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });

export function ResourceBoard() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [rows, setRows] = useState<any[] | null>(null);
  const [showNew, setShowNew] = useState(false);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; }), [weekStart]);
  const from = iso(days[0]), to = iso(days[6]);

  async function load() {
    setRows(await fetch(`/api/resources/assignments?from=${from}&to=${to}`).then(r => r.json()).catch(() => []));
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to]);

  const list = rows ?? [];

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-pink-500/15 flex items-center justify-center"><CalendarClock size={18} className="text-pink-400" /></div>
          <h1 className="text-xl font-semibold text-stone-100">Resource Board</h1>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() - 7); return n; })} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500"><ChevronLeft size={15} /></button>
          <span className="text-[12px] text-stone-400 tabular-nums">{from} – {to}</span>
          <button onClick={() => setWeekStart(d => { const n = new Date(d); n.setDate(n.getDate() + 7); return n; })} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500"><ChevronRight size={15} /></button>
          <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} className={rows === null ? "animate-spin" : ""} /></button>
          <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-3.5 py-2 hover:bg-emerald-700"><Plus size={14} /> New assignment</button>
        </div>
      </div>
      <p className="text-sm text-stone-400 mb-5 ml-12">Who and what is booked this week, against which Project or production order.</p>

      {showNew && <NewAssignmentDrawer onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}

      {rows === null ? <p className="text-sm text-stone-500">Loading…</p> : list.length === 0 ? (
        <div className="rounded-xl border border-dashed border-stone-800 p-10 text-center text-stone-500 text-sm">No active resources — add People or Equipment first.</div>
      ) : (
        <div className="rounded-xl border border-stone-800 overflow-x-auto">
          <table className="w-full text-[12.5px] min-w-[820px]">
            <thead>
              <tr className="border-b border-stone-800 bg-stone-950/40">
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-stone-500 sticky left-0 bg-stone-950/40">Resource</th>
                {days.map(d => <th key={iso(d)} className="text-center px-2 py-2 text-[10px] uppercase tracking-wider text-stone-500 min-w-[100px]">{dowLabel(d)}</th>)}
              </tr>
            </thead>
            <tbody>
              {list.map((r: any) => (
                <tr key={r.id} className="border-b border-stone-800/50">
                  <td className="px-3 py-2 sticky left-0 bg-stone-900">
                    <div className="text-stone-100">{r.name}</div>
                    <div className="flex items-center gap-1.5 text-[10px] text-stone-500">
                      <span>{r.category || (r.type === "person" ? "Person" : "Equipment")}</span>
                      {r.overAllocated && <span className="inline-flex items-center gap-0.5 text-amber-400"><AlertTriangle size={10} /> Over-allocated</span>}
                    </div>
                  </td>
                  {days.map(d => {
                    const dstr = iso(d);
                    const onDay = (r.assignments ?? []).filter((a: any) => a.startDate <= dstr && (!a.endDate || a.endDate >= dstr));
                    return (
                      <td key={dstr} className="px-1.5 py-2 align-top">
                        <div className="space-y-1">
                          {onDay.map((a: any) => (
                            <div key={a.id} className={`text-[10.5px] rounded px-1.5 py-1 border ${a.status === "cancelled" ? "border-stone-800 text-stone-600 line-through" : "border-pink-800/40 bg-pink-500/10 text-pink-300"}`}>
                              {ASSIGNABLE_LABEL[a.assignableType] ?? a.assignableType} · {a.allocationPercent}%
                            </div>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function NewAssignmentDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [resources, setResources] = useState<any[]>([]);
  const [assignableType, setAssignableType] = useState("project");
  const [assignableOptions, setAssignableOptions] = useState<any[]>([]);
  const [form, setForm] = useState({ resourceId: "", assignableId: "", startDate: new Date().toISOString().slice(0, 10), endDate: "", allocationPercent: "100", notes: "" });
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");

  useEffect(() => { fetch("/api/resources?status=active").then(r => r.json()).then(d => setResources(Array.isArray(d) ? d : [])).catch(() => {}); }, []);
  useEffect(() => {
    setForm(f => ({ ...f, assignableId: "" }));
    fetch(ASSIGNABLE_ENDPOINT[assignableType]).then(r => r.json()).then(d => setAssignableOptions(Array.isArray(d) ? d : (d?.rows ?? []))).catch(() => setAssignableOptions([]));
  }, [assignableType]);

  async function save() {
    if (!form.resourceId) { setErr("Choose a resource."); return; }
    if (!form.assignableId) { setErr(`Choose a ${ASSIGNABLE_LABEL[assignableType]}.`); return; }
    setSaving(true); setErr("");
    const r = await fetch("/api/resources/assignments", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, assignableType, allocationPercent: Number(form.allocationPercent) || 100, endDate: form.endDate || null }),
    });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not create assignment."); return; }
    onCreated();
  }

  return (
    <Drawer title="New assignment" onClose={onClose}>
      <div className="space-y-6">
        <Section title="Book">
          <div className="grid grid-cols-2 gap-x-4 gap-y-4">
            <Field label="Resource" required className="col-span-2">
              <SelectField inset value={form.resourceId} onChange={e => setForm(f => ({ ...f, resourceId: e.target.value }))}>
                <option value="">Select…</option>
                {resources.map(r => <option key={r.id} value={r.id}>{r.name} ({r.type === "person" ? "Person" : "Equipment"})</option>)}
              </SelectField>
            </Field>
            <Field label="Assign to" required>
              <SelectField inset value={assignableType} onChange={e => setAssignableType(e.target.value)}>
                <option value="project">Project</option>
                <option value="manufacturing_order">Manufacturing Order</option>
                <option value="job_work_order">Job Work Order</option>
              </SelectField>
            </Field>
            <Field label={ASSIGNABLE_LABEL[assignableType]} required>
              <SelectField inset value={form.assignableId} onChange={e => setForm(f => ({ ...f, assignableId: e.target.value }))}>
                <option value="">Select…</option>
                {assignableOptions.map((o: any) => <option key={o.id} value={o.id}>{assignableOptionLabel(assignableType, o)}</option>)}
              </SelectField>
            </Field>
            <Field label="Start date" required>
              <input type="date" className={controlInset} value={form.startDate} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
            </Field>
            <Field label="End date" hint="Optional — leave blank for open-ended">
              <input type="date" className={controlInset} value={form.endDate} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
            </Field>
            <Field label="Allocation %" hint="% of the resource's daily capacity" className="col-span-2">
              <input type="number" min={1} max={100} className={`${controlInset} w-32`} value={form.allocationPercent} onChange={e => setForm(f => ({ ...f, allocationPercent: e.target.value }))} />
            </Field>
            <Field label="Notes" className="col-span-2">
              <textarea className={`${controlInset} !h-auto py-2`} rows={2} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </Field>
          </div>
        </Section>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
      </div>
      <div className="flex items-center justify-end gap-2 mt-6 pt-4 border-t border-stone-800">
        <button onClick={onClose} className="text-[13px] font-medium text-stone-300 px-3.5 py-2 rounded-lg hover:bg-stone-800">Cancel</button>
        <button onClick={save} disabled={saving} className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 hover:bg-emerald-700 disabled:opacity-60">
          {saving ? <Loader size={14} className="animate-spin" /> : <Check size={14} />} Create assignment
        </button>
      </div>
    </Drawer>
  );
}

function Drawer({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => { const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", on); return () => window.removeEventListener("keydown", on); }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div className="relative bg-stone-900 border-l border-stone-800 h-full overflow-y-auto shadow-2xl w-full max-w-lg" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800 sticky top-0 bg-stone-900 z-10">
          <h2 className="text-[15px] font-semibold text-stone-100">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-500"><X size={17} /></button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
