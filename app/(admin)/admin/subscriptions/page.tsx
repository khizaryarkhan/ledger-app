"use client";

import { useState, useEffect } from "react";
import { CreditCard, Loader, RefreshCw } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { fmt } from "@/lib/format";

const STATUS_BADGE: Record<string, string> = {
  active:    "green",
  trialing:  "blue",
  past_due:  "red",
  cancelled: "neutral",
  unpaid:    "red",
  incomplete: "yellow",
};

function formatMoney(amount: number | null, currency: string | null) {
  if (!amount || !currency) return "—";
  return fmt.money(amount / 100, currency.toUpperCase());
}

export default function SubscriptionsPage() {
  const [subs, setSubs]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter]   = useState("all");

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/subscriptions");
      if (r.ok) {
        const d = await r.json();
        setSubs(d.subscriptions ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const visible = filter === "all" ? subs : subs.filter(s => s.status === filter);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-base font-semibold text-white">All Subscriptions</h1>
          <p className="text-xs text-stone-500 mt-0.5">Stripe-synced subscription status across all organisations</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="h-8 px-2.5 text-xs rounded-md border border-stone-700 bg-stone-800 text-stone-200 focus:outline-none"
          >
            <option value="all">All statuses</option>
            <option value="active">Active</option>
            <option value="trialing">Trialing</option>
            <option value="past_due">Past due</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200 h-8 px-2.5 rounded-md border border-stone-700 bg-stone-800 transition-colors">
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>
      </div>

      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-3">
            {[1,2,3,4].map(i => <div key={i} className="h-14 bg-stone-800 rounded animate-pulse" />)}
          </div>
        ) : !visible.length ? (
          <div className="py-16 text-center">
            <CreditCard size={28} className="text-stone-600 mx-auto mb-3" />
            <p className="text-sm text-stone-500">No subscriptions found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800">
                {["Organisation", "Plan", "Status", "Period ends", "Payment", "Card", "Cancelling"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] text-stone-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((s: any) => (
                <tr key={s.id} className="border-b border-stone-800/50 hover:bg-stone-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <p className="text-white font-medium">{s.orgName ?? "—"}</p>
                    <p className="text-[11px] text-stone-500 truncate max-w-[120px]">{s.billingEmail ?? ""}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-stone-300 text-xs">{s.planName ?? "—"}</p>
                    <p className="text-[11px] text-stone-500">{formatMoney(s.planAmount, s.planCurrency)}/{s.planInterval ?? "mo"}</p>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_BADGE[s.status] as any}>{s.status}</Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-400">
                    {s.currentPeriodEnd
                      ? new Date(s.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {s.lastPaymentStatus ? (
                      <Badge variant={s.lastPaymentStatus === "paid" ? "green" : "red"}>
                        {s.lastPaymentStatus === "paid" ? "Paid" : "Failed"}
                      </Badge>
                    ) : <span className="text-xs text-stone-600">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-400">
                    {s.paymentMethodLast4
                      ? <span className="capitalize">{s.paymentMethodBrand ?? "card"} ···· {s.paymentMethodLast4}</span>
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {s.cancelAt
                      ? <Badge variant="yellow">
                          {new Date(s.cancelAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                        </Badge>
                      : s.cancelAtPeriodEnd
                      ? <Badge variant="yellow">At period end</Badge>
                      : <span className="text-xs text-stone-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
