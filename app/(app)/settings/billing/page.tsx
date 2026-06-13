"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  CreditCard, RefreshCw, AlertTriangle, CheckCircle2, Clock,
  XCircle, ExternalLink, ChevronRight, Loader, ShieldAlert, ArrowLeft,
} from "lucide-react";
import Link from "next/link";
import { Card, Badge, Button, Modal, Toast } from "@/components/ui";
import { fmt } from "@/lib/format";

// ── Helpers ───────────────────────────────────────────────────────────────

function statusBadge(status: string, cancelAtPeriodEnd: boolean) {
  if (cancelAtPeriodEnd || status === "cancelling") return <Badge variant="yellow">Cancelling</Badge>;
  switch (status) {
    case "active":     return <Badge variant="green">Active</Badge>;
    case "trialing":   return <Badge variant="blue">Trialing</Badge>;
    case "past_due":   return <Badge variant="red">Past due</Badge>;
    case "unpaid":     return <Badge variant="red">Unpaid</Badge>;
    case "cancelled":  return <Badge variant="neutral">Cancelled</Badge>;
    case "incomplete": return <Badge variant="yellow">Incomplete</Badge>;
    default:           return <Badge variant="neutral">{status}</Badge>;
  }
}

function paymentStatusBadge(status: string | null) {
  if (!status) return null;
  if (status === "paid")            return <Badge variant="green">Paid</Badge>;
  if (status === "failed")          return <Badge variant="red">Payment failed</Badge>;
  if (status === "action_required") return <Badge variant="yellow">Action required</Badge>;
  return null;
}

function planLabel(sub: any) {
  if (!sub) return "—";
  const name     = sub.planName ?? "Subscription";
  const amount   = sub.planAmount ? `${fmt.money(sub.planAmount / 100, sub.planCurrency?.toUpperCase() ?? "EUR")}` : "";
  const interval = sub.planInterval === "month" ? "/mo" : sub.planInterval === "year" ? "/yr" : "";
  return [name, amount ? `${amount}${interval}` : ""].filter(Boolean).join(" · ");
}

// ── CancelModal ───────────────────────────────────────────────────────────

function CancelModal({ open, onClose, onSubmit, loading }: any) {
  const [reason, setReason] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Cancel Subscription"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Keep my subscription</Button>
          <Button variant="danger" onClick={() => onSubmit(reason)} disabled={loading}>
            {loading ? <Loader size={14} className="animate-spin mr-2" /> : null}
            Submit cancellation request
          </Button>
        </>
      }>
      <div className="px-5 py-5 space-y-4">
        <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-lg">
          <AlertTriangle size={16} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-stone-300 leading-relaxed">
            Your cancellation request will be submitted for review. Your subscription will remain
            active while our team reviews the request. You will receive confirmation once a
            decision has been made.
          </p>
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1.5">
            Reason for cancelling <span className="text-stone-600">(optional)</span>
          </label>
          <textarea
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="Let us know why you're leaving…"
            rows={4}
            maxLength={1000}
            className="w-full px-3 py-2.5 rounded-md border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-500 resize-none focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>
    </Modal>
  );
}

// ── ReactivateModal ───────────────────────────────────────────────────────

function ReactivateModal({ open, onClose, onConfirm, loading }: any) {
  return (
    <Modal open={open} onClose={onClose} title="Reactivate Subscription"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm} disabled={loading}>
            {loading ? <Loader size={14} className="animate-spin mr-2" /> : null}
            Confirm reactivation
          </Button>
        </>
      }>
      <div className="px-5 py-5">
        <p className="text-sm text-stone-300 leading-relaxed">
          This will remove the scheduled cancellation and keep your subscription active.
          You will continue to be billed as normal.
        </p>
      </div>
    </Modal>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────

