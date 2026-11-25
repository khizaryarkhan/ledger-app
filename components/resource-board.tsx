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
import { ChevronLeft, ChevronRight, Plus, RefreshCw, AlertTriangle, X, Loader, Check } from "lucide-react";
import { Field, Section, SelectField, controlInset, Drawer, DrawerFooter } from "@/components/form-kit";
import { localToday, ymd } from "@/lib/format";
import { ASSIGNABLE_LABEL, ASSIGNABLE_ENDPOINT, assignableOptionLabel, type AssignableType } from "@/lib/resources/assignable";

// Monday-start, like the timesheet and every report (getDay() is 0 on Sunday).
function startOfWeek(d: Date) { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x; }
const iso = (d: Date) => ymd(d);

// One colour per project, the same wherever it appears this week, so a bar can be read at a glance.
const PROJECT_COLOURS = ["#3b82f6", "#f97316", "#10b981", "#eab308", "#ec4899", "#8b5cf6", "#06b6d4", "#84cc16"];
const keyOf = (a: any) => `${a.assignableType}:${a.assignableId}`;
const initials = (name: string) => name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const rangeLabel = (days: Date[]) => {
  const f = (d: Date, withYear: boolean) => d.toLocaleDateString(undefined, { day: "numeric", month: "short", ...(withYear ? { year: "numeric" } : {}) });
  return `${f(days[0], false)} – ${f(days[6], true)}`;
};

/** Is this a day the resource works? (ISO weekday, Mon=1..Sun=7; null pattern = Mon-Fri.) */
function worksOn(r: any, d: Date): boolean {
  const isoDow = ((d.getDay() + 6) % 7) + 1;
  return (r.workingDays?.length ? r.workingDays : [1, 2, 3, 4, 5]).includes(isoDow);
}

/** Average booked % over the days this resource works this week (0 when it works none). */
function weekUtilisation(r: any, days: Date[]): number {
  const working = days.filter((d) => worksOn(r, d));
  if (!working.length) return 0;
  const total = working.reduce((sum, d) => {
    const dstr = iso(d);
    return sum + (r.assignments ?? []).filter((a: any) => a.startDate <= dstr && (!a.endDate || a.endDate >= dstr))
      .reduce((s2: number, a: any) => s2 + (Number(a.allocationPercent) || 0), 0);
  }, 0);
  return Math.round(total / working.length);
}

