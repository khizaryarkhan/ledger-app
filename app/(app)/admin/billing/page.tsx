"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { XCircle, AlertTriangle, FileText, CreditCard, Clock, CheckCircle2, RefreshCw } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { fmt } from "@/lib/format";

function StatCard({ label, value, icon: Icon, color = "stone", href }: any) {
  const colorMap: Record<string, string> = {
    stone:   "text-stone-400 bg-stone-800/60",
    emerald: "text-emerald-400 bg-emerald-500/10",
    amber:   "text-amber-400 bg-amber-500/10",
    rose:    "text-rose-400 bg-rose-500/10",
    blue:    "text-blue-400 bg-blue-500/10",
  };
  const valueColor: Record<string, string> = {
    stone:   "text-white",
    emerald: "text-white",
    amber:   "text-amber-400",
    rose:    "text-rose-400",
    blue:    "text-blue-400",
  };
  const content = (
    <Card padding="md" className={href ? "cursor-pointer hover:ring-1 hover:ring-stone-600 transition-all" : ""}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-stone-500">{label}</span>
        <div className={`w-7 h-7 rounded-md flex items-center justify-center ${colorMap[color]}`}>
          <Icon size={14} />
        </div>
      </div>
      <div className={`text-3xl font-bold tabular-nums ${valueColor[color]}`}>{value ?? 0}</div>
    </Card>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function actionLabel(action: string) {
  return action.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

const ACTION_BADGE: Record<string, string> = {
  cancellation_requested:   "yellow",
  cancellation_immediate:   "red",
  cancellation_period_end:  "orange",
  cancellation_rejected:    "neutral",
  subscription_reactivated: "green",
  subscription_created:     "green",
  subscription_updated:     "blue",
  subscription_cancelled:   "red",
  payment_failed:           "red",
};

export default function AdminBillingPage() {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [webhook, setWebhook] = useState<any>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [r, wh] = await Promise.all([
        fetch("/api/admin/overview"),
        fetch("/api/admin/billing/webhook-health"),
      ]);
      if (r.ok) setData(await r.json());
      if (wh.ok) setWebhook(await wh.json());
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const stats = data?.stats ?? {};

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Billing Overview</h1>
          <p className="text-xs text-stone-500 mt-0.5">Subscription and billing status across all organisations</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200 transition-colors">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active"                value={stats.active}              icon={CheckCircle2} color="emerald" href="/admin/subscriptions" />
        <StatCard label="Trialing"              value={stats.trialing}            icon={Clock}        color="blue"    href="/admin/subscriptions" />
        <StatCard label="Past due"              value={stats.pastDue}             icon={AlertTriangle} color="rose"  href="/admin/subscriptions" />
        <StatCard label="Cancelling"            value={stats.cancelling}          icon={XCircle}      color="amber"  href="/admin/subscriptions" />
        <StatCard label="Cancelled"             value={stats.cancelled}           icon={XCircle}      color="stone"  href="/admin/subscriptions" />
        <StatCard label="Failed payments"       value={stats.failedPayments}      icon={AlertTriangle} color="rose"  href="/admin/subscriptions" />
        <StatCard label="Pending cancellations" value={stats.pendingCancellations} icon={Clock}       color={stats.pendingCancellations > 0 ? "amber" : "stone"} href="/admin/cancellations" />
        <StatCard label="New leads"             value={stats.newLeads}            icon={FileText}     color={stats.newLeads > 0 ? "blue" : "stone"} href="/admin/leads" />
      </div>

      {/* Stripe webhook health — "is Stripe actually reaching us?" */}
      {webhook && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl ring-1 text-xs flex-wrap ${
          webhook.hint || (webhook.counts?.errors7d ?? 0) > 0 || (webhook.hoursSinceLast ?? 0) > 72
            ? "bg-amber-500/10 ring-amber-500/30 text-amber-300"
            : "bg-emerald-500/5 ring-emerald-500/20 text-stone-400"
        }`}>
          <span className="font-semibold text-stone-200">Stripe webhooks:</span>
          {webhook.hint ? (
            <span>{webhook.hint}</span>
          ) : (
            <>
              <span>last event <span className="text-stone-200 font-medium">{webhook.hoursSinceLast === 0 ? "under an hour" : `${webhook.hoursSinceLast}h`} ago</span> ({webhook.recent?.[0]?.eventType})</span>
              <span>· {webhook.counts.last7d} events in 7d</span>
              <span className={webhook.counts.errors7d > 0 ? "text-rose-400 font-semibold" : ""}>· {webhook.counts.errors7d} errors in 7d</span>
              {(webhook.hoursSinceLast ?? 0) > 72 && <span className="font-semibold">— unusually quiet; check the Stripe dashboard endpoint</span>}
            </>
          )}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-5">
        <Card padding="md">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Recent Cancellations</h2>
            <Link href="/admin/cancellations" className="text-xs text-stone-500 hover:text-stone-200 transition-colors">View all →</Link>
          </div>
          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-stone-800 rounded animate-pulse" />)}</div>
          ) : !data?.recentCancellations?.length ? (
            <p className="text-xs text-stone-500 py-4 text-center">No cancellation requests yet</p>
          ) : (
            <div className="space-y-1">
              {data.recentCancellations.map((c: any) => (
                <Link key={c.id} href="/admin/cancellations"
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-stone-800/60 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-stone-300 truncate">{c.requestedByEmail ?? "—"}</p>
                    <p className="text-[11px] text-stone-500">
                      {new Date(c.requestedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                    </p>
                  </div>
                  <Badge variant={c.status === "pending" ? "yellow" : c.status === "approved" ? "green" : "neutral" as any}>
                    {c.status}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card padding="md">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">Recent Leads</h2>
            <Link href="/admin/leads" className="text-xs text-stone-500 hover:text-stone-200 transition-colors">View all →</Link>
          </div>
          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-stone-800 rounded animate-pulse" />)}</div>
          ) : !data?.recentLeads?.length ? (
            <p className="text-xs text-stone-500 py-4 text-center">No leads yet</p>
          ) : (
            <div className="space-y-1">
              {data.recentLeads.map((l: any) => (
                <Link key={l.id} href="/admin/leads"
                  className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-stone-800/60 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-stone-300 truncate">{l.fullName} {l.companyName ? `· ${l.companyName}` : ""}</p>
                    <p className="text-[11px] text-stone-500 truncate">{l.email}</p>
                  </div>
                  <Badge variant={l.status === "new" ? "blue" : l.status === "converted" ? "green" : "neutral" as any}>
                    {l.status}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card padding="md">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-white">Recent Audit Events</h2>
          <Link href="/admin/audit" className="text-xs text-stone-500 hover:text-stone-200 transition-colors">View all →</Link>
        </div>
        {loading ? (
          <div className="space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-8 bg-stone-800 rounded animate-pulse" />)}</div>
        ) : !data?.recentAuditLogs?.length ? (
          <p className="text-xs text-stone-500 py-4 text-center">No events yet</p>
        ) : (
          <div className="space-y-0.5">
            {data.recentAuditLogs.map((log: any) => (
              <div key={log.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-stone-800/40">
                <Badge variant={ACTION_BADGE[log.action] as any ?? "neutral"} size="sm">{actionLabel(log.action)}</Badge>
                <span className="text-xs text-stone-500 flex-1 min-w-0 truncate">
                  {log.orgName ?? "—"} {log.actorName ? `· by ${log.actorName}` : ""}
                </span>
                <span className="text-[11px] text-stone-600 whitespace-nowrap">
                  {new Date(log.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
