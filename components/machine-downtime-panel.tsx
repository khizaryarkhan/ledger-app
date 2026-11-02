"use client";

/**
 * A linked machine's stoppages and the maintenance windows booked ahead.
 *
 * Reads GET /api/resources/[id]/downtime; booking or logging writes the existing
 * /api/production/downtime, so a window booked here is the same record the
 * Production performance report counts. Nothing is held in this component that
 * the server does not also hold.
 *
 * A machine with no work centre renders nothing: downtime is recorded against
 * the work centre, so there is nowhere to put it.
 */

import { useCallback, useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { Field, Section, SelectField, controlInset } from "@/components/form-kit";
import { DOWNTIME_REASONS } from "@/lib/inventory/production-performance";

const fmtWhen = (v: string | null) => (v ? new Date(v).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "ongoing");
const fmtMins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

export function MachineDowntimePanel({ resourceId, linkKey }: { resourceId: string; linkKey: string }) {
  const [d, setD] = useState<any>(null);
  const [form, setForm] = useState({ reason: "maintenance", start: "", end: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // `linkKey` re-reads after the work centre link changes.
  const load = useCallback(() => {
    fetch(`/api/resources/${resourceId}/downtime`).then(r => (r.ok ? r.json() : null)).then(setD).catch(() => setD(null));
  }, [resourceId, linkKey]);
  useEffect(load, [load]);

  if (!d?.linked) return null;

  async function add() {
    if (!form.start) { setErr("Enter when it starts."); return; }
    setBusy(true); setErr("");
    // datetime-local has no zone; new Date() reads it as the viewer's local time,
    // which is what they meant, and ISO makes it an unambiguous instant.
    const r = await fetch("/api/production/downtime", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workCentreId: d.workCentre.id, reason: form.reason,
        startedAt: new Date(form.start).toISOString(),
        endedAt: form.end ? new Date(form.end).toISOString() : null,
        notes: form.notes || null,
      }),
    });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    setForm({ reason: form.reason, start: "", end: "", notes: "" });
    load();
  }

  async function remove(id: string) {
    if (!confirm("Remove this entry?")) return;
    const r = await fetch(`/api/production/downtime/${id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not remove."); return; }
    load();
  }

  const Row = ({ r, minutes }: { r: any; minutes?: number }) => (
    <li className="flex items-start justify-between gap-3 text-[13px]">
      <div>
        <span className="text-stone-200">{r.reasonLabel}</span>
        {!r.planned && <span className="text-amber-400"> · unplanned</span>}
        <div className="text-stone-500">
          {fmtWhen(r.startedAt)} → {fmtWhen(r.endedAt)}{minutes != null ? ` · ${fmtMins(minutes)}` : ""}
          {r.notes ? ` · ${r.notes}` : ""}
        </div>
      </div>
      <button onClick={() => remove(r.id)} title="Remove" className="p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-rose-400"><Trash2 size={13} /></button>
    </li>
  );

  return (
    <Section title="Downtime & maintenance">
      <div className="space-y-4">
        <p className="text-[13px] text-stone-300">
          Last 30 days: <span className="text-white font-medium">{fmtMins(d.unplannedMinutes)}</span> unplanned,{" "}
          <span className="text-white font-medium">{fmtMins(d.plannedMinutes)}</span> planned
        </p>

        <div>
          <h4 className="text-[12px] uppercase tracking-wide text-stone-500 mb-1.5">Booked ahead</h4>
          {d.upcoming.length === 0
            ? <p className="text-[13px] text-stone-500">Nothing booked.</p>
            : <ul className="space-y-2">{d.upcoming.map((r: any) => <Row key={r.id} r={r} />)}</ul>}
        </div>

        <div>
          <h4 className="text-[12px] uppercase tracking-wide text-stone-500 mb-1.5">Recent</h4>
          {d.happened.length === 0
            ? <p className="text-[13px] text-stone-500">No stoppages in this period.</p>
            : <ul className="space-y-2">{d.happened.slice(0, 5).map((r: any) => <Row key={r.id} r={r} minutes={r.minutes} />)}</ul>}
        </div>

        <div className="grid grid-cols-2 gap-x-4 gap-y-3 pt-1">
          <Field label="Reason" className="col-span-2">
            <SelectField inset value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))}>
              {DOWNTIME_REASONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
            </SelectField>
          </Field>
          <Field label="Starts" hint="A start still ahead is booked, and counts as downtime only once it happens">
            <input type="datetime-local" className={controlInset} value={form.start} onChange={e => setForm(f => ({ ...f, start: e.target.value }))} />
          </Field>
          <Field label="Ends" hint="Blank = still stopped">
            <input type="datetime-local" className={controlInset} value={form.end} onChange={e => setForm(f => ({ ...f, end: e.target.value }))} />
          </Field>
          <Field label="Notes" className="col-span-2">
            <input className={controlInset} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
          </Field>
          <div className="col-span-2 flex items-center gap-3">
            <button onClick={add} disabled={busy} className="h-8 px-3 rounded-md text-[12px] bg-stone-700 text-stone-100 hover:bg-stone-600 disabled:opacity-50">
              {busy ? "Saving…" : "Add"}
            </button>
            {err && <span className="text-[12px] text-rose-400">{err}</span>}
          </div>
        </div>
      </div>
    </Section>
  );
}
