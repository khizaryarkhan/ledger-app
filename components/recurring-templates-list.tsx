"use client";

/**
 * Recurring templates — QBO form-parity, Phase 6 "Make Recurring" management
 * screen. Templates themselves are created from an existing document (the
 * "Make recurring" button on its own view screen, components/make-
 * recurring-modal.tsx) — this screen is for seeing what's scheduled and
 * pausing/resuming/deleting it, not for creating one from scratch.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Repeat, Pause, Play, Trash2, ExternalLink } from "lucide-react";
import { ListPage, ListPageHeader } from "@/components/list-view";
import { Toast } from "@/components/ui";
import { tableHead } from "@/components/form-kit";

type Template = {
  id: string; sourceType: string; templateName: string;
  frequency: string; interval: number; startDate: string;
  endType: string; endAfterCount: number | null; endOnDate: string | null;
  occurrencesCreated: number; nextRunDate: string;
  active: boolean; autoSend: boolean;
  lastRunAt: string | null; lastRunEntryId: string | null;
};

const FREQ_LABEL: Record<string, string> = { daily: "day", weekly: "week", monthly: "month", yearly: "year" };

function scheduleText(t: Template): string {
  const unit = FREQ_LABEL[t.frequency] ?? t.frequency;
  const every = t.interval > 1 ? `Every ${t.interval} ${unit}s` : `Every ${unit}`;
  const end = t.endType === "after" ? `, ${t.occurrencesCreated}/${t.endAfterCount} made`
    : t.endType === "on" ? `, until ${t.endOnDate}` : "";
  return `${every}${end}`;
}

export function RecurringTemplatesList() {
  const [items, setItems] = useState<Template[] | null>(null);
  const [toast, setToast] = useState<any>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  function load() {
    fetch("/api/recurring-templates").then(r => r.json()).then(d => setItems(Array.isArray(d) ? d : [])).catch(() => setItems([]));
  }
  useEffect(() => { load(); }, []);

  async function toggleActive(t: Template) {
    setBusyId(t.id);
    try {
      const r = await fetch(`/api/recurring-templates/${t.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !t.active }),
      });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setToast({ type: "error", message: d.error || "Could not update." }); return; }
      load();
    } finally { setBusyId(null); }
  }

  async function remove(t: Template) {
    if (!confirm(`Delete the recurring template "${t.templateName}"? This does not affect documents it already created.`)) return;
    setBusyId(t.id);
    try {
      const r = await fetch(`/api/recurring-templates/${t.id}`, { method: "DELETE" });
      if (!r.ok) { const d = await r.json().catch(() => ({})); setToast({ type: "error", message: d.error || "Could not delete." }); return; }
      setToast({ type: "success", message: "Template deleted." });
      load();
    } finally { setBusyId(null); }
  }

  return (
    <ListPage>
      <ListPageHeader title="Recurring templates" subtitle="Documents that auto-post on a schedule. Make one from any Invoice, Bill, Expense, Sales Receipt, Credit Note, Refund Receipt or Supplier Credit's own screen." />
      <div className="flex-1 overflow-y-auto px-6 py-4">
        <Toast toast={toast} onClose={() => setToast(null)} />
        {items === null ? (
          <div className="text-[13px] text-stone-500">Loading…</div>
        ) : items.length === 0 ? (
          <div className="text-[13px] text-stone-500 inline-flex items-center gap-2"><Repeat size={14} /> No recurring templates yet.</div>
        ) : (
          <div className="rounded-lg border border-stone-800 overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className={tableHead}>
                  <th className="text-left px-4 py-2">Template</th>
                  <th className="text-left px-4 py-2">Type</th>
                  <th className="text-left px-4 py-2">Schedule</th>
                  <th className="text-left px-4 py-2">Next run</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-right px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map(t => (
                  <tr key={t.id} className="border-b border-stone-800/50">
                    <td className="px-4 py-2 text-stone-200">
                      {t.templateName}
                      {t.lastRunEntryId && (
                        <Link href={`/accounting/transactions/${t.lastRunEntryId}`} className="ml-2 text-stone-500 hover:text-stone-300 inline-flex items-center" title="Last generated document">
                          <ExternalLink size={11} />
                        </Link>
                      )}
                    </td>
                    <td className="px-4 py-2 text-stone-400">{t.sourceType}</td>
                    <td className="px-4 py-2 text-stone-400">{scheduleText(t)}</td>
                    <td className="px-4 py-2 text-stone-300 tabular-nums">{t.active ? t.nextRunDate : "—"}</td>
                    <td className="px-4 py-2">
                      <span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${t.active ? "bg-emerald-500/12 text-emerald-400 border-emerald-800/50" : "bg-stone-800 text-stone-400 border-stone-700"}`}>
                        {t.active ? "Active" : "Paused"}
                      </span>
                      {t.autoSend && <span className="ml-1.5 text-[10px] text-stone-500">· auto-emails</span>}
                    </td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      <button onClick={() => toggleActive(t)} disabled={busyId === t.id}
                        className="p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-stone-200 disabled:opacity-50" title={t.active ? "Pause" : "Resume"}>
                        {t.active ? <Pause size={14} /> : <Play size={14} />}
                      </button>
                      <button onClick={() => remove(t)} disabled={busyId === t.id}
                        className="p-1 rounded hover:bg-stone-800 text-stone-500 hover:text-rose-400 disabled:opacity-50" title="Delete">
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ListPage>
  );
}
