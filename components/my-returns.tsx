"use client";

/**
 * Time your approver sent back, and your reply.
 *
 * Shown above the weekly grid, because a reason buried in a cell's tooltip is
 * a reason nobody reads. Open returns (not yet acknowledged) are listed first
 * and marked; once acknowledged they stay visible but quiet, so the thread is
 * still there when the person comes back to fix the week.
 *
 * Standalone (no data-provider) so it runs in the employee portal too.
 */

import { useCallback, useEffect, useState } from "react";
import { Undo2, Loader } from "lucide-react";
import { controlMultiline } from "@/components/form-kit";
import { formatDateShort } from "@/lib/format";

interface ReturnRow {
  id: string; timeEntryId: string; reason: string;
  acknowledgedAt: string | null; response: string | null; respondedAt: string | null; createdAt: string;
  date: string; hours: number; entryStatus: string; returnedByName: string | null;
}

const hrs = (n: number) => String(Math.round(n * 100) / 100);

export function MyReturns({ onChanged }: { onChanged?: () => void }) {
  const [rows, setRows] = useState<ReturnRow[] | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/resources/me/returns");
      const body = await r.json().catch(() => null);
      setRows(Array.isArray(body) ? body : []);
    } catch { setRows([]); }
  }, []);
  useEffect(() => { load(); }, [load]);

  async function send(id: string, response: string | null) {
    setBusy(id); setMsg(null);
    try {
      const r = await fetch(`/api/resources/me/returns/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(response === null ? {} : { response }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(body?.error || "Could not save"); return; }
      setDraft((d) => { const n = { ...d }; delete n[id]; return n; });
      await load();
      onChanged?.();
    } catch { setMsg("Network problem. Try again."); }
    finally { setBusy(null); }
  }

  if (!rows || rows.length === 0) return null;

  // Unacknowledged first: those are the ones still asking for something.
  const sorted = [...rows].sort((a, b) =>
    Number(!!a.acknowledgedAt) - Number(!!b.acknowledgedAt) || b.createdAt.localeCompare(a.createdAt));
  const open = sorted.filter((r) => !r.acknowledgedAt).length;

  return (
    <div className="rounded-lg border border-stone-800">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-stone-800 bg-stone-950">
        <Undo2 size={14} className={open > 0 ? "text-amber-400" : "text-stone-500"} />
        <span className="text-[13px] font-semibold text-stone-100">Time sent back to you</span>
        {open > 0 && <span className="text-[12px] text-amber-400">{open} to read</span>}
        <div className="flex-1" />
        {msg && <span className="text-[12px] text-rose-400">{msg}</span>}
      </div>
      <ul className="divide-y divide-stone-800/60">
        {sorted.map((r) => (
          <li key={r.id} className={r.acknowledgedAt ? "px-3 py-2.5" : "px-3 py-2.5 bg-amber-500/5"}>
            <div className="text-[13px]">
              <span className="text-stone-300">{formatDateShort(r.date)}</span>
              <span className="text-stone-500"> · {hrs(r.hours)} h</span>
              {r.returnedByName && <span className="text-stone-500"> · sent back by {r.returnedByName}</span>}
            </div>
            <div className="text-[13px] text-stone-200 mt-0.5">{r.reason}</div>

            {r.response ? (
              <div className="text-[12px] text-stone-500 mt-1">
                You replied: <span className="text-stone-300">{r.response}</span>
              </div>
            ) : (
              <div className="mt-2 flex flex-col gap-2">
                <textarea
                  value={draft[r.id] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [r.id]: e.target.value }))}
                  rows={2}
                  className={controlMultiline}
                  placeholder="Reply to your approver (optional)"
                />
                <div className="flex items-center gap-2">
                  {busy === r.id && <Loader size={13} className="animate-spin text-stone-500" />}
                  <div className="flex-1" />
                  {!r.acknowledgedAt && (
                    <button
                      disabled={busy === r.id}
                      onClick={() => send(r.id, null)}
                      className="h-8 px-3 rounded-md ring-1 ring-stone-700 bg-stone-800 text-[12px] text-stone-300 hover:text-stone-100 disabled:opacity-50"
                    >
                      Mark as read
                    </button>
                  )}
                  <button
                    disabled={busy === r.id || !(draft[r.id] ?? "").trim()}
                    onClick={() => send(r.id, (draft[r.id] ?? "").trim())}
                    className="h-8 px-3 rounded-md bg-stone-200 hover:bg-white text-stone-900 text-[12px] font-semibold disabled:opacity-50"
                  >
                    Send reply
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
