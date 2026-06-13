"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { useSession, signOut } from "next-auth/react";
import { AlertTriangle, RefreshCw, Clock, CheckCircle2, Zap, ChevronRight, Loader, LogOut } from "lucide-react";

// Pages a cancelled user can still access freely
const ALLOWED_PATHS = ["/settings/billing", "/api/", "/auth/"];

function intervalLabel(interval: string, count: number) {
  if (interval === "year")  return count === 1 ? "/yr"  : `/${count} yrs`;
  if (interval === "month") return count === 1 ? "/mo"  : `/${count} mo`;
  return `/${count} ${interval}`;
}

type View = "options" | "plans" | "request" | "submitted";

export function SubscriptionGate({ children }: { children: React.ReactNode }) {
  const pathname  = usePathname();
  const { status: authStatus } = useSession();

  const [access, setAccess]       = useState<any>(null);
  const [checking, setChecking]   = useState(true);
  const [view, setView]           = useState<View>("options");

  // Plans state
  const [plans, setPlans]         = useState<any[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [selecting, setSelecting] = useState<string | null>(null);

  // Temp access state
  const [reason, setReason]       = useState("");
  const [submitting, setSubmitting] = useState(false);

  const isAllowed = ALLOWED_PATHS.some(p => pathname.startsWith(p));

  useEffect(() => {
    if (authStatus !== "authenticated" || isAllowed) {
      setChecking(false);
      return;
    }
    fetch("/api/billing/access")
      .then(r => r.ok ? r.json() : null)
      .then(d => setAccess(d))
      .catch(() => {})
      .finally(() => setChecking(false));
  }, [pathname, authStatus, isAllowed]);

  const loadPlans = async () => {
    setView("plans");
    setPlansLoading(true);
    try {
      const r = await fetch("/api/billing/plans");
      if (r.ok) setPlans((await r.json()).plans ?? []);
    } finally {
      setPlansLoading(false);
    }
  };

  const handleSelectPlan = async (priceId: string) => {
    setSelecting(priceId);
    try {
      const r = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ priceId }),
      });
      if (r.ok) window.location.href = (await r.json()).url;
    } finally {
      setSelecting(null);
    }
  };

  const handleRequestAccess = async () => {
    setSubmitting(true);
    try {
      const r = await fetch("/api/billing/temp-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (r.ok || r.status === 409) setView("submitted");
    } finally {
      setSubmitting(false);
    }
  };

  // Show children normally in all non-blocked cases
  if (checking || isAllowed || authStatus !== "authenticated") return <>{children}</>;
  if (!access?.blocked) return <>{children}</>;

  // ── Blocking overlay ──────────────────────────────────────────────────────
  return (
    <>
      {/* Blurred background content */}
      <div className="pointer-events-none select-none blur-sm opacity-30">{children}</div>

      {/* Overlay */}
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-950/80 backdrop-blur-sm p-4">
        <div className="w-full max-w-md bg-stone-900 border border-stone-700 rounded-2xl shadow-2xl overflow-hidden">

          {/* Header */}
          <div className="px-6 pt-6 pb-5 text-center border-b border-stone-800">
            <div className="w-14 h-14 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={24} className="text-amber-400" />
            </div>
            <h2 className="text-lg font-semibold text-white">Subscription Cancelled</h2>
            <p className="text-sm text-stone-400 mt-1.5 leading-relaxed">
              Your subscription has ended. Renew to restore full access, or request temporary access while you decide.
            </p>
          </div>

          {/* Body */}
          <div className="px-6 py-5">

            {/* ── Options view ── */}
            {view === "options" && (
              <div className="space-y-3">
                {access.pendingTempAccess ? (
                  <div className="flex items-start gap-3 p-4 bg-blue-500/10 border border-blue-500/20 rounded-lg">
                    <Clock size={15} className="text-blue-400 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-blue-300">Temporary access request pending</p>
                      <p className="text-xs text-blue-400/80 mt-0.5">
                        Your request is under review. You'll be notified once a decision is made.
                      </p>
                    </div>
                  </div>
                ) : null}

                <button
                  onClick={loadPlans}
                  className="w-full flex items-center justify-between p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/25 hover:bg-emerald-500/15 hover:border-emerald-500/40 transition-all group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                      <RefreshCw size={15} className="text-emerald-400" />
                    </div>
                    <div className="text-left">
                      <p className="text-sm font-semibold text-white">Renew Subscription</p>
                      <p className="text-xs text-stone-400">Choose a plan and restore full access instantly</p>
                    </div>
                  </div>
                  <ChevronRight size={15} className="text-stone-500 group-hover:text-emerald-400 transition-colors" />
                </button>

                {!access.pendingTempAccess && (
                  <button
                    onClick={() => setView("request")}
                    className="w-full flex items-center justify-between p-4 rounded-xl border border-stone-700 hover:border-stone-600 hover:bg-stone-800/40 transition-all group"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-lg bg-stone-800 flex items-center justify-center">
                        <Clock size={15} className="text-stone-400" />
                      </div>
                      <div className="text-left">
                        <p className="text-sm font-semibold text-white">Request Temporary Access</p>
                        <p className="text-xs text-stone-400">Ask our team for short-term access while you decide</p>
                      </div>
                    </div>
                    <ChevronRight size={15} className="text-stone-500 group-hover:text-stone-300 transition-colors" />
                  </button>
                )}
              </div>
            )}

            {/* ── Plans view ── */}
            {view === "plans" && (
              <div className="space-y-3">
                <button onClick={() => setView("options")} className="text-xs text-stone-500 hover:text-stone-300 transition-colors mb-1">
                  ← Back
                </button>
                {plansLoading ? (
                  <div className="space-y-2 animate-pulse">
                    {[1,2].map(i => <div key={i} className="h-16 bg-stone-800 rounded-lg" />)}
                  </div>
                ) : plans.length === 0 ? (
                  <p className="text-sm text-stone-400 text-center py-4">No plans available. Contact support.</p>
                ) : plans.map((plan: any) => {
                  const amount = plan.amount != null
                    ? `$${(plan.amount / 100).toFixed(plan.amount % 100 === 0 ? 0 : 2)}`
                    : null;
                  const period = plan.interval ? intervalLabel(plan.interval, plan.intervalCount ?? 1) : "";
                  const isLoading = selecting === plan.priceId;
                  return (
                    <button
                      key={plan.priceId}
                      onClick={() => handleSelectPlan(plan.priceId)}
                      disabled={!!selecting}
                      className="w-full text-left p-4 rounded-xl border border-stone-700 bg-stone-800/40 hover:border-emerald-500/50 hover:bg-emerald-500/5 transition-all disabled:opacity-50 group"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-md bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
                            <Zap size={13} className="text-emerald-400" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-white">
                              {plan.productName}
                              {plan.interval === "year" && (
                                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 font-medium">Best value</span>
                              )}
                            </p>
                            {plan.description && <p className="text-xs text-stone-400 mt-0.5">{plan.description}</p>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {amount && (
                            <p className="text-sm font-semibold text-white">
                              {amount}<span className="text-xs text-stone-400 font-normal">{period}</span>
                            </p>
                          )}
                          {isLoading
                            ? <Loader size={13} className="animate-spin text-emerald-400" />
                            : <ChevronRight size={13} className="text-stone-500 group-hover:text-emerald-400 transition-colors" />
                          }
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}

            {/* ── Request temp access view ── */}
            {view === "request" && (
              <div className="space-y-4">
                <button onClick={() => setView("options")} className="text-xs text-stone-500 hover:text-stone-300 transition-colors">
                  ← Back
                </button>
                <div>
                  <label className="block text-xs text-stone-400 mb-1.5">
                    Reason for temporary access <span className="text-stone-600">(optional)</span>
                  </label>
                  <textarea
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="e.g. Need to export data before renewing, waiting on payment approval…"
                    rows={3}
                    maxLength={1000}
                    className="w-full px-3 py-2.5 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-500 resize-none focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                  />
                </div>
                <button
                  onClick={handleRequestAccess}
                  disabled={submitting}
                  className="w-full py-2.5 rounded-lg bg-stone-700 hover:bg-stone-600 text-sm font-medium text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {submitting && <Loader size={13} className="animate-spin" />}
                  Submit request
                </button>
              </div>
            )}

            {/* ── Submitted view ── */}
            {view === "submitted" && (
              <div className="text-center py-4 space-y-3">
                <div className="w-12 h-12 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto">
                  <CheckCircle2 size={20} className="text-emerald-400" />
                </div>
                <p className="text-sm font-medium text-white">Request submitted</p>
                <p className="text-xs text-stone-400 leading-relaxed">
                  Our team will review your request shortly. You'll regain access once it's approved.
                </p>
                <button
                  onClick={() => setView("options")}
                  className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  Back to options
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-6 pb-5 flex items-center justify-between">
            <p className="text-[11px] text-stone-600">
              Need help?{" "}
              <a href="mailto:support@primeaccountax.com" className="text-stone-500 hover:text-white underline transition-colors">
                support@primeaccountax.com
              </a>
            </p>
            <button
              onClick={() => signOut({ callbackUrl: "/login" })}
              className="flex items-center gap-1.5 text-[11px] text-stone-500 hover:text-stone-300 transition-colors"
            >
              <LogOut size={11} />
              Sign out
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
