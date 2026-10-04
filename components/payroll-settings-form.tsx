"use client";

/**
 * Payroll posting cadence (lib/payroll/pay-periods.ts). Picking a frequency
 * reveals only the one anchor field that frequency actually needs — "weekly"
 * alone is ambiguous without a week-ending day.
 */

import { useEffect, useState } from "react";
import { Field, Section, SelectField, controlInset } from "@/components/form-kit";

const WEEKDAYS = [{ v: 1, l: "Monday" }, { v: 2, l: "Tuesday" }, { v: 3, l: "Wednesday" }, { v: 4, l: "Thursday" }, { v: 5, l: "Friday" }, { v: 6, l: "Saturday" }, { v: 7, l: "Sunday" }];

export function PayrollSettingsForm() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState(""); const [savedMsg, setSavedMsg] = useState("");
  const [form, setForm] = useState({
    payrollFrequency: "", payrollWeekEndDay: "5", payrollBiweeklyAnchor: "",
    payrollSemimonthlyCutoff: "15", payrollMonthCutoff: "",
  });

  useEffect(() => {
    fetch("/api/resources/payroll-settings").then(r => r.json()).then(d => {
      setForm({
        payrollFrequency: d?.payrollFrequency || "",
        payrollWeekEndDay: d?.payrollWeekEndDay != null ? String(d.payrollWeekEndDay) : "5",
        payrollBiweeklyAnchor: d?.payrollBiweeklyAnchor || "",
        payrollSemimonthlyCutoff: d?.payrollSemimonthlyCutoff != null ? String(d.payrollSemimonthlyCutoff) : "15",
        payrollMonthCutoff: d?.payrollMonthCutoff != null ? String(d.payrollMonthCutoff) : "",
      });
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  async function save() {
    setSaving(true); setErr(""); setSavedMsg("");
    const body: any = { payrollFrequency: form.payrollFrequency || null };
    if (form.payrollFrequency === "weekly" || form.payrollFrequency === "biweekly") body.payrollWeekEndDay = Number(form.payrollWeekEndDay);
    if (form.payrollFrequency === "biweekly") body.payrollBiweeklyAnchor = form.payrollBiweeklyAnchor;
    if (form.payrollFrequency === "semi_monthly") body.payrollSemimonthlyCutoff = Number(form.payrollSemimonthlyCutoff);
    if (form.payrollFrequency === "monthly" && form.payrollMonthCutoff) body.payrollMonthCutoff = Number(form.payrollMonthCutoff);

    const r = await fetch("/api/resources/payroll-settings", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    setSavedMsg("Saved.");
  }

  if (loading) return <p className="p-6 text-center text-[13px] text-stone-500">Loading…</p>;

  return (
    <div className="p-6 max-w-xl mx-auto">
      <h1 className="text-[18px] font-semibold text-stone-100 mb-1">Payroll Settings</h1>
      <p className="text-[13px] text-stone-500 mb-6">How often approved timesheets are posted. This only sets the DEFAULT range "Post timesheets" suggests — it can always be overridden for a one-off run.</p>

      <Section title="Posting cadence">
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Field label="Frequency" className="col-span-2">
            <SelectField inset value={form.payrollFrequency} onChange={e => setForm(f => ({ ...f, payrollFrequency: e.target.value }))}>
              <option value="">Not configured</option>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Biweekly (fortnightly)</option>
              <option value="semi_monthly">Semi-monthly</option>
              <option value="monthly">Monthly</option>
            </SelectField>
          </Field>

          {(form.payrollFrequency === "weekly" || form.payrollFrequency === "biweekly") && (
            <Field label="Weeks end on" className="col-span-2" hint="The payroll week-ending day — e.g. your payroll provider's cutoff.">
              <SelectField inset value={form.payrollWeekEndDay} onChange={e => setForm(f => ({ ...f, payrollWeekEndDay: e.target.value }))}>
                {WEEKDAYS.map(w => <option key={w.v} value={w.v}>{w.l}</option>)}
              </SelectField>
            </Field>
          )}
          {form.payrollFrequency === "biweekly" && (
            <Field label="A known fortnight-end date" className="col-span-2" hint="Any one real period-end date — fixes which alternating week starts a fortnight.">
              <input type="date" className={controlInset} value={form.payrollBiweeklyAnchor} onChange={e => setForm(f => ({ ...f, payrollBiweeklyAnchor: e.target.value }))} />
            </Field>
          )}
          {form.payrollFrequency === "semi_monthly" && (
            <Field label="First-half cutoff day" className="col-span-2" hint="Commonly the 15th — the second half always runs to month-end.">
              <input type="number" min={1} max={27} className={controlInset} value={form.payrollSemimonthlyCutoff} onChange={e => setForm(f => ({ ...f, payrollSemimonthlyCutoff: e.target.value }))} />
            </Field>
          )}
          {form.payrollFrequency === "monthly" && (
            <Field label="Cutoff day of month" className="col-span-2" hint="Leave blank for calendar month-end.">
              <input type="number" min={1} max={31} className={controlInset} value={form.payrollMonthCutoff} onChange={e => setForm(f => ({ ...f, payrollMonthCutoff: e.target.value }))} />
            </Field>
          )}
        </div>
      </Section>

      <div className="mt-6 flex items-center gap-3">
        <button onClick={save} disabled={saving} className="text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 hover:bg-emerald-700 disabled:opacity-50">{saving ? "Saving…" : "Save"}</button>
        {err && <span className="text-[12px] text-rose-400">{err}</span>}
        {savedMsg && <span className="text-[12px] text-emerald-400">{savedMsg}</span>}
      </div>
    </div>
  );
}
