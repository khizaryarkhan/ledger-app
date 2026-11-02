"use client";

/**
 * A person's contracted hours, with the dates they applied.
 *
 * The "Daily capacity" field above this panel is a current value: change it and
 * every past figure moves with it. A row here says what was true BETWEEN two
 * dates, so last quarter keeps reading as last quarter. Anyone with no rows
 * keeps using that field, which is why this panel can be left empty.
 *
 * A row is added or removed, never edited: changing a span in place is exactly
 * the restatement these rows exist to prevent. Close the old one and add the
 * new one.
 */

import { useCallback, useEffect, useState } from "react";
import { Trash2, Plus, Loader } from "lucide-react";
import { Field, controlInset } from "@/components/form-kit";
import { formatDateShort } from "@/lib/format";

const WEEKDAYS = [{ v: 1, l: "Mon" }, { v: 2, l: "Tue" }, { v: 3, l: "Wed" }, { v: 4, l: "Thu" }, { v: 5, l: "Fri" }, { v: 6, l: "Sat" }, { v: 7, l: "Sun" }];

interface Row {
  id: string; hoursPerDay: number; workingDays: number[] | null;
  effectiveFrom: string; effectiveTo: string | null; note: string | null;
}

const daysLabel = (days: number[] | null): string =>
  !days || days.length === 0
    ? "their usual days"
    : WEEKDAYS.filter((w) => days.includes(w.v)).map((w) => w.l).join(", ");

export function WorkingHoursPanel({ resourceId, canEdit }: { resourceId: string; canEdit: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState({ hoursPerDay: "8", effectiveFrom: "", effectiveTo: "", workingDays: [] as number[], note: "" });

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/resources/${resourceId}/working-hours`);
      const body = await r.json().catch(() => null);
      setRows(Array.isArray(body) ? body : []);
    } catch { setRows([]); }
  }, [resourceId]);
  useEffect(() => { load(); }, [load]);

  async function add() {
    if (!draft.effectiveFrom) { setErr("A start date is required."); return; }
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/resources/${resourceId}/working-hours`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hoursPerDay: draft.hoursPerDay,
          effectiveFrom: draft.effectiveFrom,
          effectiveTo: draft.effectiveTo || null,
          workingDays: draft.workingDays,
          note: draft.note || null,
        }),
      });
      if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
      setDraft({ hoursPerDay: "8", effectiveFrom: "", effectiveTo: "", workingDays: [], note: "" });
      setAdding(false);
      await load();
    } finally { setBusy(false); }
  }

  async function remove(id: string) {
    setBusy(true); setErr("");
    try {
      const r = await fetch(`/api/resources/${resourceId}/working-hours/${id}`, { method: "DELETE" });
      if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not remove."); return; }
      await load();
    } finally { setBusy(false); }
  }

  const toggleDay = (d: number) =>
    setDraft((s) => ({ ...s, workingDays: s.workingDays.includes(d) ? s.workingDays.filter((x) => x !== d) : [...s.workingDays, d].sort() }));

  if (rows === null) return <p className="text-[13px] text-stone-500">Loading…</p>;

  return (
    <div className="flex flex-col gap-3">
      {rows.length === 0 && (
        <p className="text-[13px] text-stone-500">
          None recorded — capacity uses the Daily capacity field above, and changing it also changes past figures.
        </p>
      )}

      {rows.length > 0 && (
        <ul className="rounded-lg border border-stone-800 divide-y divide-stone-800/60">
          {rows.map((r) => (
            <li key={r.id} className="flex items-start gap-3 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="text-[13px] text-stone-200">
                  {r.hoursPerDay} h/day <span className="text-stone-500">on {daysLabel(r.workingDays)}</span>
                </div>
                <div className="text-[12px] text-stone-500">
                  {formatDateShort(r.effectiveFrom, { year: true })} — {r.effectiveTo ? formatDateShort(r.effectiveTo, { year: true }) : "ongoing"}
                  {r.note && <span> · {r.note}</span>}
                </div>
              </div>
              {canEdit && (
                <button onClick={() => remove(r.id)} disabled={busy} aria-label="Remove"
                  className="p-1.5 rounded hover:bg-stone-800 text-stone-500 hover:text-rose-400 disabled:opacity-50">
                  <Trash2 size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {err && <p className="text-[12px] text-rose-400">{err}</p>}

      {canEdit && !adding && (
        <button onClick={() => setAdding(true)}
          className="h-8 self-start px-3 rounded-md ring-1 ring-stone-700 bg-stone-800 text-[12px] text-stone-300 hover:text-stone-100 flex items-center gap-1.5">
          <Plus size={13} /> Add a period
        </button>
      )}

      {canEdit && adding && (
        <div className="rounded-lg border border-stone-800 p-3 grid grid-cols-2 gap-x-4 gap-y-3">
          <Field label="Hours per day" required>
            <input type="number" step="0.25" className={controlInset} value={draft.hoursPerDay}
              onChange={(e) => setDraft((s) => ({ ...s, hoursPerDay: e.target.value }))} />
          </Field>
          <Field label="Note" hint="Optional, e.g. 'moved to 4 days'">
            <input className={controlInset} value={draft.note} onChange={(e) => setDraft((s) => ({ ...s, note: e.target.value }))} />
          </Field>
          <Field label="From" required>
            <input type="date" className={controlInset} value={draft.effectiveFrom}
              onChange={(e) => setDraft((s) => ({ ...s, effectiveFrom: e.target.value }))} />
          </Field>
          <Field label="To" hint="Leave empty while it is still in force">
            <input type="date" className={controlInset} value={draft.effectiveTo}
              onChange={(e) => setDraft((s) => ({ ...s, effectiveTo: e.target.value }))} />
          </Field>
          <Field label="Working days" className="col-span-2" hint="Leave all unticked to keep the person's usual days">
            <div className="flex items-center gap-3 flex-wrap">
              {WEEKDAYS.map((w) => (
                <label key={w.v} className="flex items-center gap-1.5 text-[12px] text-stone-300">
                  <input type="checkbox" checked={draft.workingDays.includes(w.v)} onChange={() => toggleDay(w.v)} />
                  {w.l}
                </label>
              ))}
            </div>
          </Field>
          <div className="col-span-2 flex items-center gap-2">
            {busy && <Loader size={13} className="animate-spin text-stone-500" />}
            <div className="flex-1" />
            <button onClick={() => { setAdding(false); setErr(""); }}
              className="h-8 px-3 rounded-md ring-1 ring-stone-700 bg-stone-800 text-[12px] text-stone-300 hover:text-stone-100">Cancel</button>
            <button onClick={add} disabled={busy}
              className="h-8 px-3 rounded-md bg-stone-200 hover:bg-white text-stone-900 text-[12px] font-semibold disabled:opacity-50">Add</button>
          </div>
        </div>
      )}
    </div>
  );
}
