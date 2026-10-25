"use client";

/**
 * "Make recurring" — QBO form-parity, Phase 6. Turns an already-saved
 * document into a template (POST /api/recurring-templates) that the daily
 * Inngest job (inngest/functions/recurring.ts) will auto-post on schedule.
 */

import { useState } from "react";
import Link from "next/link";
import { Repeat, Check, AlertTriangle } from "lucide-react";
import { Modal, Button } from "@/components/ui";
import { Field, control, controlSelect } from "@/components/form-kit";
import { localToday } from "@/lib/format";

type Props = {
  sourceEntryId: string;
  sourceType: string;
  docNumber: string | null;
  onClose: () => void;
};

export function MakeRecurringModal({ sourceEntryId, sourceType, docNumber, onClose }: Props) {
  const [templateName, setTemplateName] = useState(`${sourceType}${docNumber ? ` ${docNumber}` : ""} (recurring)`);
  const [frequency, setFrequency] = useState<"daily" | "weekly" | "monthly" | "yearly">("monthly");
  const [interval, setInterval_] = useState("1");
  const [startDate, setStartDate] = useState(localToday());
  const [endType, setEndType] = useState<"never" | "after" | "on">("never");
  const [endAfterCount, setEndAfterCount] = useState("12");
  const [endOnDate, setEndOnDate] = useState("");
  const [autoSend, setAutoSend] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);

  async function save() {
    if (!templateName.trim()) { setErr("Name this template."); return; }
    if (endType === "on" && !endOnDate) { setErr("Pick an end date."); return; }
    setSaving(true); setErr("");
    try {
      const res = await fetch("/api/recurring-templates", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourceEntryId, templateName: templateName.trim(),
          frequency, interval: Math.max(1, Number(interval) || 1), startDate,
          endType, endAfterCount: endType === "after" ? Math.max(1, Number(endAfterCount) || 1) : undefined,
          endOnDate: endType === "on" ? endOnDate : undefined,
          autoSend,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) { setErr(d.error || "Could not create the template."); return; }
      setDone(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Make recurring" size="md"
      footer={done ? <Button onClick={onClose}>Done</Button> : <>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button icon={Repeat} onClick={save} disabled={saving}>{saving ? "Saving…" : "Save template"}</Button>
      </>}>
      <div className="p-5 space-y-3">
        {done ? (
          <div className="text-[13px] text-emerald-400 space-y-2">
            <div className="inline-flex items-center gap-2"><Check size={14} /> Template saved — it will start generating on {startDate}.</div>
            <div><Link href="/accounting/recurring" className="text-emerald-300 underline">Manage recurring templates →</Link></div>
          </div>
        ) : (
          <>
            {err && (
              <div className="text-[12px] text-rose-400 bg-rose-950/40 border border-rose-900 rounded-lg px-3 py-2 inline-flex items-center gap-2">
                <AlertTriangle size={13} /> {err}
              </div>
            )}
            <Field label="Template name" required>
              <input className={control} value={templateName} onChange={e => setTemplateName(e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Repeats">
                <select className={controlSelect} value={frequency} onChange={e => setFrequency(e.target.value as any)}>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </Field>
              <Field label="Every" hint={`${frequency === "daily" ? "day(s)" : frequency === "weekly" ? "week(s)" : frequency === "monthly" ? "month(s)" : "year(s)"}`}>
                <input className={control} type="number" min={1} value={interval} onChange={e => setInterval_(e.target.value)} />
              </Field>
            </div>
            <Field label="Start date" required>
              <input className={control} type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </Field>
            <Field label="Ends">
              <select className={controlSelect} value={endType} onChange={e => setEndType(e.target.value as any)}>
                <option value="never">Never</option>
                <option value="after">After a number of occurrences</option>
                <option value="on">On a date</option>
              </select>
            </Field>
            {endType === "after" && (
              <Field label="Number of occurrences">
                <input className={control} type="number" min={1} value={endAfterCount} onChange={e => setEndAfterCount(e.target.value)} />
              </Field>
            )}
            {endType === "on" && (
              <Field label="End date">
                <input className={control} type="date" value={endOnDate} onChange={e => setEndOnDate(e.target.value)} />
              </Field>
            )}
            <label className="flex items-center gap-2 text-[13px] text-stone-300 pt-1">
              <input type="checkbox" checked={autoSend} onChange={e => setAutoSend(e.target.checked)} className="accent-emerald-600" />
              Email it to the customer/supplier automatically each time
            </label>
          </>
        )}
      </div>
    </Modal>
  );
}
