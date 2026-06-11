"use client";

import { useState, useEffect, useCallback } from "react";
import { AlertTriangle, ChevronDown, Loader, X, CheckCircle2 } from "lucide-react";
import { Card, Badge, Button, Modal, Toast } from "@/components/ui";
import { fmt } from "@/lib/format";

const STATUS_BADGE: Record<string, string> = {
  pending:  "yellow",
  approved: "green",
  rejected: "neutral",
  cancelled: "red",
};

const DECISION_OPTIONS = [
  { value: "immediate",   label: "Cancel immediately",           warning: true },
  { value: "period_end",  label: "Cancel at end of billing period" },
  { value: "30_days",     label: "Cancel in 30 days" },
  { value: "60_days",     label: "Cancel in 60 days" },
  { value: "90_days",     label: "Cancel in 90 days" },
  { value: "rejected",    label: "Reject — keep subscription active" },
];

function fmtPlan(amount: number | null, currency: string | null) {
  if (!amount || !currency) return "—";
  return fmt.money(amount / 100, currency.toUpperCase());
}

function DecideModal({ request, onClose, onDecide }: any) {
  const [decision, setDecision]   = useState("");
  const [notes, setNotes]         = useState("");
  const [confirm, setConfirm]     = useState(false);
  const [loading, setLoading]     = useState(false);

  if (!request) return null;

  const handleDecide = async () => {
    if (!decision) return;
    if (decision === "immediate" && !confirm) { setConfirm(true); return; }
    setLoading(true);
    await onDecide(request.id, decision, notes);
    setLoading(false);
  };

  return (
    <Modal
      open={!!request}
      onClose={onClose}
      title="Review Cancellation Request"
      size="md"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant={decision === "rejected" ? "secondary" : decision === "immediate" ? "danger" : "primary"}
            onClick={handleDecide}
            disabled={!decision || loading}
          >
            {loading ? <Loader size={14} className="animate-spin mr-1" /> : null}
            {confirm ? "Confirm immediate cancellation" : "Apply decision"}
          </Button>
        </>
      }
    >
      <div className="px-5 py-4 space-y-4">
        {/* Request info */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <p className="text-[11px] text-stone-500 mb-0.5">Organisation</p>
            <p className="text-white font-medium">{request.orgName ?? "—"}</p>
          </div>
          <div>
            <p className="text-[11px] text-stone-500 mb-0.5">Requested by</p>
            <p className="text-white">{request.requestedByEmail ?? "—"}</p>
          </div>
          <div>
            <p className="text-[11px] text-stone-500 mb-0.5">Plan</p>
            <p className="text-white">{request.planName ?? "—"} {fmtPlan(request.planAmount, request.planCurrency)}/{request.planInterval ?? "mo"}</p>
          </div>
          <div>
            <p className="text-[11px] text-stone-500 mb-0.5">Period ends</p>
            <p className="text-white">
              {request.currentPeriodEnd
                ? new Date(request.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                : "—"}
            </p>
          </div>
        </div>

        {request.reason && (
          <div className="p-3 bg-stone-800/60 rounded-lg">
            <p className="text-[11px] text-stone-500 mb-1">Customer reason</p>
            <p className="text-sm text-stone-300">{request.reason}</p>
          </div>
        )}

        {/* Decision selector */}
        <div>
          <p className="text-xs text-stone-400 mb-2 font-medium">Admin decision</p>
          <div className="space-y-1.5">
            {DECISION_OPTIONS.map(opt => (
              <label key={opt.value}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors ${
                  decision === opt.value
                    ? opt.value === "immediate" ? "border-rose-500/50 bg-rose-500/10" : "border-emerald-500/50 bg-emerald-500/10"
                    : "border-stone-700 hover:border-stone-600 bg-stone-800/40"
                }`}
              >
                <input
                  type="radio"
                  name="decision"
                  value={opt.value}
                  checked={decision === opt.value}
                  onChange={() => { setDecision(opt.value); setConfirm(false); }}
                  className="accent-emerald-500"
                />
                <span className={`text-sm ${opt.warning ? "text-rose-300" : "text-stone-200"}`}>{opt.label}</span>
              </label>
            ))}
          </div>
        </div>

        {confirm && decision === "immediate" && (
          <div className="flex items-start gap-2 p-3 bg-rose-500/10 border border-rose-500/25 rounded-lg">
            <AlertTriangle size={14} className="text-rose-400 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-rose-300">
              This will immediately cancel the Stripe subscription. The customer will lose access based on their Stripe plan settings.
              Click "Confirm immediate cancellation" to proceed.
            </p>
          </div>
        )}

        <div>
          <label className="text-xs text-stone-400 mb-1.5 block">Internal notes <span className="text-stone-600">(optional)</span></label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            maxLength={2000}
            placeholder="Internal notes visible only to admins…"
            className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 resize-none focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>
    </Modal>
  );
}

export default function CancellationsPage() {
  const [cancellations, setCancellations] = useState<any[]>([]);
  const [loading, setLoading]             = useState(true);
  const [active, setActive]               = useState<any>(null);
  const [toast, setToast]                 = useState<any>(null);
  const [filter, setFilter]               = useState("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/cancellations");
      if (r.ok) {
        const d = await r.json();
        setCancellations(d.cancellations ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDecide = async (id: string, decision: string, internalNotes: string) => {
    const r = await fetch(`/api/admin/cancellations/${id}/decide`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, internalNotes }),
    });
    if (r.ok) {
      setToast({ type: "success", message: "Decision applied successfully" });
      setActive(null);
      load();
    } else {
      const d = await r.json().catch(() => ({}));
      setToast({ type: "error", message: d.error ?? "Failed to apply decision" });
    }
  };

  const visible = filter === "all" ? cancellations : cancellations.filter(c => c.status === filter);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Cancellation Requests</h1>
          <p className="text-xs text-stone-500 mt-0.5">Review and action customer cancellation requests</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="h-8 px-2.5 text-xs rounded-md border border-stone-700 bg-stone-800 text-stone-200 focus:outline-none"
          >
            <option value="all">All statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <Button variant="secondary" size="sm" onClick={load} disabled={loading}>
            {loading ? <Loader size={12} className="animate-spin" /> : "Refresh"}
          </Button>
        </div>
      </div>

      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-3">
            {[1,2,3].map(i => <div key={i} className="h-14 bg-stone-800 rounded animate-pulse" />)}
          </div>
        ) : !visible.length ? (
          <div className="py-16 text-center">
            <CheckCircle2 size={28} className="text-stone-600 mx-auto mb-3" />
            <p className="text-sm text-stone-500">{filter === "pending" ? "No pending requests" : "No cancellation requests"}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800">
                {["Organisation", "Requested by", "Plan", "Period ends", "Status", "Requested", "Action"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] text-stone-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((c: any) => (
                <tr key={c.id} className="border-b border-stone-800/50 hover:bg-stone-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{c.orgName ?? "—"}</p>
                    <p className="text-[11px] text-stone-500 font-mono">{c.stripeCustomerId?.slice(0, 14) ?? "—"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-stone-300 text-xs truncate max-w-[140px]">{c.requestedByEmail ?? "—"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-stone-300 text-xs">{c.planName ?? "—"}</p>
                    <p className="text-[11px] text-stone-500">{fmtPlan(c.planAmount, c.planCurrency)}/{c.planInterval ?? "mo"}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-400">
                    {c.currentPeriodEnd
                      ? new Date(c.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_BADGE[c.status] as any}>{c.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-500">
                    {new Date(c.requestedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-4 py-3">
                    {c.status === "pending" ? (
                      <Button variant="primary" size="sm" onClick={() => setActive(c)}>Review</Button>
                    ) : (
                      <button onClick={() => setActive(c)} className="text-xs text-stone-500 hover:text-stone-300 transition-colors">
                        View
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {active && (
        <DecideModal
          request={active}
          onClose={() => setActive(null)}
          onDecide={handleDecide}
        />
      )}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

