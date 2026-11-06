"use client";

/**
 * My timesheet: a Dynamics-style weekly grid. Rows are the (type + project)
 * combinations the person has added, columns are Monday to Sunday. Each cell
 * is one time entry, saved on blur/enter through /api/resources/me/**.
 *
 * Standalone on purpose: it uses no data-provider, so the same component runs
 * in the employee portal (no access to the app's data APIs) and in the app shell.
 * Colour is reserved for exceptions: rejected rows and days over capacity.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Send, Loader, Trash2 } from "lucide-react";
import { CalcInput, SelectField, cell, controlCompact, tableHead } from "@/components/form-kit";
import { ASSIGNABLE_LABEL, ASSIGNABLE_TYPES, type AssignableType } from "@/lib/resources/assignable";
import { weekDates, weekStartOf, isEditableStatus } from "@/lib/resources/time-entry-rules";
import { MyReturns } from "@/components/my-returns";
import { addDays } from "@/lib/accounting/report-periods";
import { localToday, formatDateShort } from "@/lib/format";
import { evalArithmetic } from "@/lib/calc";

interface Me {
  resource: { id: string; name: string; dailyCapacity: number } | null;
}
interface Entry {
  id: string; date: string; hours: string; timesheetTypeId: string;
  assignableType: string | null; assignableId: string | null; status: string; rejectedReason: string | null;
}
interface Options {
  types: { id: string; name: string; category: string; requiresAssignable: boolean; billable: boolean }[];
  assignables: Record<AssignableType, { id: string; label: string }[]>;
}
interface RowKey { typeId: string; aType: string | null; aId: string | null }

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS_LABEL: Record<string, string> = { draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Rejected", posted: "Posted", mixed: "Mixed" };
// Quiet by default; only rejected earns colour.
const STATUS_CLASS: Record<string, string> = {
  draft: "text-stone-500", submitted: "text-stone-300", approved: "text-stone-300", posted: "text-stone-400", mixed: "text-stone-400",
  rejected: "text-rose-300 bg-rose-500/10 ring-1 ring-rose-800/50",
};
const STATUS_RANK = ["rejected", "submitted", "approved", "posted", "draft"];

const keyOf = (r: RowKey) => `${r.typeId}|${r.aType ?? ""}|${r.aId ?? ""}`;
const hrs = (n: number) => String(Math.round(n * 100) / 100);

function rowStatus(statuses: string[]): string {
  if (statuses.length === 0) return "draft";
  const distinct = Array.from(new Set(statuses));
  if (distinct.length === 1) return distinct[0];
  return STATUS_RANK.find((s) => distinct.includes(s)) ?? "mixed";
}

async function api<T>(url: string, init?: RequestInit): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const r = await fetch(url, init);
    const body = await r.json().catch(() => ({}));
    // A fetch Response never has an `error` property, so the old `"error" in r`
    // test passed every 4xx/5xx through as success: refusals were invisible.
    if (!r.ok) return { ok: false, error: body?.error || "Something went wrong" };
    return { ok: true, data: body as T };
  } catch {
    return { ok: false, error: "Network problem. Try again." };
  }
}

export function MyTimesheet() {
  const [me, setMe] = useState<Me | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [weekStart, setWeekStart] = useState(() => weekStartOf(localToday()));
  const [entries, setEntries] = useState<Entry[]>([]);
  const [extraRows, setExtraRows] = useState<RowKey[]>([]);
  // Saves in flight. Cells are NOT disabled while a save runs: disabling the
  // cell the person just tabbed into dropped focus and lost their keystrokes.
  const [saving, setSaving] = useState(0);
  const busy = saving > 0;
  const setBusy = (on: boolean) => setSaving((n) => Math.max(0, n + (on ? 1 : -1)));
  // Bumped after a refused save so every cell re-reads the stored value
  // instead of keeping the number that was refused.
  const [rev, setRev] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [newType, setNewType] = useState("");
  const [newAssignable, setNewAssignable] = useState("");

  const days = useMemo(() => weekDates(weekStart), [weekStart]);

  const loadWeek = useCallback(async () => {
    const res = await api<Entry[]>(`/api/resources/me/time-entries?from=${weekStart}&to=${addDays(weekStart, 6)}`);
    if ("error" in res) setErr(res.error); else setEntries(Array.isArray(res.data) ? res.data : []);
  }, [weekStart]);

  useEffect(() => {
    api<Me>("/api/resources/me").then((r) => { if ("error" in r) setErr(r.error); else setMe(r.data); });
    api<Options>("/api/resources/me/options").then((r) => { if ("error" in r) setErr(r.error); else setOptions(r.data); });
  }, []);
  useEffect(() => { if (me?.resource) loadWeek(); }, [me, loadWeek]);
  useEffect(() => { setExtraRows([]); }, [weekStart]);

  const rows: RowKey[] = useMemo(() => {
    const seen = new Map<string, RowKey>();
    for (const e of entries) {
      const rk = { typeId: e.timesheetTypeId, aType: e.assignableType, aId: e.assignableId };
      seen.set(keyOf(rk), rk);
    }
    for (const r of extraRows) if (!seen.has(keyOf(r))) seen.set(keyOf(r), r);
    return Array.from(seen.values());
  }, [entries, extraRows]);

  const typeName = (id: string) => options?.types.find((t) => t.id === id)?.name ?? "Type";
  const assignableLabel = (t: string | null, id: string | null) =>
    !t || !id ? "" : options?.assignables[t as AssignableType]?.find((a) => a.id === id)?.label ?? "";

  if (err && (!me || !options)) return <div className="p-6 text-[13px] text-rose-400">{err}</div>;
  if (!me || !options) return <div className="p-6 text-[13px] text-stone-500">Loading...</div>;
  if (!me.resource) {
    return (
      <div className="p-6">
        <div className="max-w-md rounded-lg border border-stone-800 bg-stone-900 p-5 text-[13px] text-stone-300">
          Your login is not linked to a person yet. Ask an admin to link it to your profile.
        </div>
      </div>
    );
  }

  const capacity = me.resource.dailyCapacity;
  const cellEntries = (r: RowKey, date: string) => entries.filter((e) => keyOf({ typeId: e.timesheetTypeId, aType: e.assignableType, aId: e.assignableId }) === keyOf(r) && e.date === date);
  const dayTotal = (date: string) => entries.filter((e) => e.date === date).reduce((s, e) => s + Number(e.hours), 0);
  const weekTotal = days.reduce((s, d) => s + dayTotal(d), 0);
  const submittable = entries.filter((e) => e.status === "draft" || e.status === "rejected").length;

  async function saveCell(r: RowKey, date: string, raw: string) {
    setErr(null);
    const existing = cellEntries(r, date);
    if (existing.length > 1) return;
    const text = raw.trim();
    // The field is a calculator: "4+4" arrives here as text (CalcInput's own
    // evaluation is still a queued state update), so evaluate it the same way.
    const value = text === "" ? 0 : Number.isFinite(Number(text)) ? Number(text) : evalArithmetic(text) ?? NaN;
    if (!Number.isFinite(value) || value < 0) { setErr("Hours must be a number."); return; }
    const entry = existing[0];
    if (entry && !isEditableStatus(entry.status)) return;
    if (entry && Number(entry.hours) === value) return;
    if (!entry && value === 0) return;
    setBusy(true);
    let res;
    if (entry && value === 0) res = await api(`/api/resources/me/time-entries/${entry.id}`, { method: "DELETE" });
    else if (entry) res = await api(`/api/resources/me/time-entries/${entry.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hours: value }) });
    else res = await api("/api/resources/me/time-entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, hours: value, timesheetTypeId: r.typeId, assignableType: r.aType, assignableId: r.aId }) });
    if ("error" in res) { setErr(res.error); setRev((x) => x + 1); }
    await loadWeek();
    setBusy(false);
  }

  async function submitWeek() {
    setErr(null); setBusy(true);
    const res = await api("/api/resources/me/submit-week", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ weekStart }) });
    if ("error" in res) setErr(res.error);
    await loadWeek();
    setBusy(false);
  }

  async function removeRow(r: RowKey) {
    setErr(null); setBusy(true);
    const mine = entries.filter((e) => keyOf({ typeId: e.timesheetTypeId, aType: e.assignableType, aId: e.assignableId }) === keyOf(r));
    for (const e of mine) {
      if (!isEditableStatus(e.status)) continue;
      const res = await api(`/api/resources/me/time-entries/${e.id}`, { method: "DELETE" });
      if ("error" in res) { setErr(res.error); break; }
    }
    setExtraRows((x) => x.filter((k) => keyOf(k) !== keyOf(r)));
    await loadWeek();
    setBusy(false);
  }

  const chosenType = options.types.find((t) => t.id === newType);
  const assignableChoices = ASSIGNABLE_TYPES.flatMap((t) => options.assignables[t].map((a) => ({ ...a, t })));
  const canAdd = !!chosenType && (!chosenType.requiresAssignable || !!newAssignable);

  function addRow() {
    if (!chosenType) return;
    const picked = chosenType.requiresAssignable ? assignableChoices.find((a) => `${a.t}:${a.id}` === newAssignable) : null;
    setExtraRows((x) => [...x, { typeId: chosenType.id, aType: picked?.t ?? null, aId: picked?.id ?? null }]);
    setNewType(""); setNewAssignable("");
  }

  const thisWeek = weekStartOf(localToday());

  return (
    <div className="flex flex-col gap-4 px-6 py-4">
      {/* Returned time first: it is the one thing on this page asking for
          something back. Renders nothing when there are no returns. */}
      <MyReturns />
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week" className="h-8 w-8 flex items-center justify-center rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-400 hover:text-stone-200"><ChevronLeft size={15} /></button>
        <button onClick={() => setWeekStart(thisWeek)} disabled={weekStart === thisWeek} className="h-8 px-3 rounded-md ring-1 ring-stone-700 bg-stone-800 text-[12px] text-stone-300 hover:text-stone-100 disabled:opacity-50">This week</button>
        <button onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week" className="h-8 w-8 flex items-center justify-center rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-400 hover:text-stone-200"><ChevronRight size={15} /></button>
        <span className="text-[13px] text-stone-300 ml-1">{formatDateShort(days[0])} to {formatDateShort(days[6], { year: true })}</span>
        <div className="flex-1" />
        {err && <span className="text-[12px] text-rose-400">{err}</span>}
        {busy && <Loader size={14} className="animate-spin text-stone-500" />}
        <button onClick={submitWeek} disabled={busy || submittable === 0} className="h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-50">
          <Send size={13} /> Submit week{submittable ? ` (${submittable})` : ""}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-stone-800">
        <table className="w-full text-[13px] min-w-[860px]">
          <thead>
            <tr className={`text-left ${tableHead}`}>
              <th className="px-3 py-2.5 font-medium">Type and project</th>
              {days.map((d, i) => (
                <th key={d} className="px-1 py-2.5 font-medium text-center w-[76px]">
                  <div>{DAY_NAMES[i]}</div>
                  <div className="normal-case tracking-normal text-stone-600">{formatDateShort(d)}</div>
                </th>
              ))}
              <th className="px-2 py-2.5 font-medium text-right w-[64px]">Total</th>
              <th className="px-2 py-2.5 font-medium w-[110px]">Status</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-stone-500">No time yet this week. Add a row below.</td></tr>
            )}
            {rows.map((r) => {
              const mine = entries.filter((e) => keyOf({ typeId: e.timesheetTypeId, aType: e.assignableType, aId: e.assignableId }) === keyOf(r));
              const status = rowStatus(mine.map((e) => e.status));
              const reason = mine.find((e) => e.status === "rejected")?.rejectedReason;
              const rowTotal = mine.reduce((s, e) => s + Number(e.hours), 0);
              const sub = assignableLabel(r.aType, r.aId);
              return (
                <tr key={keyOf(r)} className="border-b border-stone-800/60 align-top">
                  <td className="px-3 py-2">
                    <div className="text-stone-100">{typeName(r.typeId)}</div>
                    {sub && <div className="text-[12px] text-stone-500">{sub}</div>}
                    {reason && <div className="text-[12px] text-rose-400 mt-0.5">Rejected: {reason}</div>}
                  </td>
                  {days.map((d) => {
                    const ce = cellEntries(r, d);
                    const locked = ce.length > 1 || (ce[0] ? !isEditableStatus(ce[0].status) : false);
                    const total = ce.reduce((s, e) => s + Number(e.hours), 0);
                    return (
                      <td key={`${d}-${rev}`} className="px-1 py-1.5">
                        <CalcInput
                          value={total ? hrs(total) : ""}
                          onChange={() => { /* committed on blur */ }}
                          onBlur={(e) => saveCell(r, d, e.currentTarget.value)}
                          // Enter saves too: blurring runs CalcInput's own commit and then saveCell.
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                          disabled={locked}
                          aria-label={`${typeName(r.typeId)} hours on ${d}`}
                          placeholder="0"
                          className={`${cell} text-center tabular-nums ${locked ? "text-stone-500" : ""}`}
                        />
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 text-right tabular-nums text-stone-300">{hrs(rowTotal)}</td>
                  <td className="px-2 py-2">
                    <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] ${STATUS_CLASS[status] ?? STATUS_CLASS.draft}`}>{STATUS_LABEL[status] ?? status}</span>
                  </td>
                  <td className="px-1 py-1.5">
                    <button onClick={() => removeRow(r)} disabled={busy || mine.some((e) => !isEditableStatus(e.status))} aria-label="Remove row" className="p-1.5 rounded-md text-stone-600 hover:text-stone-300 disabled:opacity-30"><Trash2 size={13} /></button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="text-[12px]">
              <td className="px-3 py-2.5 text-stone-400">Total (capacity {hrs(capacity)} h/day)</td>
              {days.map((d) => {
                const t = dayTotal(d);
                const over = t > capacity;
                return (
                  <td key={d} className={`px-1 py-2.5 text-center tabular-nums ${over ? "text-rose-400 font-semibold" : "text-stone-300"}`} title={over ? "Over daily capacity" : undefined}>{hrs(t)}</td>
                );
              })}
              <td className="px-2 py-2.5 text-right tabular-nums text-stone-100 font-semibold">{hrs(weekTotal)}</td>
              <td colSpan={2} className="px-2 py-2.5 text-stone-500">of {hrs(capacity * 5)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="w-56">
          <SelectField inset={false} className="!h-8 !text-[12px]" value={newType} onChange={(e) => { setNewType(e.target.value); setNewAssignable(""); }} aria-label="Timesheet type">
            <option value="">Timesheet type...</option>
            {options.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </SelectField>
        </div>
        {chosenType?.requiresAssignable && (
          <div className="w-72">
            <SelectField className="!h-8 !text-[12px]" value={newAssignable} onChange={(e) => setNewAssignable(e.target.value)} aria-label="Project or order">
              <option value="">Project or order...</option>
              {ASSIGNABLE_TYPES.map((t) => options.assignables[t].length > 0 && (
                <optgroup key={t} label={ASSIGNABLE_LABEL[t]}>
                  {options.assignables[t].map((a) => <option key={a.id} value={`${t}:${a.id}`}>{a.label}</option>)}
                </optgroup>
              ))}
            </SelectField>
          </div>
        )}
        <button onClick={addRow} disabled={!canAdd} className={`${controlCompact} flex items-center gap-1.5 text-stone-300 hover:text-stone-100 disabled:opacity-50`}>
          <Plus size={13} /> Add row
        </button>
      </div>
    </div>
  );
}
