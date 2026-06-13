"use client";

import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import {
  CreditCard, RefreshCw, AlertTriangle, CheckCircle2, Clock,
  XCircle, ExternalLink, ChevronRight, Loader, ShieldAlert, ArrowLeft,
  FileText, Download, Zap,
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
    case "canceled":
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

// ── RenewModal ────────────────────────────────────────────────────────────

function intervalLabel(interval: string, intervalCount: number) {
  if (interval === "year")  return intervalCount === 1 ? "/yr"  : `/${intervalCount} yrs`;
  if (interval === "month") return intervalCount === 1 ? "/mo"  : `/${intervalCount} mo`;
  return `/${intervalCount} ${interval}`;
}

function RenewModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [plans, setPlans]       = useState<any[]>([]);
  const [loadingPlans, setLoadingPlans] = useState(true);
  const [selecting, setSelecting] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoadingPlans(true);
    fetch("/api/billing/plans")
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => setPlans(d.plans ?? []))
      .catch(() => setPlans([]))
      .finally(() => setLoadingPlans(false));
  }, [open]);

  const handleSelect = async (priceId: string) => {
    setSelecting(priceId);
    try {
      const r = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      if (r.ok) {
        const { url } = await r.json();
        window.location.href = url;
      }
    } finally {
      setSelecting(null);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Choose a plan"
      footer={<Button variant="secondary" onClick={onClose}>Cancel</Button>}>
      <div className="px-5 py-5">
        {loadingPlans ? (
          <div className="space-y-3 animate-pulse">
            {[1,2].map(i => <div key={i} className="h-20 bg-stone-800 rounded-lg" />)}
          </div>
        ) : plans.length === 0 ? (
          <p className="text-sm text-stone-400 text-center py-4">No plans available. Contact support.</p>
        ) : (
          <div className="space-y-3">
            {plans.map((plan: any) => {
              const amount = plan.amount != null
                ? `$${(plan.amount / 100).toFixed(plan.amount % 100 === 0 ? 0 : 2)}`
                : null;
              const period = plan.interval ? intervalLabel(plan.interval, plan.intervalCount ?? 1) : "";
              const isLoading = selecting === plan.priceId;
              return (
                <button
                  key={plan.priceId}
                  onClick={() => handleSelect(plan.priceId)}
                  disabled={!!selecting}
                  className="w-full text-left p-4 rounded-lg border border-stone-700 bg-stone-800/40 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-md bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                        <Zap size={14} className="text-emerald-400" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-white">
                          {plan.productName}
                          {plan.interval === "year" && (
                            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">
                              Best value
                            </span>
                          )}
                        </p>
                        {plan.description && (
                          <p className="text-xs text-stone-400 mt-0.5">{plan.description}</p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {amount && (
                        <p className="text-sm font-semibold text-white">
                          {amount}<span className="text-xs text-stone-400 font-normal">{period}</span>
                        </p>
                      )}
                      {isLoading
                        ? <Loader size={14} className="animate-spin text-emerald-400" />
                        : <ChevronRight size={14} className="text-stone-500 group-hover:text-emerald-400 transition-colors" />
                      }
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
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
  const [invoices, setInvoices]             = useState<any[]>([]);
  const [invoicesLoading, setInvoicesLoading] = useState(true);
  const [showCancel, setShowCancel]         = useState(false);
  const [showReactivate, setShowReactivate] = useState(false);
  const [showRenew, setShowRenew]           = useState(false);
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

  const loadInvoices = useCallback(async () => {
    setInvoicesLoading(true);
    try {
      const r = await fetch("/api/billing/invoices");
      if (r.ok) {
        const d = await r.json();
        setInvoices(d.invoices ?? []);
      }
    } finally {
      setInvoicesLoading(false);
    }
  }, []);

  useEffect(() => { load(); loadInvoices(); }, [load, loadInvoices]);

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
          {canManage && sub.status !== "cancelled" && sub.status !== "canceled" && !pendingCancel && !isScheduledCancel && (
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

          {(sub.status === "canceled" || sub.status === "cancelled") && canManage && (
            <Card padding="md">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-white">Renew subscription</h3>
                  <p className="text-xs text-stone-500 mt-0.5">
                    Your subscription is cancelled. Choose a plan to restore full access and resume automations.
                  </p>
                </div>
                <Button variant="primary" size="sm" icon={RefreshCw} onClick={() => setShowRenew(true)}>
                  Renew now
                </Button>
              </div>
            </Card>
          )}

          {/* Invoice history */}
          <Card padding="md">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-white">Invoice history</h3>
            </div>
            {invoicesLoading ? (
              <div className="space-y-2 animate-pulse">
                {[1,2,3].map(i => <div key={i} className="h-9 bg-stone-800 rounded" />)}
              </div>
            ) : invoices.length === 0 ? (
              <div className="flex flex-col items-center py-6 text-center gap-2">
                <FileText size={22} className="text-stone-600" />
                <p className="text-xs text-stone-500">No invoices yet</p>
              </div>
            ) : (
              <div className="divide-y divide-stone-800">
                {invoices.map((inv: any) => {
                  const date = new Date(inv.date * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
                  const amount = inv.amount != null
                    ? fmt.money(inv.amount / 100, (inv.currency ?? "usd").toUpperCase())
                    : "—";
                  return (
                    <div key={inv.id} className="flex items-center justify-between py-2.5 gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText size={14} className="text-stone-500 flex-shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm text-white">{date}</p>
                          {inv.number && <p className="text-[11px] text-stone-500">{inv.number}</p>}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 flex-shrink-0">
                        <span className="text-sm text-white">{amount}</span>
                        {inv.status === "paid" && <Badge variant="green">Paid</Badge>}
                        {inv.status === "open" && <Badge variant="yellow">Open</Badge>}
                        {inv.status === "void" && <Badge variant="neutral">Void</Badge>}
                        {inv.status === "uncollectible" && <Badge variant="red">Uncollectible</Badge>}
                        {inv.pdfUrl && (
                          <a
                            href={inv.pdfUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-stone-400 hover:text-white transition-colors"
                            title="Download PDF"
                          >
                            <Download size={14} />
                          </a>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
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
      <RenewModal open={showRenew} onClose={() => setShowRenew(false)} />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
