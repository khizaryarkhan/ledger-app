"use client";

/**
 * Leave Balances — the admin screen to grant/adjust a resource's balance for
 * a balance-tracked leave type, and see the ledger that produced it. This is
 * the ONLY place hours are ever credited in; approving a leave time entry
 * only ever deducts (see time-entries/[id]/approve/route.ts).
 */

import { useEffect, useState } from "react";
import { Field, Section, SelectField, controlInset } from "@/components/form-kit";

const SOURCE_LABEL: Record<string, string> = { opening: "Opening balance", accrual: "Accrual", carry_forward: "Carry-forward", adjustment: "Adjustment", usage: "Usage (leave taken)" };

export function LeaveBalances() {
  const [resources, setResources] = useState<any[]>([]);
  const [types, setTypes] = useState<any[]>([]);
  const [resourceId, setResourceId] = useState("");
  const [timesheetTypeId, setTimesheetTypeId] = useState("");
  const [balance, setBalance] = useState<number | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [form, setForm] = useState({ hours: "", sourceType: "opening", date: "", note: "" });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/resources?status=active&type=person").then(r => r.json()).then(d => setResources(Array.isArray(d) ? d : [])).catch(() => {});
    fetch("/api/resources/timesheet-types?status=active").then(r => r.json()).then(d => setTypes((Array.isArray(d) ? d : []).filter((t: any) => t.category === "leave" && t.leavePolicy))).catch(() => {});
  }, []);

  async function load() {
    if (!resourceId || !timesheetTypeId) { setBalance(null); setEntries([]); return; }
    const d = await fetch(`/api/resources/leave-balance?resourceId=${resourceId}&timesheetTypeId=${timesheetTypeId}`).then(r => r.json()).catch(() => null);
    setBalance(d?.balance ?? null);
    setEntries(d?.entries ?? []);
  }
  useEffect(() => { load(); }, [resourceId, timesheetTypeId]);

  async function submit() {
    const h = Number(form.hours);
    if (!resourceId || !timesheetTypeId) { setErr("Choose a resource and a leave type."); return; }
    if (!Number.isFinite(h) || h === 0) { setErr("Enter a non-zero number of hours."); return; }
    setSaving(true); setErr("");
    const r = await fetch("/api/resources/leave-balance", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resourceId, timesheetTypeId, hours: h, sourceType: form.sourceType, date: form.date || undefined, note: form.note || undefined }),
    });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    setForm({ hours: "", sourceType: "opening", date: "", note: "" });
    load();
  }

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <h1 className="text-[18px] font-semibold text-stone-100 mb-1">Leave Balances</h1>
      <p className="text-[13px] text-stone-500 mb-6">Grant a resource's leave entitlement, or adjust it. Taking leave (an approved time entry) deducts automatically — nothing credits hours in except what you enter here.</p>

      <Section title="Resource & leave type">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Field label="Resource">
            <SelectField inset value={resourceId} onChange={e => setResourceId(e.target.value)}>
              <option value="">Choose…</option>
              {resources.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </SelectField>
          </Field>
          <Field label="Leave type" hint={types.length === 0 ? "No leave type has balance tracking turned on yet — enable it in Timesheet Types." : undefined}>
            <SelectField inset value={timesheetTypeId} onChange={e => setTimesheetTypeId(e.target.value)}>
              <option value="">Choose…</option>
              {types.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </SelectField>
          </Field>
        </div>
      </Section>

      {resourceId && timesheetTypeId && (
        <>
          <div className="mt-6 px-4 py-3 rounded-lg bg-stone-900 border border-stone-800 flex items-center justify-between">
            <span className="text-[13px] text-stone-400">Current balance</span>
            <span className="text-[18px] font-semibold text-stone-100">{balance ?? "—"} hours</span>
          </div>

          <Section title="Grant / adjust">
            <div className="grid grid-cols-2 gap-x-4 gap-y-4">
              <Field label="Hours" required hint="Positive to grant, negative to deduct">
                <input type="number" step="0.5" className={controlInset} value={form.hours} onChange={e => setForm(f => ({ ...f, hours: e.target.value }))} />
              </Field>
              <Field label="Type" required>
                <SelectField inset value={form.sourceType} onChange={e => setForm(f => ({ ...f, sourceType: e.target.value }))}>
                  <option value="opening">Opening balance</option>
                  <option value="accrual">Accrual</option>
                  <option value="carry_forward">Carry-forward</option>
                  <option value="adjustment">Adjustment</option>
                </SelectField>
              </Field>
              <Field label="Date" hint="Defaults to today">
                <input type="date" className={controlInset} value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </Field>
              <Field label="Note">
                <input className={controlInset} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} />
              </Field>
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button onClick={submit} disabled={saving} className="text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 hover:bg-emerald-700 disabled:opacity-50">{saving ? "Saving…" : "Add entry"}</button>
              {err && <span className="text-[12px] text-rose-400">{err}</span>}
            </div>
          </Section>

          <Section title="History">
            {entries.length === 0 ? <p className="text-[13px] text-stone-500">No entries yet.</p> : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-stone-500 border-b border-stone-800">
                    <th className="py-2 pr-2 font-medium">Date</th>
                    <th className="py-2 pr-2 font-medium">Type</th>
                    <th className="py-2 pr-2 font-medium text-right">Hours</th>
                    <th className="py-2 pr-2 font-medium">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e: any) => (
                    <tr key={e.id} className="border-b border-stone-900">
                      <td className="py-2 pr-2 text-stone-300">{e.date}</td>
                      <td className="py-2 pr-2 text-stone-400">{SOURCE_LABEL[e.sourceType] ?? e.sourceType}</td>
                      <td className={`py-2 pr-2 text-right ${Number(e.hours) < 0 ? "text-rose-400" : "text-emerald-400"}`}>{e.hours}</td>
                      <td className="py-2 pr-2 text-stone-500">{e.note ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
