"use client";

/**
 * My timesheet: a weekly grid of LINES. A line is one booking (timesheet type
 * + project / order) in one status, Monday to Sunday; each cell is one time
 * entry, saved on blur/enter through /api/resources/me/**.
 *
 * The person works the week as Draft, ticks all or some lines and submits them
 * when ready. An approver decides each entry on its own, so a submitted line
 * can come back part approved, part returned: the line SPLITS into one line per
 * status (lib/resources/timesheet-lines.ts), each with its own actions —
 * Submit (Draft / Rejected), Recall (Submitted, not yet decided), Delete
 * (Draft / Rejected). Copy Week brings an earlier week's lines in as Drafts.
 *
 * Standalone on purpose: it uses no data-provider, so the same component runs
 * in the employee portal (no access to the app's data APIs) and in the app shell.
 * Colour is reserved for exceptions: rejected lines and days over capacity.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Send, Loader, Trash2, Undo2, Copy } from "lucide-react";
import { CalcInput, SelectField, Drawer, DrawerFooter, cell, controlCompact, tableHead } from "@/components/form-kit";
import { listCheckbox } from "@/components/list-view";
import { ASSIGNABLE_LABEL, ASSIGNABLE_TYPES, type AssignableType } from "@/lib/resources/assignable";
import { weekDates, weekStartOf } from "@/lib/resources/time-entry-rules";
import {
  buildLines, lineIsEditable, lineAcceptsNewHours, actionAppliesTo, bookingKey, COPY_WEEKS_BACK,
  type Booking, type TimesheetLine, type LineAction, type CopyRow,
} from "@/lib/resources/timesheet-lines";
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

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const STATUS_LABEL: Record<string, string> = { new: "New", draft: "Draft", submitted: "Submitted", approved: "Approved", rejected: "Rejected", posted: "Posted" };
// Quiet by default; only rejected earns colour.
const STATUS_CLASS: Record<string, string> = {
  new: "text-stone-500", draft: "text-stone-400 ring-1 ring-stone-700", submitted: "text-stone-300", approved: "text-stone-300", posted: "text-stone-400",
  rejected: "text-rose-300 bg-rose-500/10 ring-1 ring-rose-800/50",
};

const hrs = (n: number) => String(Math.round(n * 100) / 100);

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
const postJson = (body: unknown): RequestInit => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

export function MyTimesheet() {
  const [me, setMe] = useState<Me | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [weekStart, setWeekStart] = useState(() => weekStartOf(localToday()));
  const [entries, setEntries] = useState<Entry[]>([]);
  // Lines added with Add Line that have no hours yet.
  const [added, setAdded] = useState<Booking[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Saves in flight. Cells are NOT disabled while a save runs: disabling the
  // cell the person just tabbed into dropped focus and lost their keystrokes.
  const [saving, setSaving] = useState(0);
  const busy = saving > 0;
  const setBusy = (on: boolean) => setSaving((n) => Math.max(0, n + (on ? 1 : -1)));
  // Bumped after a refused save so every cell re-reads the stored value
  // instead of keeping the number that was refused.
  const [rev, setRev] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState("");
  const [newAssignable, setNewAssignable] = useState("");
  const [copyOpen, setCopyOpen] = useState(false);

  const days = useMemo(() => weekDates(weekStart), [weekStart]);

  const loadWeek = useCallback(async () => {
    const res = await api<Entry[]>(`/api/resources/me/time-entries?from=${weekStart}&to=${addDays(weekStart, 6)}`);
    if (res.ok === false) setErr(res.error); else setEntries(Array.isArray(res.data) ? res.data : []);
  }, [weekStart]);

  useEffect(() => {
    api<Me>("/api/resources/me").then((r) => { if (r.ok === false) setErr(r.error); else setMe(r.data); });
    api<Options>("/api/resources/me/options").then((r) => { if (r.ok === false) setErr(r.error); else setOptions(r.data); });
  }, []);
  useEffect(() => { if (me?.resource) loadWeek(); }, [me, loadWeek]);
  useEffect(() => { setAdded([]); setSelected(new Set()); setMsg(null); }, [weekStart]);

  const lines: TimesheetLine[] = useMemo(() => buildLines(entries, added), [entries, added]);
  // A ticked line that has since split or moved status no longer exists under
  // its old key; drop it so a stale tick can never act on the wrong line.
  useEffect(() => {
    setSelected((cur) => {
      const live = new Set(lines.map((l) => l.key));
      const next = new Set(Array.from(cur).filter((k) => live.has(k)));
      return next.size === cur.size ? cur : next;
    });
  }, [lines]);

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
  const cellEntries = (l: TimesheetLine, date: string) => l.entries.filter((e) => e.date === date);
  const dayTotal = (date: string) => entries.filter((e) => e.date === date).reduce((s, e) => s + Number(e.hours), 0);
  const weekTotal = days.reduce((s, d) => s + dayTotal(d), 0);

  const selectedLines = lines.filter((l) => selected.has(l.key));
  const idsFor = (action: LineAction) => selectedLines.flatMap((l) => l.entries.filter((e) => actionAppliesTo(action, e.status)).map((e) => e.id));
  const emptySelected = selectedLines.filter((l) => l.status === "new");
  const counts = { submit: idsFor("submit").length, recall: idsFor("recall").length, delete: idsFor("delete").length };
  const allOn = lines.length > 0 && lines.every((l) => selected.has(l.key));

  function toggle(keys: string[], on: boolean) {
    setSelected((cur) => {
      const next = new Set(cur);
      for (const k of keys) if (on) next.add(k); else next.delete(k);
      return next;
    });
  }

  async function saveCell(l: TimesheetLine, date: string, raw: string) {
    setErr(null); setMsg(null);
    const existing = cellEntries(l, date);
    if (existing.length > 1) return;
    const text = raw.trim();
    // The field is a calculator: "4+4" arrives here as text (CalcInput's own
    // evaluation is still a queued state update), so evaluate it the same way.
    const value = text === "" ? 0 : Number.isFinite(Number(text)) ? Number(text) : evalArithmetic(text) ?? NaN;
    if (!Number.isFinite(value) || value < 0) { setErr("Hours must be a number."); return; }
    const entry = existing[0];
    if (entry && !lineIsEditable(l)) return;
    if (!entry && !lineAcceptsNewHours(l)) return;
    if (entry && Number(entry.hours) === value) return;
    if (!entry && value === 0) return;
    setBusy(true);
    let res;
    if (entry && value === 0) res = await api(`/api/resources/me/time-entries/${entry.id}`, { method: "DELETE" });
    else if (entry) res = await api(`/api/resources/me/time-entries/${entry.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ hours: value }) });
    else res = await api("/api/resources/me/time-entries", postJson({ date, hours: value, timesheetTypeId: l.typeId, assignableType: l.aType, assignableId: l.aId }));
    if (res.ok === false) { setErr(res.error); setRev((x) => x + 1); }
    await loadWeek();
    setBusy(false);
  }

  async function act(action: LineAction) {
    setErr(null); setMsg(null);
    const ids = idsFor(action);
    // Deleting a line that has no hours yet only removes it from the screen.
    if (action === "delete" && emptySelected.length) {
      const drop = new Set(emptySelected.map((l) => l.bookingKey));
      setAdded((x) => x.filter((b) => !drop.has(bookingKey(b))));
    }
    if (ids.length === 0) { setSelected(new Set()); return; }
    if (action === "delete" && !window.confirm(`Delete ${ids.length} ${ids.length === 1 ? "entry" : "entries"}? This cannot be undone.`)) return;
    setBusy(true);
    const res = await api<{ message: string }>("/api/resources/me/timesheet-lines", postJson({ action, ids }));
    if (res.ok === false) setErr(res.error); else setMsg(res.data.message);
    setSelected(new Set());
    await loadWeek();
    setBusy(false);
  }

  const chosenType = options.types.find((t) => t.id === newType);
  const assignableChoices = ASSIGNABLE_TYPES.flatMap((t) => options.assignables[t].map((a) => ({ ...a, t })));
  const canAdd = !!chosenType && (!chosenType.requiresAssignable || !!newAssignable);

  function addLine() {
    if (!chosenType) return;
    const picked = chosenType.requiresAssignable ? assignableChoices.find((a) => `${a.t}:${a.id}` === newAssignable) : null;
    const b: Booking = { typeId: chosenType.id, aType: picked?.t ?? null, aId: picked?.id ?? null };
    if (lines.some((l) => l.bookingKey === bookingKey(b) && (l.status === "draft" || l.status === "new"))) {
      setMsg("That line is already on this week as a Draft. Type the hours there.");
    } else {
      setAdded((x) => [...x, b]);
    }
    setNewType(""); setNewAssignable(""); setAdding(false);
  }

  const thisWeek = weekStartOf(localToday());
  const btn = "h-8 px-3 rounded-md text-[12px] font-medium flex items-center gap-1.5 disabled:opacity-40";

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
        {busy && <Loader size={14} className="animate-spin text-stone-500" />}
        <button onClick={() => act("submit")} disabled={busy || counts.submit === 0} className={`${btn} bg-primary hover:bg-primary-hover text-white font-semibold`}
          title="Submit the ticked Draft and Rejected lines">
          <Send size={13} /> Submit{counts.submit ? ` (${counts.submit})` : ""}
        </button>
        <button onClick={() => act("recall")} disabled={busy || counts.recall === 0} className={`${btn} ring-1 ring-stone-700 bg-stone-800 text-stone-300 hover:text-stone-100`}
          title="Bring ticked Submitted lines back to Draft (before anyone decides them)">
          <Undo2 size={13} /> Recall{counts.recall ? ` (${counts.recall})` : ""}
        </button>
        <button onClick={() => act("delete")} disabled={busy || (counts.delete === 0 && emptySelected.length === 0)} className={`${btn} ring-1 ring-stone-700 bg-stone-800 text-stone-300 hover:text-rose-300`}
          title="Delete the ticked Draft and Rejected lines">
          <Trash2 size={13} /> Delete{counts.delete ? ` (${counts.delete})` : ""}
        </button>
        <button onClick={() => setAdding(true)} className={`${btn} ring-1 ring-stone-700 bg-stone-800 text-stone-300 hover:text-stone-100`}>
          <Plus size={13} /> Add line
        </button>
        <button onClick={() => setCopyOpen(true)} className={`${btn} ring-1 ring-stone-700 bg-stone-800 text-stone-300 hover:text-stone-100`}>
          <Copy size={13} /> Copy week
        </button>
      </div>
      {(err || msg) && (
        <div className={`text-[12px] ${err ? "text-rose-400" : "text-stone-400"}`}>{err ?? msg}</div>
      )}

      <div className="overflow-x-auto rounded-lg border border-stone-800">
        <table className="w-full text-[13px] min-w-[980px]">
          <thead>
            <tr className={`text-left ${tableHead}`}>
              <th className="pl-3 py-2.5 w-8">
                <input type="checkbox" className={listCheckbox} checked={allOn} disabled={lines.length === 0}
                  onChange={(e) => toggle(lines.map((l) => l.key), e.target.checked)} aria-label="Select all lines" />
              </th>
              <th className="px-3 py-2.5 font-medium">Type</th>
              <th className="px-3 py-2.5 font-medium">Project / order</th>
              <th className="px-2 py-2.5 font-medium w-[96px]">Status</th>
              {days.map((d, i) => (
                <th key={d} className="px-1 py-2.5 font-medium text-center w-[72px]">
                  <div>{DAY_NAMES[i]}</div>
                  <div className="normal-case tracking-normal text-stone-600">{formatDateShort(d)}</div>
                </th>
              ))}
              <th className="px-3 py-2.5 font-medium text-right w-[64px]">Total</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && !adding && (
              <tr><td colSpan={12} className="px-3 py-8 text-center text-stone-500">No time yet this week. Use Add line, or Copy week to bring last week's lines in.</td></tr>
            )}
            {lines.map((l) => {
              const reasons = Array.from(new Set(l.entries.map((e) => e.rejectedReason).filter((x): x is string => !!x)));
              const rowTotal = l.entries.reduce((s, e) => s + Number(e.hours), 0);
              const sub = assignableLabel(l.aType, l.aId);
              const split = lines.filter((x) => x.bookingKey === l.bookingKey).length > 1;
              return (
                <tr key={l.key} className={`border-b border-stone-800/60 align-top ${selected.has(l.key) ? "bg-stone-900/60" : ""}`}>
                  <td className="pl-3 py-2.5">
                    <input type="checkbox" className={listCheckbox} checked={selected.has(l.key)} onChange={(e) => toggle([l.key], e.target.checked)} aria-label={`Select ${typeName(l.typeId)} ${STATUS_LABEL[l.status] ?? l.status} line`} />
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-stone-100">{typeName(l.typeId)}</div>
                    {reasons.map((r) => <div key={r} className="text-[12px] text-rose-400 mt-0.5">Returned: {r}</div>)}
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-stone-300">{sub || <span className="text-stone-600">—</span>}</div>
                    {split && <div className="text-[11px] text-stone-500">split by status</div>}
                  </td>
                  <td className="px-2 py-2">
                    <span className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] ${STATUS_CLASS[l.status] ?? STATUS_CLASS.draft}`}>{STATUS_LABEL[l.status] ?? l.status}</span>
                  </td>
                  {days.map((d) => {
                    const ce = cellEntries(l, d);
                    const total = ce.reduce((s, e) => s + Number(e.hours), 0);
                    const editable = ce.length > 1 ? false : ce.length === 1 ? lineIsEditable(l) : lineAcceptsNewHours(l);
                    if (!editable) {
                      return (
                        <td key={d} className="px-1 py-2 text-center tabular-nums text-stone-400">{total ? hrs(total) : <span className="text-stone-600">·</span>}</td>
                      );
                    }
                    return (
                      <td key={`${d}-${rev}`} className="px-1 py-1.5">
                        <CalcInput
                          value={total ? hrs(total) : ""}
                          onChange={() => { /* committed on blur */ }}
                          onBlur={(e) => saveCell(l, d, e.currentTarget.value)}
                          // Enter saves too: blurring runs CalcInput's own commit and then saveCell.
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                          aria-label={`${typeName(l.typeId)} hours on ${d}`}
                          placeholder="0"
                          className={`${cell} text-center tabular-nums`}
                        />
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-right tabular-nums text-stone-300">{hrs(rowTotal)}</td>
                </tr>
              );
            })}
            {adding && (
              <tr className="border-b border-stone-800/60">
                <td />
                <td className="px-3 py-1.5">
                  <SelectField inset={false} className="!h-8 !text-[12px]" value={newType} onChange={(e) => { setNewType(e.target.value); setNewAssignable(""); }} aria-label="Timesheet type">
                    <option value="">Type...</option>
                    {options.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </SelectField>
                </td>
                <td className="px-3 py-1.5">
                  {chosenType?.requiresAssignable ? (
                    <SelectField inset={false} className="!h-8 !text-[12px]" value={newAssignable} onChange={(e) => setNewAssignable(e.target.value)} aria-label="Project or order">
                      <option value="">Project or order...</option>
                      {ASSIGNABLE_TYPES.map((t) => options.assignables[t].length > 0 && (
                        <optgroup key={t} label={ASSIGNABLE_LABEL[t]}>
                          {options.assignables[t].map((a) => <option key={a.id} value={`${t}:${a.id}`}>{a.label}</option>)}
                        </optgroup>
                      ))}
                    </SelectField>
                  ) : <span className="text-[12px] text-stone-600">{chosenType ? "No project needed" : ""}</span>}
                </td>
                <td colSpan={9} className="px-2 py-1.5">
                  <div className="flex items-center gap-2">
                    <button onClick={addLine} disabled={!canAdd} className={`${controlCompact} text-stone-200 hover:text-white disabled:opacity-50`}>Add</button>
                    <button onClick={() => { setAdding(false); setNewType(""); setNewAssignable(""); }} className="text-[12px] text-stone-500 hover:text-stone-300">Cancel</button>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="text-[12px]">
              <td />
              <td colSpan={3} className="px-3 py-2.5 text-stone-400">Total (capacity {hrs(capacity)} h/day)</td>
              {days.map((d) => {
                const t = dayTotal(d);
                const over = t > capacity;
                return (
                  <td key={d} className={`px-1 py-2.5 text-center tabular-nums ${over ? "text-rose-400 font-semibold" : "text-stone-300"}`} title={over ? "Over daily capacity" : undefined}>{hrs(t)}</td>
                );
              })}
              <td className="px-3 py-2.5 text-right tabular-nums text-stone-100 font-semibold">{hrs(weekTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-[12px] text-stone-500">
        Tick the lines you are ready to hand in and press Submit. If an approver approves part of a line and returns the rest, the line splits so each part shows its own status.
      </p>

      {copyOpen && (
        <CopyWeekDrawer weekStart={weekStart} typeName={typeName} assignableLabel={assignableLabel}
          onClose={() => setCopyOpen(false)}
          onCopied={async (m) => { setCopyOpen(false); setMsg(m); setErr(null); await loadWeek(); }} />
      )}
    </div>
  );
}

function CopyWeekDrawer({ weekStart, typeName, assignableLabel, onClose, onCopied }: {
  weekStart: string;
  typeName: (id: string) => string;
  assignableLabel: (t: string | null, id: string | null) => string;
  onClose: () => void;
  onCopied: (message: string) => void;
}) {
  const [back, setBack] = useState(1);
  const [rows, setRows] = useState<CopyRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setRows(null); setPicked(new Set()); setErr(null);
    api<{ rows: CopyRow[] }>(`/api/resources/me/copy-week?weekStart=${weekStart}&back=${back}`).then((r) => {
      if (r.ok === false) { setErr(r.error); setRows([]); return; }
      const list = Array.isArray(r.data.rows) ? r.data.rows : [];
      setRows(list);
      setPicked(new Set(list.map((x) => x.key)));
    });
  }, [weekStart, back]);

  async function copy() {
    setSaving(true); setErr(null);
    const res = await api<{ message: string }>("/api/resources/me/copy-week", postJson({ weekStart, back, rows: Array.from(picked) }));
    setSaving(false);
    if (res.ok === false) { setErr(res.error); return; }
    onCopied(res.data.message);
  }

  const from = addDays(weekStart, -7 * back);
  return (
    <Drawer title="Copy week" subtitle="Bring an earlier week's lines into this week as Drafts, same days and hours. Leave and returned lines are not copied." onClose={onClose} size="lg"
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={copy} saveLabel={`Copy ${picked.size} ${picked.size === 1 ? "line" : "lines"}`} saveDisabled={picked.size === 0} err={err} />}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-[12px] text-stone-400">Copy from</span>
        <div className="w-56">
          <SelectField className="!h-8 !text-[12px]" value={String(back)} onChange={(e) => setBack(Number(e.target.value))} aria-label="Week to copy from">
            {Array.from({ length: COPY_WEEKS_BACK }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>{n === 1 ? "Last week" : `${n} weeks back`} ({formatDateShort(addDays(weekStart, -7 * n))})</option>
            ))}
          </SelectField>
        </div>
      </div>
      {rows === null ? (
        <div className="text-[13px] text-stone-500">Loading...</div>
      ) : rows.length === 0 ? (
        <div className="text-[13px] text-stone-500">Nothing to copy from the week of {formatDateShort(from)}.</div>
      ) : (
        <table className="w-full text-[12px]">
          <thead>
            <tr className={`text-left ${tableHead}`}>
              <th className="pl-2 py-2 w-8">
                <input type="checkbox" className={listCheckbox} checked={picked.size === rows.length}
                  onChange={(e) => setPicked(e.target.checked ? new Set(rows.map((r) => r.key)) : new Set())} aria-label="Select all lines to copy" />
              </th>
              <th className="px-2 py-2 font-medium">Line</th>
              {DAY_NAMES.map((d) => <th key={d} className="px-1 py-2 font-medium text-center">{d}</th>)}
              <th className="px-2 py-2 font-medium text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-stone-800/60">
                <td className="pl-2 py-2">
                  <input type="checkbox" className={listCheckbox} checked={picked.has(r.key)}
                    onChange={(e) => setPicked((cur) => { const n = new Set(cur); if (e.target.checked) n.add(r.key); else n.delete(r.key); return n; })} aria-label="Copy this line" />
                </td>
                <td className="px-2 py-2">
                  <div className="text-stone-200">{typeName(r.typeId)}</div>
                  {assignableLabel(r.aType, r.aId) && <div className="text-stone-500">{assignableLabel(r.aType, r.aId)}</div>}
                </td>
                {r.days.map((h, i) => <td key={i} className="px-1 py-2 text-center tabular-nums text-stone-400">{h ? hrs(h) : ""}</td>)}
                <td className="px-2 py-2 text-right tabular-nums text-stone-200">{hrs(r.hours)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Drawer>
  );
}
