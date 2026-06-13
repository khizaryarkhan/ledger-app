"use client";

import { useState, useEffect, useCallback } from "react";
import { Clock, CheckCircle2, XCircle, Loader, Building2 } from "lucide-react";
import { Card, Badge, Button, Modal, Toast } from "@/components/ui";

const STATUS_BADGE: Record<string, string> = {
  pending:  "yellow",
  approved: "green",
  rejected: "neutral",
};

const DURATION_OPTIONS = [
  { value: 1,  label: "24 hours" },
  { value: 3,  label: "3 days"   },
  { value: 7,  label: "7 days"   },
  { value: 14, label: "14 days"  },
  { value: 30, label: "30 days"  },
];

function ReviewModal({ request, onClose, onDecide }: any) {
  const [action, setAction]   = useState<"approve" | "reject" | "">("");
  const [days, setDays]       = useState(7);
  const [notes, setNotes]     = useState("");
  const [loading, setLoading] = useState(false);

  if (!request) return null;

  const handleSubmit = async () => {
    if (!action) return;
    setLoading(true);
    await onDecide(request.id, action, days, notes);
    setLoading(false);
  };

  return (
    <Modal open={!!request} onClose={onClose} title="Review Temporary Access Request"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            variant={action === "approve" ? "primary" : action === "reject" ? "danger" : "secondary"}
            onClick={handleSubmit}
            disabled={!action || loading}
          >
            {loading && <Loader size={13} className="animate-spin mr-1" />}
            {action === "approve" ? "Approve access" : action === "reject" ? "Reject request" : "Select decision"}
          </Button>
        </>
      }
    >
      <div className="px-5 py-5 space-y-4">
        <div className="bg-stone-800/60 rounded-lg p-4 space-y-2">
          <div className="flex justify-between text-xs">
            <span className="text-stone-500">Organisation</span>
            <span className="text-white font-medium">{request.orgName ?? "—"}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-stone-500">Requested by</span>
            <span className="text-white">{request.requestedByEmail ?? "—"}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-stone-500">Requested at</span>
            <span className="text-white">
              {new Date(request.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
            </span>
          </div>
          {request.reason && (
            <div className="pt-2 border-t border-stone-700">
              <p className="text-xs text-stone-500 mb-1">Reason</p>
              <p className="text-xs text-stone-300 leading-relaxed">{request.reason}</p>
            </div>
          )}
        </div>

        <div>
          <p className="text-xs text-stone-400 mb-2">Decision</p>
          <div className="grid grid-cols-2 gap-2">
            {(["approve", "reject"] as const).map(a => (
              <button
                key={a}
                onClick={() => setAction(a)}
                className={`py-2.5 px-3 rounded-lg text-sm font-medium border transition-all ${
                  action === a
                    ? a === "approve"
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                      : "bg-rose-500/15 border-rose-500/40 text-rose-300"
                    : "border-stone-700 text-stone-400 hover:border-stone-600"
                }`}
              >
                {a === "approve" ? "Approve" : "Reject"}
              </button>
            ))}
          </div>
        </div>

        {action === "approve" && (
          <div>
            <p className="text-xs text-stone-400 mb-2">Access duration</p>
            <div className="flex flex-wrap gap-2">
              {DURATION_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDays(opt.value)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-all ${
                    days === opt.value
                      ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                      : "border-stone-700 text-stone-400 hover:border-stone-600"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="text-xs text-stone-400 block mb-1.5">
            Internal notes <span className="text-stone-600">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            className="w-full px-3 py-2 rounded-md border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-500 resize-none focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            placeholder="Optional note for audit trail…"
          />
        </div>
      </div>
    </Modal>
  );
}

export default function TempAccessPage() {
  const [requests, setRequests] = useState<any[]>([]);
  const [loading, setLoading]   = useState(true);
  const [reviewing, setReviewing] = useState<any>(null);
  const [toast, setToast]       = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/temp-access");
      if (r.ok) setRequests((await r.json()).requests ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleDecide = async (id: string, action: string, days: number, notes: string) => {
    const r = await fetch(`/api/admin/temp-access/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action, daysAccess: action === "approve" ? days : undefined, adminNotes: notes }),
    });
    if (r.ok) {
      setToast({ type: "success", message: action === "approve" ? "Access granted" : "Request rejected" });
      setReviewing(null);
      load();
    } else {
      setToast({ type: "error", message: "Failed to update request" });
    }
  };

  const pending  = requests.filter(r => r.status === "pending");
  const reviewed = requests.filter(r => r.status !== "pending");

  return (
    <div className="max-w-3xl space-y-5 py-1">
      <div>
        <h1 className="text-base font-semibold text-white">Temporary Access Requests</h1>
        <p className="text-xs text-stone-500 mt-0.5">Review and approve short-term access for organisations with cancelled subscriptions.</p>
      </div>

      {loading ? (
        <Card padding="md">
          <div className="space-y-3 animate-pulse">
            {[1,2].map(i => <div key={i} className="h-14 bg-stone-800 rounded" />)}
          </div>
        </Card>
      ) : (
        <>
          {/* Pending */}
          <div>
            <p className="text-xs text-stone-500 font-medium uppercase tracking-wider mb-2">
              Pending review ({pending.length})
            </p>
            {pending.length === 0 ? (
              <Card padding="md">
                <div className="flex items-center gap-3 py-4 justify-center">
                  <CheckCircle2 size={16} className="text-stone-600" />
                  <p className="text-sm text-stone-500">No pending requests</p>
                </div>
              </Card>
            ) : pending.map(req => (
              <Card key={req.id} padding="md" className="mb-2">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3">
                    <div className="w-8 h-8 rounded-lg bg-stone-800 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Building2 size={14} className="text-stone-400" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-white">{req.orgName ?? "Unknown org"}</p>
                        <Badge variant={STATUS_BADGE[req.status] as any}>{req.status}</Badge>
                      </div>
                      <p className="text-xs text-stone-400 mt-0.5">{req.requestedByEmail ?? "—"}</p>
                      {req.reason && (
                        <p className="text-xs text-stone-500 mt-1 max-w-sm truncate">"{req.reason}"</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <p className="text-xs text-stone-500">
                      {new Date(req.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </p>
                    <Button variant="primary" size="sm" onClick={() => setReviewing(req)}>
                      Review
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>

          {/* Reviewed */}
          {reviewed.length > 0 && (
            <div>
              <p className="text-xs text-stone-500 font-medium uppercase tracking-wider mb-2">
                Previously reviewed
              </p>
              <Card padding="md">
                <div className="divide-y divide-stone-800">
                  {reviewed.map(req => (
                    <div key={req.id} className="flex items-center justify-between py-3 gap-4 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-sm text-white truncate">{req.orgName ?? "—"}</p>
                          <Badge variant={STATUS_BADGE[req.status] as any}>{req.status}</Badge>
                        </div>
                        <p className="text-xs text-stone-500 mt-0.5">
                          {req.requestedByEmail ?? "—"}
                          {req.expiresAt && req.status === "approved" && (
                            <> · Access until {new Date(req.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</>
                          )}
                        </p>
                      </div>
                      <p className="text-xs text-stone-500 flex-shrink-0">
                        {req.reviewedAt
                          ? new Date(req.reviewedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
                          : "—"}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>
          )}
        </>
      )}

      <ReviewModal
        request={reviewing}
        onClose={() => setReviewing(null)}
        onDecide={handleDecide}
      />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
