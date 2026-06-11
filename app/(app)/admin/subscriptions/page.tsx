"use client";

import { useState, useEffect, useCallback } from "react";
import { CreditCard, Loader, ExternalLink, RefreshCw, CheckCircle2, AlertTriangle } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { fmt } from "@/lib/format";

const STATUS_BADGE: Record<string, string> = {
  active:     "green",
  trialing:   "blue",
  past_due:   "red",
  canceled:   "neutral",
  cancelled:  "neutral",
  incomplete: "yellow",
  paused:     "neutral",
};

function fmtPlan(amount: number | null, currency: string | null, interval: string | null) {
  if (!amount || !currency) return null;
  const money = fmt.money(amount / 100, currency.toUpperCase());
  return interval ? `${money}/${interval}` : money;
}

type SyncResult = { synced: number; skipped: number; errors: string[] } | null;

export default function SubscriptionsPage() {
  const [subs, setSubs]             = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [syncing, setSyncing]       = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/subscriptions");
      if (r.ok) setSubs((await r.json()).subscriptions ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSyncAll = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await fetch("/api/admin/subscriptions/sync", { method: "POST" });
      const d = await r.json();
      setSyncResult(d);
      if (r.ok) await load();
    } catch {
      setSyncResult({ synced: 0, skipped: 0, errors: ["Network error — sync failed"] });
    } finally { setSyncing(false); }
  };

  const hasAnyData = subs.some(s => s.planName || s.planAmount || s.paymentMethodLast4);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">All Subscriptions</h1>
          <p className="text-xs text-stone-500 mt-0.5">Stripe-synced subscriptions across all organisations</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading || syncing}
            className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200 transition-colors disabled:opacity-40">
            <Loader size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            onClick={handleSyncAll}
            disabled={syncing || loading}
            className="flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-lg border border-emerald-600/50 bg-emerald-600/10 text-emerald-300 hover:bg-emerald-600/20 hover:text-emerald-200 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing from Stripe…" : "Sync all from Stripe"}
          </button>
        </div>
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-sm ${
          syncResult.errors.length
            ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
        }`}>
          {syncResult.errors.length
            ? <AlertTriangle size={15} className="text-amber-400 mt-0.5 shrink-0" />
            : <CheckCircle2 size={15} className="text-emerald-400 mt-0.5 shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="font-medium">
              Sync complete — {syncResult.synced} updated, {syncResult.skipped} skipped
              {syncResult.errors.length > 0 && `, ${syncResult.errors.length} error${syncResult.errors.length !== 1 ? "s" : ""}`}
            </p>
            {syncResult.errors.length > 0 && (
              <ul className="mt-1 text-[11px] text-amber-400/80 space-y-0.5">
                {syncResult.errors.slice(0, 5).map((e, i) => <li key={i}>· {e}</li>)}
              </ul>
            )}
          </div>
          <button onClick={() => setSyncResult(null)} className="text-stone-500 hover:text-stone-300 text-xs ml-2 shrink-0">✕</button>
        </div>
      )}

      {/* Empty-data hint */}
      {!loading && subs.length > 0 && !hasAnyData && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-blue-500/20 bg-blue-500/5 text-xs text-blue-300">
          <CreditCard size={14} className="shrink-0" />
          Plan details not yet synced — click <strong className="mx-1">"Sync all from Stripe"</strong> above to pull live data.
        </div>
      )}

      {/* Table */}
      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-3">
            {[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-stone-800 rounded animate-pulse" />)}
          </div>
        ) : !subs.length ? (
          <div className="py-16 text-center">
            <CreditCard size={28} className="text-stone-600 mx-auto mb-3" />
            <p className="text-sm text-stone-500">No subscriptions found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[860px]">
              <thead>
                <tr className="border-b border-stone-800">
                  {["Organisation", "Plan", "Status", "Payment method", "Period ends", "Cancel date", "Last payment", "Stripe"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] text-stone-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {subs.map((s: any) => {
                  const planStr = fmtPlan(s.planAmount, s.planCurrency, s.planInterval);
                  return (
                    <tr key={s.id} className="border-b border-stone-800/50 hover:bg-stone-800/25 transition-colors">
                      {/* Organisation */}
                      <td className="px-4 py-3">
                        <p className="text-white text-xs font-medium">{s.orgName ?? "—"}</p>
                        {s.billingEmail && (
                          <p className="text-[11px] text-stone-500 truncate max-w-[160px]">{s.billingEmail}</p>
                        )}
                      </td>

                      {/* Plan */}
                      <td className="px-4 py-3">
                        {s.planName ? (
                          <>
                            <p className="text-stone-200 text-xs font-medium">{s.planName}</p>
                            {planStr && <p className="text-[11px] text-stone-500">{planStr}</p>}
                          </>
                        ) : (
                          <span className="text-stone-600 text-xs">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <Badge variant={(STATUS_BADGE[s.status] ?? "neutral") as any}>{s.status ?? "—"}</Badge>
                        {s.cancelAtPeriodEnd && (
                          <p className="text-[11px] text-amber-400 mt-0.5">Cancels at period end</p>
                        )}
                      </td>

                      {/* Payment method */}
                      <td className="px-4 py-3">
                        {s.paymentMethodBrand && s.paymentMethodLast4 ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-stone-300 capitalize">{s.paymentMethodBrand}</span>
                            <span className="text-[11px] text-stone-500">····{s.paymentMethodLast4}</span>
                          </div>
                        ) : (
                          <span className="text-stone-600 text-xs">—</span>
                        )}
                      </td>

                      {/* Period ends */}
                      <td className="px-4 py-3 text-xs text-stone-400 whitespace-nowrap">
                        {s.currentPeriodEnd
                          ? new Date(s.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                          : <span className="text-stone-600">—</span>}
                      </td>

                      {/* Cancel date */}
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {s.cancelAt
                          ? <span className="text-amber-400">{new Date(s.cancelAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                          : <span className="text-stone-600">—</span>}
                      </td>

                      {/* Last payment */}
                      <td className="px-4 py-3">
                        {s.lastPaymentStatus ? (
                          <div>
                            <Badge variant={s.lastPaymentStatus === "paid" ? "green" : "red" as any} size="sm">
                              {s.lastPaymentStatus}
                            </Badge>
                            {s.lastPaymentAmount && s.planCurrency && (
                              <p className="text-[11px] text-stone-500 mt-0.5">
                                {fmt.money(s.lastPaymentAmount / 100, s.planCurrency.toUpperCase())}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-stone-600 text-xs">—</span>
                        )}
                      </td>

                      {/* Stripe link */}
                      <td className="px-4 py-3">
                        {s.stripeCustomerId ? (
                          <a
                            href={`https://dashboard.stripe.com/customers/${s.stripeCustomerId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-stone-500 hover:text-emerald-400 transition-colors"
                            title="Open in Stripe Dashboard"
                          >
                            <ExternalLink size={13} />
                          </a>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
