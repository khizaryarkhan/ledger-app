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
  resolution: string | null; resolvedAt: string | null; createdAt: string; raisedByName: string | null;
};

const sourceBadge = (s: string) =>
  s === "Customer Portal" ? "blue" : s === "Accountant" ? "yellow" : "neutral";

export function PromiseDisputePanel({ invoiceId, currency, onChange }: { invoiceId: string; currency: string; onChange?: () => void }) {
  const [promises, setPromises] = useState<Promise_[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/invoices/${invoiceId}/timeline`);
      if (res.ok) { const d = await res.json(); setPromises(d.promises || []); setDisputes(d.disputes || []); }
    } finally { setLoading(false); }
  }, [invoiceId]);

  useEffect(() => { load(); }, [load]);

  const money = (n: number) => new Intl.NumberFormat("en-IE", { style: "currency", currency: currency || "EUR", maximumFractionDigits: 0 }).format(n);
  const openDispute = disputes.find(d => d.status === "Open" || d.status === "Under Review");

  async function resolveDispute(id: string, status: "Resolved" | "Rejected") {
    setResolving(id);
    try {
      const resolution = status === "Resolved" ? (prompt("Resolution note (optional):") ?? "") : (prompt("Reason for rejecting (optional):") ?? "");
      await fetch(`/api/disputes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolution }),
      });
      await load();
      onChange?.();
    } finally { setResolving(null); }
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
          return (
            <div key={d.id} className={`flex items-start gap-3 p-3 rounded-lg ring-1 ${isOpen ? "bg-rose-50 ring-rose-200" : "bg-stone-50 ring-stone-200"}`}>
              <AlertOctagon size={16} className={isOpen ? "text-rose-500 mt-0.5" : "text-stone-400 mt-0.5"} />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-stone-900">Dispute · {d.category}</span>
                  <Badge variant={sourceBadge(d.source)} size="sm">{d.source}</Badge>
                  <Badge variant={isOpen ? "red" : "green"} size="sm">{d.status}</Badge>
                </div>
                {d.reason && <div className="text-[13px] text-stone-600 mt-1">{d.reason}</div>}
                {d.resolution && <div className="text-[12px] text-stone-500 mt-1 italic">Resolution: {d.resolution}</div>}
                <div className="text-[11px] text-stone-400 mt-1">
                  {d.raisedByName ? `by ${d.raisedByName}` : "via portal"} · {new Date(d.createdAt).toLocaleDateString()}
                </div>
              </div>
              {isOpen && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {resolving === d.id ? <Loader size={14} className="animate-spin text-stone-400" /> : (
                    <>
                      <button onClick={() => resolveDispute(d.id, "Resolved")} title="Resolve"
                        className="p-1.5 rounded-md bg-emerald-100 text-emerald-700 hover:bg-emerald-200"><Check size={13} /></button>
                      <button onClick={() => resolveDispute(d.id, "Rejected")} title="Reject"
                        className="p-1.5 rounded-md bg-stone-200 text-stone-600 hover:bg-stone-300"><X size={13} /></button>
                    </>
                  )}
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
