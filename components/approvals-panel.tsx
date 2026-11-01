"use client";

/**
 * Approvals: submitted time entries the caller may decide, grouped by
 * person and week. Approve or reject a whole group, or tick entries and
 * bulk-approve. Rejection needs a reason (Drawer with a pinned footer).
 *
 * Standalone (no data-provider) so it runs in the employee portal too.
 * The server decides who may approve what; every id gets its own outcome.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, X as XIcon, Loader } from "lucide-react";
import { Drawer, DrawerFooter, Field, controlMultiline } from "@/components/form-kit";
import { listCheckbox as listCheckboxClass } from "@/components/list-view";
import { weekStartOf } from "@/lib/resources/time-entry-rules";
import { addDays } from "@/lib/accounting/report-periods";
import { formatDateShort } from "@/lib/format";

interface QueueRow {
  id: string; resourceId: string; personName: string; date: string; hours: number;
  typeName: string; assignableName: string | null; description: string | null;
}
interface Group { key: string; personName: string; weekStart: string; rows: QueueRow[]; total: number }
interface Outcome { id: string; ok: boolean; error?: string }

const hrs = (n: number) => String(Math.round(n * 100) / 100);

export function ApprovalsPanel() {
  const [rows, setRows] = useState<QueueRow[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<string[] | null>(null);
  const [reason, setReason] = useState("");
  const [rejectErr, setRejectErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/resources/me/approvals");
      const body = await r.json().catch(() => null);
      if (!r.ok) { setMsg(body?.error || "Could not load approvals"); setRows([]); return; }
      setRows(Array.isArray(body) ? body : []);
    } catch { setMsg("Network problem. Try again."); setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Group>();
    for (const r of rows ?? []) {
      const ws = weekStartOf(r.date);
      const key = `${r.resourceId}|${ws}`;
      const g = map.get(key) ?? { key, personName: r.personName, weekStart: ws, rows: [], total: 0 };
      g.rows.push(r); g.total += r.hours;
      map.set(key, g);
    }
    return Array.from(map.values()).sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.personName.localeCompare(b.personName));
  }, [rows]);

  async function decide(ids: string[], action: "approve" | "reject", why?: string): Promise<Outcome[] | null> {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/resources/me/approvals", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, action, reason: why }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(body?.error || "Could not save"); return null; }
      const results: Outcome[] = body.results ?? [];
      const failed = results.filter((x) => !x.ok);
      if (failed.length) setMsg(`${failed.length} of ${results.length} could not be ${action === "approve" ? "approved" : "rejected"}: ${failed[0].error}`);
      setSelected(new Set());
      await load();
      return results;
    } catch { setMsg("Network problem. Try again."); return null; }
    finally { setBusy(false); }
  }

  async function confirmReject() {
    if (!rejecting) return;
    if (!reason.trim()) { setRejectErr("A reason is required"); return; }
    const res = await decide(rejecting, "reject", reason.trim());
    if (res) { setRejecting(null); setReason(""); setRejectErr(null); }
  }

  const toggle = (ids: string[], on: boolean) =>
    setSelected((s) => { const n = new Set(s); for (const id of ids) { if (on) n.add(id); else n.delete(id); } return n; });

  if (rows === null) return <div className="p-6 text-[13px] text-stone-500">Loading...</div>;

  return (
    <div className="flex flex-col gap-4 px-6 py-4">
      <div className="flex items-center gap-2">
        <span className="text-[13px] text-stone-400">{rows.length} {rows.length === 1 ? "entry" : "entries"} waiting</span>
        <div className="flex-1" />
        {msg && <span className="text-[12px] text-rose-400">{msg}</span>}
        {busy && <Loader size={14} className="animate-spin text-stone-500" />}
        <button disabled={busy || selected.size === 0} onClick={() => decide(Array.from(selected), "approve")}
          className="h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-50">
          <Check size={13} /> Approve selected{selected.size ? ` (${selected.size})` : ""}
        </button>
      </div>

      {groups.length === 0 && (
        <div className="rounded-lg border border-stone-800 bg-stone-900 p-8 text-center text-[13px] text-stone-500">Nothing is waiting for your approval.</div>
      )}

      {groups.map((g) => {
        const ids = g.rows.map((r) => r.id);
        const allOn = ids.every((id) => selected.has(id));
        return (
          <div key={g.key} className="rounded-lg border border-stone-800">
            <div className="flex items-center gap-3 px-3 py-2.5 border-b border-stone-800 bg-stone-950">
              <input type="checkbox" className={listCheckboxClass} checked={allOn} onChange={(e) => toggle(ids, e.target.checked)} aria-label={`Select all for ${g.personName}`} />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold text-stone-100">{g.personName}</div>
                <div className="text-[12px] text-stone-500">Week of {formatDateShort(g.weekStart)} to {formatDateShort(addDays(g.weekStart, 6), { year: true })} · {hrs(g.total)} h</div>
              </div>
              <div className="flex-1" />
              <button disabled={busy} onClick={() => { setRejecting(ids); setReason(""); setRejectErr(null); }}
                className="h-8 px-3 rounded-md ring-1 ring-stone-700 bg-stone-800 text-[12px] text-stone-300 hover:text-stone-100 flex items-center gap-1.5 disabled:opacity-50">
                <XIcon size={13} /> Reject
              </button>
              <button disabled={busy} onClick={() => decide(ids, "approve")}
                className="h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-50">
                <Check size={13} /> Approve
              </button>
            </div>
            <table className="w-full text-[13px]">
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.id} className="border-b border-stone-800/60 last:border-0">
                    <td className="pl-3 py-2 w-8"><input type="checkbox" className={listCheckboxClass} checked={selected.has(r.id)} onChange={(e) => toggle([r.id], e.target.checked)} aria-label="Select entry" /></td>
                    <td className="px-2 py-2 whitespace-nowrap text-stone-300">{formatDateShort(r.date)}</td>
                    <td className="px-2 py-2 text-stone-100">{r.typeName}{r.assignableName && <span className="text-stone-500"> · {r.assignableName}</span>}</td>
                    <td className="px-2 py-2 text-stone-500">{r.description}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-200">{hrs(r.hours)} h</td>
                    <td className="pr-3 py-2 w-8">
                      <button disabled={busy} onClick={() => { setRejecting([r.id]); setReason(""); setRejectErr(null); }} aria-label="Reject entry" className="p-1.5 rounded-md text-stone-600 hover:text-stone-300"><XIcon size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}

      {rejecting && (
        <Drawer
          title="Reject time"
          subtitle={`${rejecting.length} ${rejecting.length === 1 ? "entry" : "entries"} go back to the person to correct and resubmit.`}
          onClose={() => setRejecting(null)}
          footer={<DrawerFooter saving={busy} onClose={() => setRejecting(null)} onSave={confirmReject} saveLabel="Reject" err={rejectErr} />}
        >
          <Field label="Reason" required>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} className={controlMultiline} placeholder="What needs to change?" />
          </Field>
        </Drawer>
      )}
    </div>
  );
}
