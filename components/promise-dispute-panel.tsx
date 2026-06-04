"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge, Button } from "@/components/ui";
import { CalendarClock, AlertOctagon, Check, X, Loader } from "lucide-react";

type Promise_ = {
  id: string; promiseDate: string; amount: number | null; source: string;
  note: string | null; status: string; createdAt: string; enteredByName: string | null;
};
type Dispute = {
  id: string; category: string; reason: string | null; source: string; status: string;
  outcome: string | null; resolution: string | null; resolvedAt: string | null; createdAt: string; raisedByName: string | null;
};

const sourceBadge = (s: string) =>
  s === "Customer Portal" ? "blue" : s === "Accountant" ? "yellow" : "neutral";
const DISPUTE_OUTCOMES = ["Invoice corrected", "Credit issued", "Customer agreed to pay", "Written off"];

export function PromiseDisputePanel({ invoiceId, currency, onChange }: { invoiceId: string; currency: string; onChange?: () => void }) {
  const [promises, setPromises] = useState<Promise_[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);
  const [action, setAction] = useState<{ id: string; mode: "resolve" | "reject" } | null>(null);
  const [outcome, setOutcome] = useState(DISPUTE_OUTCOMES[0]);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/timeline`);
      if (res.ok) { const d = await res.json(); setPromises(d.promises || []); setDisputes(d.disputes || []); }
    } finally { setLoading(false); }
  }, [invoiceId]);

  useEffect(() => { load(); }, [load]);

  const money = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: currency || "EUR", maximumFractionDigits: 0 }).format(n);
  const openDispute = disputes.find(d => d.status === "Open" || d.status === "Under Review");

  async function patchDispute(id: string, body: any) {
    setResolving(id);
    try {
      await fetch(`/api/disputes/${id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      await load(); onChange?.();
    } finally { setResolving(null); }
  }
  function openAction(id: string, mode: "resolve" | "reject") { setAction({ id, mode }); setOutcome(DISPUTE_OUTCOMES[0]); setNote(""); }
  async function submitAction() {
    if (!action) return;
    const body = action.mode === "resolve"
      ? { status: "Resolved", outcome, resolution: note }
      : { status: "Rejected", outcome: "Rejected", resolution: note };
    await patchDispute(action.id, body);
    setAction(null);
  }

  if (loading) return null;
  if (promises.length === 0 && disputes.length === 0) return null;

  return (
    <Card className="col-span-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-stone-900">Promise &amp; Dispute history</h3>
        {openDispute && (
          <Badge variant="red">⚠ Automations paused — dispute open</Badge>
        )}
      </div>

      <div className="space-y-2">
        {/* Disputes first (most important) */}
        {disputes.map(d => {
          const isOpen = d.status === "Open" || d.status === "Under Review";
          const isActioning = action?.id === d.id;
          return (
            <div key={d.id} className={`p-3 rounded-lg ring-1 ${isOpen ? "bg-rose-50 ring-rose-200" : "bg-stone-50 ring-stone-200"}`}>
              <div className="flex items-start gap-3">
                <AlertOctagon size={16} className={isOpen ? "text-rose-500 mt-0.5 shrink-0" : "text-stone-400 mt-0.5 shrink-0"} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-stone-900">Dispute · {d.category}</span>
                    <Badge variant={sourceBadge(d.source)} size="sm">{d.source}</Badge>
                    <Badge variant={d.status === "Open" ? "red" : d.status === "Under Review" ? "yellow" : "green"} size="sm">{d.status}</Badge>
                    {d.outcome && <Badge variant="neutral" size="sm">{d.outcome}</Badge>}
                  </div>
                  {d.reason && <div className="text-[13px] text-stone-600 mt-1">{d.reason}</div>}
                  {d.resolution && <div className="text-[12px] text-stone-500 mt-1 italic">Resolution: {d.resolution}</div>}
                  <div className="text-[11px] text-stone-400 mt-1">
                    {d.raisedByName ? `by ${d.raisedByName}` : "via portal"} · {new Date(d.createdAt).toLocaleDateString()}
                  </div>
                </div>
                {isOpen && !isActioning && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {resolving === d.id ? <Loader size={14} className="animate-spin text-stone-400" /> : (
                      <>
                        {d.status === "Open" && (
                          <button onClick={() => patchDispute(d.id, { status: "Under Review" })}
                            className="px-2 py-1 rounded-md bg-amber-100 text-amber-700 hover:bg-amber-200 text-[11px] font-semibold">Acknowledge</button>
                        )}
                        <button onClick={() => openAction(d.id, "resolve")} className="px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 hover:bg-emerald-200 text-[11px] font-semibold flex items-center gap-1"><Check size={12} /> Resolve</button>
                        <button onClick={() => openAction(d.id, "reject")} className="px-2 py-1 rounded-md bg-stone-200 text-stone-600 hover:bg-stone-300 text-[11px] font-semibold flex items-center gap-1"><X size={12} /> Reject</button>
                      </>
                    )}
                  </div>
                )}
              </div>
              {isActioning && (
                <div className="mt-3 pt-3 border-t border-rose-200 space-y-2">
                  {action!.mode === "resolve" && (
                    <div>
                      <label className="text-[11px] font-medium text-stone-500">Outcome</label>
                      <select value={outcome} onChange={e => setOutcome(e.target.value)}
                        className="w-full mt-1 text-sm border border-stone-200 rounded-lg px-2.5 py-1.5 bg-white outline-none focus:ring-2 focus:ring-stone-300">
                        {DISPUTE_OUTCOMES.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    </div>
                  )}
                  <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
                    placeholder={action!.mode === "resolve" ? "Resolution note (optional)" : "Reason for rejecting (optional)"}
                    className="w-full text-sm border border-stone-200 rounded-lg px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-stone-300 resize-none" />
                  <div className="flex items-center justify-end gap-2">
                    <button onClick={() => setAction(null)} className="px-3 py-1.5 text-xs font-medium text-stone-600 hover:text-stone-900">Cancel</button>
                    <button onClick={submitAction} disabled={resolving === d.id}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md text-white disabled:opacity-50 ${action!.mode === "resolve" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-stone-700 hover:bg-stone-800"}`}>
                      {resolving === d.id ? "Saving…" : action!.mode === "resolve" ? "Confirm resolve" : "Confirm reject"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Promises */}
        {promises.map(p => (
          <div key={p.id} className={`flex items-start gap-3 p-3 rounded-lg ring-1 ${p.status === "Active" ? "bg-blue-50/50 ring-blue-100" : "bg-stone-50 ring-stone-200"}`}>
            <CalendarClock size={16} className="text-blue-500 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-stone-900">
                  Promised {p.amount != null ? money(p.amount) : "full balance"} by {p.promiseDate}
                </span>
                <Badge variant={sourceBadge(p.source)} size="sm">{p.source}</Badge>
                {p.status !== "Active" && <Badge variant={p.status === "Broken" ? "red" : "gray"} size="sm">{p.status}</Badge>}
              </div>
              {p.note && <div className="text-[13px] text-stone-600 mt-1">{p.note}</div>}
              <div className="text-[11px] text-stone-400 mt-1">
                {p.enteredByName ? `by ${p.enteredByName}` : "via portal"} · {new Date(p.createdAt).toLocaleDateString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