export default function BillingPage() {
  const { data: session } = useSession();
  const role = (session?.user as any)?.role;
  const canManage = role === "super_admin" || role === "company_admin";

  const [billing, setBilling]               = useState<any>(null);
  const [loading, setLoading]               = useState(true);
  const [showCancel, setShowCancel]         = useState(false);
  const [showReactivate, setShowReactivate] = useState(false);
  const [actionLoading, setActionLoading]   = useState(false);
  const [portalLoading, setPortalLoading]   = useState(false);
  const [toast, setToast]                   = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/billing");
      if (r.ok) setBilling(await r.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (!canManage) {
    return (
      <div className="max-w-2xl mx-auto py-16 flex flex-col items-center gap-4 text-center">
        <ShieldAlert size={32} className="text-stone-500" />
        <h2 className="text-lg font-semibold text-white">Access restricted</h2>
        <p className="text-sm text-stone-400">Only organisation admins can view billing information.</p>
      </div>
    );
  }

  const sub = billing?.subscription;
  const pendingCancel = billing?.pendingCancellation;
  const latestCancel  = billing?.latestCancellation;

  // Determine displayed cancellation state
  const isScheduledCancel = sub?.cancelAt || sub?.cancelAtPeriodEnd;
  const cancelDate = sub?.cancelAt
    ? new Date(sub.cancelAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : sub?.currentPeriodEnd
      ? new Date(sub.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
      : null;

  const handleCancelRequest = async (reason: string) => {
    setActionLoading(true);
    try {
      const r = await fetch("/api/billing/cancel-request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (r.ok) {
        setToast({ type: "success", message: "Cancellation request submitted" });
        setShowCancel(false);
        load();
      } else {
        const d = await r.json();
        setToast({ type: "error", message: d.error ?? "Failed to submit request" });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleReactivate = async () => {
    setActionLoading(true);
    try {
      const r = await fetch("/api/billing/reactivate", { method: "POST" });
      if (r.ok) {
        setToast({ type: "success", message: "Subscription reactivated" });
        setShowReactivate(false);
        load();
      } else {
        setToast({ type: "error", message: "Failed to reactivate subscription" });
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handlePortal = async () => {
    setPortalLoading(true);
    try {
      const r = await fetch("/api/billing/portal", { method: "POST" });
      if (r.ok) {
        const { url } = await r.json();
        window.location.href = url;
      } else {
        setToast({ type: "error", message: "Could not open billing portal" });
      }
    } finally {
      setPortalLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-5 py-1">
      <div className="flex items-center gap-3 mb-1">
        <Link href="/settings" className="text-stone-500 hover:text-stone-300 transition-colors">
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="text-base font-semibold text-white">Billing & Subscription</h1>
          <p className="text-xs text-stone-500">Manage your plan, payment method, and billing history.</p>
        </div>
      </div>

      {/* Cancellation banners */}
      {isScheduledCancel && (
        <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/25 rounded-lg">
          <AlertTriangle size={15} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-amber-300 font-medium">Subscription scheduled to cancel</p>
            <p className="text-xs text-amber-400/80 mt-0.5">
              Your subscription is scheduled to cancel on {cancelDate}. Your organisation will keep access until then.
            </p>
          </div>
          {canManage && (
            <Button variant="secondary" size="sm" onClick={() => setShowReactivate(true)}>
              Reactivate
            </Button>
          )}
        </div>
      )}

      {pendingCancel && !isScheduledCancel && (
        <div className="flex items-start gap-3 p-4 bg-stone-800/60 border border-stone-700 rounded-lg">
          <Clock size={15} className="text-stone-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-stone-300">
            Your cancellation request has been submitted and is under review. Your subscription remains active for now.
          </p>
        </div>
      )}

      {latestCancel?.status === "rejected" && !pendingCancel && !isScheduledCancel && (
        <div className="flex items-start gap-3 p-4 bg-stone-800/60 border border-stone-700 rounded-lg">
          <XCircle size={15} className="text-stone-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-stone-400">
            Your cancellation request was reviewed and your subscription remains active. Please contact support if you have questions.
          </p>
        </div>
      )}

      {sub?.lastPaymentStatus === "failed" && sub?.status !== "past_due" && sub?.status !== "unpaid" && (
        <div className="flex items-start gap-3 p-4 bg-rose-500/10 border border-rose-500/25 rounded-lg">
          <AlertTriangle size={15} className="text-rose-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-rose-300 font-medium">Payment failed</p>
            <p className="text-xs text-rose-400/80 mt-0.5">
              We couldn't process your latest payment. Please update your payment method to avoid interruption.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={handlePortal} disabled={portalLoading}>
            Update card
          </Button>
        </div>
      )}

      {sub?.status === "past_due" && (
        <div className="flex items-start gap-3 p-4 bg-amber-500/10 border border-amber-500/25 rounded-lg">
          <AlertTriangle size={15} className="text-amber-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-amber-300 font-medium">Payment overdue — update your card</p>
            <p className="text-xs text-amber-400/80 mt-0.5">
              Your subscription has an outstanding payment. Chase automations are still running during this grace period,
              but access will be suspended if payment is not resolved.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={handlePortal} disabled={portalLoading}>
            Update card
          </Button>
        </div>
      )}

      {sub?.status === "unpaid" && (
        <div className="flex items-start gap-3 p-4 bg-rose-500/10 border border-rose-500/25 rounded-lg">
          <AlertTriangle size={15} className="text-rose-400 mt-0.5 flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm text-rose-300 font-medium">Automations paused — payment required</p>
            <p className="text-xs text-rose-400/80 mt-0.5">
              Automated invoice chasing has been paused because your subscription is unpaid. Update your payment method to resume.
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={handlePortal} disabled={portalLoading}>
            Update card
          </Button>
        </div>
      )}

      {/* Subscription summary */}
      {loading ? (
        <Card padding="md">
          <div className="space-y-3 animate-pulse">
            <div className="h-4 bg-stone-800 rounded w-1/3" />
            <div className="h-3 bg-stone-800 rounded w-1/2" />
            <div className="h-3 bg-stone-800 rounded w-2/5" />
          </div>
        </Card>
      ) : !sub ? (
        <Card padding="md">
          <div className="flex flex-col items-center py-8 text-center gap-3">
            <CreditCard size={28} className="text-stone-600" />
            <h3 className="text-sm font-semibold text-white">No active subscription</h3>
            <p className="text-xs text-stone-500">No billing account is linked to this organisation yet.</p>
          </div>
        </Card>
      ) : (
        <>
          {/* Plan card */}
          <Card padding="md">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                  <CreditCard size={18} className="text-emerald-400" />
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-semibold text-white">{sub.planName ?? "Subscription"}</h2>
                    {statusBadge(sub.status, sub.cancelAtPeriodEnd)}
                    {paymentStatusBadge(sub.lastPaymentStatus)}
                  </div>
                  <p className="text-xs text-stone-500 mt-0.5">{planLabel(sub)}</p>
                </div>
              </div>
              {canManage && (
                <Button variant="secondary" size="sm" icon={ExternalLink} onClick={handlePortal} disabled={portalLoading}>
                  {portalLoading ? "Opening…" : "Manage payment"}
                </Button>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 sm:grid-cols-3 gap-4 border-t border-stone-800 pt-4">
              <div>
                <p className="text-[11px] text-stone-500 mb-0.5">Renewal date</p>
                <p className="text-sm text-white">
                  {sub.currentPeriodEnd
                    ? new Date(sub.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                    : "—"}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-stone-500 mb-0.5">Billing email</p>
                <p className="text-sm text-white truncate">{sub.billingEmail ?? "—"}</p>
              </div>
              {sub.paymentMethodLast4 && (
                <div>
                  <p className="text-[11px] text-stone-500 mb-0.5">Payment method</p>
                  <p className="text-sm text-white capitalize">
                    {sub.paymentMethodBrand ?? "Card"} ···· {sub.paymentMethodLast4}
                  </p>
                </div>
              )}
              {sub.lastPaymentDate && (
                <div>
                  <p className="text-[11px] text-stone-500 mb-0.5">Last payment</p>
                  <p className="text-sm text-white">
                    {new Date(sub.lastPaymentDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    {sub.lastPaymentAmount
                      ? ` · ${fmt.money(sub.lastPaymentAmount / 100, sub.planCurrency?.toUpperCase() ?? "EUR")}`
                      : ""}
                  </p>
                </div>
              )}
            </div>
          </Card>

          {/* Cancellation zone */}
          {canManage && sub.status !== "cancelled" && !pendingCancel && !isScheduledCancel && (
            <Card padding="md">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-white">Cancel subscription</h3>
                  <p className="text-xs text-stone-500 mt-0.5">
                    Submits a cancellation request for our team to review. Access remains active during review.
                  </p>
                </div>
                <Button variant="danger" size="sm" onClick={() => setShowCancel(true)}>
                  Cancel subscription
                </Button>
              </div>
            </Card>
          )}

          {sub.status === "cancelled" && (
            <Card padding="md">
              <div className="flex items-center gap-3">
                <XCircle size={16} className="text-stone-500" />
                <p className="text-sm text-stone-400">Your subscription has been cancelled.</p>
              </div>
            </Card>
          )}
        </>
      )}

      {/* Modals */}
      <CancelModal
        open={showCancel}
        onClose={() => setShowCancel(false)}
        onSubmit={handleCancelRequest}
        loading={actionLoading}
      />
      <ReactivateModal
        open={showReactivate}
        onClose={() => setShowReactivate(false)}
        onConfirm={handleReactivate}
        loading={actionLoading}
      />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