export function ResourceBoard() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [rows, setRows] = useState<any[] | null>(null);
  const [showNew, setShowNew] = useState(false);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => { const d = new Date(weekStart); d.setDate(d.getDate() + i); return d; }), [weekStart]);
  const from = iso(days[0]), to = iso(days[6]);
  const today = localToday();
  const thisWeek = from <= today && today <= to;

  async function load() {
    const d = await fetch(`/api/resources/assignments?from=${from}&to=${to}`).then(r => r.json()).catch(() => []);
    // An error body is not an array; rendering it crashed the board.
    setRows(Array.isArray(d) ? d : []);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [from, to]);

  const list = rows ?? [];
  const shiftWeek = (n: number) => setWeekStart((d) => { const x = new Date(d); x.setDate(x.getDate() + 7 * n); return x; });

  // Colour and legend: every booking this week, in a stable order.
  const projects = useMemo(() => {
    const seen = new Map<string, { key: string; name: string }>();
    for (const r of list) for (const a of r.assignments ?? []) {
      if (!seen.has(keyOf(a))) seen.set(keyOf(a), { key: keyOf(a), name: a.code ?? a.label ?? ASSIGNABLE_LABEL[a.assignableType as AssignableType] ?? a.assignableType });
    }
    return Array.from(seen.values()).sort((x, y) => x.name.localeCompare(y.name));
  }, [list]);
  const colourOf = (a: any) => PROJECT_COLOURS[Math.max(0, projects.findIndex((p) => p.key === keyOf(a))) % PROJECT_COLOURS.length];

  return (
    <div className="flex flex-col h-[calc(100vh-44px)]">
      <div className="flex-shrink-0 px-6 py-4 border-b border-stone-800 bg-stone-950">
        <div className="flex flex-wrap items-center gap-3">
          <div className="mr-auto">
            <h1 className="text-[20px] font-semibold text-white tracking-tight">Resource Board</h1>
            <p className="text-[13px] text-stone-400 mt-0.5">Who is booked on what this week, and who has room.</p>
          </div>
          <div className="inline-flex items-center rounded-md ring-1 ring-stone-700 bg-stone-900">
            <button onClick={() => shiftWeek(-1)} className="h-8 w-8 inline-flex items-center justify-center text-stone-400 hover:text-stone-100" aria-label="Previous week"><ChevronLeft size={14} /></button>
            <span className="px-3 text-[12px] font-medium text-stone-200 tabular-nums min-w-[150px] text-center">{rangeLabel(days)}</span>
            <button onClick={() => shiftWeek(1)} className="h-8 w-8 inline-flex items-center justify-center text-stone-400 hover:text-stone-100" aria-label="Next week"><ChevronRight size={14} /></button>
          </div>
          <button onClick={() => setWeekStart(startOfWeek(new Date()))} disabled={thisWeek}
            className="h-8 px-3 rounded-md ring-1 ring-stone-700 text-[12px] font-medium text-stone-300 hover:text-stone-100 disabled:opacity-40">Today</button>
          <button onClick={load} className="h-8 w-8 inline-flex items-center justify-center rounded-md ring-1 ring-stone-700 text-stone-400 hover:text-stone-100" title="Refresh"><RefreshCw size={13} className={rows === null ? "animate-spin" : ""} /></button>
          <button onClick={() => setShowNew(true)} className="inline-flex items-center gap-1.5 h-8 text-[13px] font-semibold bg-primary text-white rounded-md px-3.5 hover:bg-primary-hover"><Plus size={14} /> New assignment</button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {showNew && <NewAssignmentDrawer bookable={list} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); load(); }} />}

        {projects.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3">
            {projects.map((p, i) => (
              <span key={p.key} className="inline-flex items-center gap-1.5 text-[11px] text-stone-300">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: PROJECT_COLOURS[i % PROJECT_COLOURS.length] }} />{p.name}
              </span>
            ))}
          </div>
        )}

        {rows === null ? <p className="text-[13px] text-stone-400">Loading…</p> : list.length === 0 ? (
          <div className="rounded-lg border border-dashed border-stone-800 p-10 text-center text-stone-400 text-[13px]">No active resources — add People or Equipment first.</div>
        ) : (
          <div className="rounded-lg ring-1 ring-stone-800 bg-stone-900 shadow-sm overflow-x-auto">
            <table className="w-full min-w-[980px] border-collapse">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-950/50">
                  <th className="text-left px-4 py-3 text-[11px] font-semibold uppercase tracking-wider text-stone-400 sticky left-0 bg-stone-950 w-[230px]">Resource</th>
                  {days.map((d) => {
                    const isToday = iso(d) === today;
                    return (
                      <th key={iso(d)} className="px-2 py-3 text-center min-w-[112px]">
                        <div className={`text-[11px] font-semibold uppercase tracking-wider ${isToday ? "text-primary-ink" : "text-stone-400"}`}>{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                        <div className={`mx-auto mt-0.5 w-7 h-7 rounded-full inline-flex items-center justify-center text-[13px] font-semibold tabular-nums ${isToday ? "bg-primary text-white" : "text-stone-200"}`}>{d.getDate()}</div>
                      </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {list.map((r: any) => {
                  const util = weekUtilisation(r, days);
                  const over = util > 100 || r.overAllocated;
                  return (
                    <tr key={r.id} className="border-b border-stone-800/70 last:border-b-0 hover:bg-stone-800/20">
                      <td className="px-4 py-3 sticky left-0 bg-stone-900 align-top">
                        <div className="flex items-start gap-3">
                          <div className="w-8 h-8 rounded-full bg-stone-700 text-[11px] font-semibold text-stone-100 flex items-center justify-center shrink-0">{initials(r.name)}</div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[13px] font-medium text-stone-100 truncate">{r.name}</div>
                            <div className="text-[11px] text-stone-400">{r.category || (r.type === "person" ? "Person" : "Equipment")}</div>
                            <div className="mt-1.5 flex items-center gap-2" title={`Average booked over the days ${r.name} works this week`}>
                              <div className="flex-1 h-1.5 rounded-full bg-stone-800 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, util)}%`, background: over ? "#f59e0b" : util === 0 ? "transparent" : "#10b981" }} />
                              </div>
                              <span className={`text-[11px] tabular-nums ${over ? "text-amber-400" : "text-stone-400"}`}>{util}%</span>
                            </div>
                            {over && <div className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber-400"><AlertTriangle size={10} /> Over-allocated</div>}
                          </div>
                        </div>
                      </td>
                      {days.map((d) => {
                        const dstr = iso(d);
                        const onDay = (r.assignments ?? []).filter((a: any) => a.startDate <= dstr && (!a.endDate || a.endDate >= dstr));
                        if (!worksOn(r, d)) return <td key={dstr} className="px-1.5 py-2 align-top bg-stone-950/50" title="Not a working day" />;
                        return (
                          <td key={dstr} className={`px-1.5 py-2 align-top ${dstr === today ? "bg-primary/5" : ""}`}>
                            <div className="space-y-1">
                              {onDay.length === 0 && <div className="text-[11px] text-stone-500 text-center py-2">Free</div>}
                              {onDay.map((a: any) => {
                                const colour = colourOf(a);
                                const name = a.label ?? a.code ?? ASSIGNABLE_LABEL[a.assignableType as AssignableType];
                                return (
                                  <div key={a.id} title={`${name} · ${Number(a.allocationPercent)}% · ${a.startDate}${a.endDate ? ` to ${a.endDate}` : " onwards"}`}
                                    className={`rounded-md pl-2 pr-1.5 py-1 text-[11px] leading-tight ${a.status === "cancelled" ? "text-stone-500 line-through" : "text-stone-100"}`}
                                    style={{ background: `${colour}26`, borderLeft: `3px solid ${colour}` }}>
                                    <div className="truncate font-semibold">{a.code ?? a.label ?? ASSIGNABLE_LABEL[a.assignableType as AssignableType] ?? a.assignableType}</div>
                                    <div className="text-stone-300 tabular-nums">{Number(a.allocationPercent)}%</div>
                                  </div>
                                );
                              })}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function NewAssignmentDrawer({ bookable, onClose, onCreated }: { bookable: any[]; onClose: () => void; onCreated: () => void }) {
  // Only who the board already shows: the server scoped that list to the people
  // this viewer may plan, so the picker never offers a booking it would refuse.
  const resources = bookable;
  const [assignableType, setAssignableType] = useState<AssignableType>("project");
  const [assignableOptions, setAssignableOptions] = useState<any[]>([]);
  const [form, setForm] = useState({ resourceId: "", assignableId: "", startDate: localToday(), endDate: "", allocationPercent: "100", notes: "" });
  const [saving, setSaving] = useState(false); const [err, setErr] = useState("");

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
    <Drawer title="New assignment" onClose={onClose}
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel="Create assignment" err={err} />}>
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
              <SelectField inset value={assignableType} onChange={e => setAssignableType(e.target.value as AssignableType)}>
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
      </div>
    </Drawer>
  );
}

