"use client";

/**
 * Hours over plan: a month's logged hours set against what was planned, with
 * a place to explain and a place to accept the explanation.
 *
 * Answering and closing are separate actions because they are separate facts —
 * "explained" is not "accepted". Colour marks the exception only: an escalated
 * enquiry (unanswered too long) reads amber, everything else stays quiet.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader } from "lucide-react";
import { ListPage, ListPageHeader } from "@/components/list-view";
import { SelectField, controlMultiline } from "@/components/form-kit";
import { formatDateShort } from "@/lib/format";

interface Enquiry {
  id: string; resourceId: string; personName: string;
  assignableType: string; assignableId: string; bookingName: string | null;
  month: string; kind: "over_plan" | "unplanned";
  plannedHours: number; actualHours: number;
  status: string; response: string | null; respondedAt: string | null;
  escalatedAt: string | null; createdAt: string; canAnswer: boolean;
}

const hrs = (n: number) => String(Math.round(n * 100) / 100);

/** "2026-10" -> "Oct 2026", built from parts so it never depends on a locale or a Date. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthLabel(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${MONTHS[m - 1] ?? month} ${y}`;
}

export function HoursVariancePanel() {
  const [status, setStatus] = useState("open");
  const [rows, setRows] = useState<Enquiry[] | null>(null);
  const [scope, setScope] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    setMsg(null);
    try {
      const r = await fetch(`/api/resources/enquiries?status=${status}`);
      const body = await r.json().catch(() => null);
      if (!r.ok) { setMsg(body?.error || "Could not load enquiries"); setRows([]); return; }
      setRows(Array.isArray(body?.rows) ? body.rows : []);
      setScope(typeof body?.scope === "string" ? body.scope : null);
    } catch { setMsg("Network problem. Try again."); setRows([]); }
  }, [status]);
  useEffect(() => { load(); }, [load]);

  async function send(id: string, payload: { response?: string; close?: boolean }) {
    setBusy(id); setMsg(null);
    try {
      const r = await fetch(`/api/resources/enquiries/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(body?.error || "Could not save"); return; }
      setDraft((d) => { const n = { ...d }; delete n[id]; return n; });
      await load();
    } catch { setMsg("Network problem. Try again."); }
    finally { setBusy(null); }
  }

  return (
    <ListPage>
      <ListPageHeader
        title="Hours over plan"
        subtitle="Months where logged hours ran past the plan, or went somewhere with no plan at all."
      >
        <SelectField value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 text-[12px] w-[140px]" aria-label="Status">
          <option value="open">Open</option>
          <option value="answered">Answered</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </SelectField>
      </ListPageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">
        {msg && <div className="text-[13px] text-rose-400">{msg}</div>}
        {/* Say who this page covers, so a narrowed view never reads as the
            whole organisation. */}
        {scope && <p className="text-[12px] text-stone-500">Showing {scope}.</p>}
        {rows === null && <p className="text-[13px] text-stone-500">Loading…</p>}

        {rows && rows.length === 0 && (
          <div className="rounded-lg border border-stone-800 bg-stone-900 p-8 text-center text-[13px] text-stone-500">
            Nothing here. Enquiries are opened once a month has ended and its time is settled.
          </div>
        )}

        {rows?.map((e) => (
          <div key={e.id} className={e.escalatedAt && e.status === "open" ? "rounded-lg border border-amber-500/40" : "rounded-lg border border-stone-800"}>
            <div className="flex items-start gap-3 px-3 py-2.5 border-b border-stone-800/60 bg-stone-950">
              <div className="min-w-0 flex-1">
                <div className="text-[13px]">
                  <span className="font-semibold text-stone-100">{e.personName}</span>
                  <span className="text-stone-500"> · {monthLabel(e.month)}</span>
                  {e.escalatedAt && e.status === "open" && <span className="text-amber-400"> · unanswered since {formatDateShort(e.createdAt.slice(0, 10), { year: true })}</span>}
                </div>
                <div className="text-[12px] text-stone-500">
                  {e.bookingName ?? (e.assignableType === "project" ? "Removed project" : e.assignableType.replace(/_/g, " "))}
                </div>
              </div>
              <div className="text-right text-[12px]">
                {e.kind === "unplanned" ? (
                  <div className="text-stone-300">{hrs(e.actualHours)} h with no plan</div>
                ) : (
                  <div className="text-stone-300">
                    {hrs(e.actualHours)} h against {hrs(e.plannedHours)} h planned
                    <span className="text-amber-400"> · {hrs(e.actualHours - e.plannedHours)} h over</span>
                  </div>
                )}
                <div className="text-stone-600">{e.status}</div>
              </div>
            </div>

            <div className="px-3 py-2.5 flex flex-col gap-2">
              {e.response && (
                <div className="text-[13px]">
                  <span className="text-stone-500">Explanation: </span>
                  <span className="text-stone-200">{e.response}</span>
                </div>
              )}

              {e.canAnswer && e.status !== "closed" && (
                <>
                  {!e.response && (
                    <textarea
                      value={draft[e.id] ?? ""} rows={2} className={controlMultiline}
                      placeholder="Why did this month run over?"
                      onChange={(ev) => setDraft((d) => ({ ...d, [e.id]: ev.target.value }))}
                    />
                  )}
                  <div className="flex items-center gap-2">
                    {busy === e.id && <Loader size={13} className="animate-spin text-stone-500" />}
                    <div className="flex-1" />
                    <button
                      disabled={busy === e.id}
                      onClick={() => send(e.id, { close: true })}
                      className="h-8 px-3 rounded-md ring-1 ring-stone-700 bg-stone-800 text-[12px] text-stone-300 hover:text-stone-100 disabled:opacity-50"
                    >
                      Close
                    </button>
                    {!e.response && (
                      <button
                        disabled={busy === e.id || !(draft[e.id] ?? "").trim()}
                        onClick={() => send(e.id, { response: (draft[e.id] ?? "").trim() })}
                        className="h-8 px-3 rounded-md bg-stone-200 hover:bg-white text-stone-900 text-[12px] font-semibold disabled:opacity-50"
                      >
                        Send explanation
                      </button>
                    )}
                  </div>
                </>
              )}

              {!e.canAnswer && e.status === "open" && (
                <p className="text-[12px] text-stone-600">Waiting on whoever this was assigned to.</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </ListPage>
  );
}
