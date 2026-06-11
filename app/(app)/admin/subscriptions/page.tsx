"use client";

import { useState, useEffect, useCallback } from "react";
import { CreditCard, Loader, ExternalLink } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { fmt } from "@/lib/format";

const STATUS_BADGE: Record<string, string> = {
  active:    "green",
  trialing:  "blue",
  past_due:  "red",
  canceled:  "neutral",
  incomplete: "yellow",
  paused:    "neutral",
};

function fmtPlan(amount: number | null, currency: string | null, interval: string | null) {
  if (!amount || !currency) return "—";
  const money = fmt.money(amount / 100, currency.toUpperCase());
  return interval ? `${money}/${interval}` : money;
}

export default function SubscriptionsPage() {
  const [subs, setSubs]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/subscriptions");
      if (r.ok) setSubs((await r.json()).subscriptions ?? []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">All Subscriptions</h1>
          <p className="text-xs text-stone-500 mt-0.5">Stripe-synced subscriptions across all organisations</p>
        </div>
        <button onClick={load} disabled={loading}
          className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200 transition-colors">
          <Loader size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-stone-800 rounded animate-pulse" />)}</div>
        ) : !subs.length ? (
          <div className="py-16 text-center">
            <CreditCard size={28} className="text-stone-600 mx-auto mb-3" />
            <p className="text-sm text-stone-500">No subscriptions found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead>
                <tr className="border-b border-stone-800">
                  {["Organisation", "Plan", "Status", "Payment method", "Period ends", "Cancel date", "Last payment", "Stripe"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] text-stone-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {subs.map((s: any) => (
                  <tr key={s.id} className="border-b border-stone-800/50 hover:bg-stone-800/30 transition-colors">
                    <td className="px-4 py-3">
                      <p className="text-white text-xs font-medium">{s.orgName ?? "—"}</p>
                      <p className="text-[11px] text-stone-500 truncate max-w-[120px]">{s.billingEmail ?? ""}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="text-stone-300 text-xs">{s.planName ?? "—"}</p>
                      <p className="text-[11px] text-stone-500">{fmtPlan(s.planAmount, s.planCurrency, s.planInterval)}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_BADGE[s.status] as any ?? "neutral"}>{s.status ?? "—"}</Badge>
                      {s.cancelAtPeriodEnd && (
                        <p className="text-[11px] text-amber-400 mt-0.5">Cancels at period end</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {s.paymentMethodBrand && s.paymentMethodLast4 ? (
                        <p className="text-xs text-stone-300 capitalize">
                          {s.paymentMethodBrand} ····{s.paymentMethodLast4}
                        </p>
                      ) : (
                        <p className="text-xs text-stone-600">—</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-400 whitespace-nowrap">
                      {s.currentPeriodEnd
                        ? new Date(s.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">
                      {s.cancelAt
                        ? <span className="text-amber-400">{new Date(s.cancelAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                        : <span className="text-stone-600">—</span>}
                    </td>
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
                      ) : <span className="text-stone-600 text-xs">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {s.stripeCustomerId ? (
                        <a
                          href={`https://dashboard.stripe.com/customers/${s.stripeCustomerId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-stone-500 hover:text-stone-200 transition-colors"
                          onClick={e => e.stopPropagation()}
                        >
                          <ExternalLink size={12} />
                        </a>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
