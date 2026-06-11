"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Users, XCircle, AlertTriangle, FileText, CreditCard, TrendingUp, Clock, CheckCircle2, RefreshCw } from "lucide-react";
import { Card, Badge } from "@/components/ui";
import { fmt } from "@/lib/format";

function StatCard({ label, value, icon: Icon, color = "stone", href }: any) {
  const colors: Record<string, string> = {
    stone:   "text-stone-400 bg-stone-800/60",
    emerald: "text-emerald-400 bg-emerald-500/10",
    amber:   "text-amber-400 bg-amber-500/10",
    rose:    "text-rose-400 bg-rose-500/10",
    blue:    "text-blue-400 bg-blue-500/10",
  };
  const content = (
    <Card padding="md" className={`${href ? "cursor-pointer hover:ring-1 hover:ring-stone-600 transition-all" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-stone-500">{label}</span>
        <div className={`w-7 h-7 rounded-md flex items-center justify-center ${colors[color]}`}>
          <Icon size={14} />
        </div>
      </div>
      <div className={`text-3xl font-bold tabular-nums ${value > 0 ? (color === "rose" || color === "amber" ? `text-${color}-400` : "text-white") : "text-white"}`}>
        {value ?? 0}
      </div>
    </Card>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function actionBadge(action: string) {
  const map: Record<string, string> = {
    cancellation_requested:   "yellow",
    cancellation_immediate:   "red",
    cancellation_30_days:     "orange",
    cancellation_60_days:     "orange",
    cancellation_90_days:     "orange",
    cancellation_period_end:  "orange",
    cancellation_rejected:    "neutral",
    subscription_reactivated: "green",
    subscription_created:     "green",
    subscription_updated:     "blue",
    subscription_cancelled:   "red",
    payment_failed:           "red",
  };
  return map[action] ?? "neutral";
}

function actionLabel(action: string) {
  return action.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

export default function AdminOverviewPage() {
  const [data, setData]       = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/overview");
      if (r.ok) setData(await r.json());
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
          <h1 className="text-lg font-semibold text-white">Admin Overview</h1>
          <p className="text-xs text-stone-500 mt-0.5">Internal billing and subscription management</p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200 transition-colors"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Active"        value={stats.active}              icon={CheckCircle2} color="emerald" href="/admin/subscriptions" />
        <StatCard label="Trialing"      value={stats.trialing}            icon={Clock}        color="blue"    href="/admin/subscriptions" />
        <StatCard label="Past due"      value={stats.pastDue}             icon={AlertTriangle} color="rose"   href="/admin/subscriptions" />
        <StatCard label="Cancelling"    value={stats.cancelling}          icon={XCircle}      color="amber"   href="/admin/subscriptions" />
        <StatCard label="Cancelled"     value={stats.cancelled}           icon={XCircle}      color="stone"   href="/admin/subscriptions" />
        <StatCard label="Failed payments" value={stats.failedPayments}   icon={AlertTriangle} color="rose"   href="/admin/subscriptions" />
        <StatCard label="Pending cancellations" value={stats.pendingCancellations} icon={Clock} color={stats.pendingCancellations > 0 ? "amber" : "stone"} href="/admin/cancellations" />
        <StatCard label="New leads"     value={stats.newLeads}            icon={FileText}     color={stats.newLeads > 0 ? "blue" : "stone"} href="/admin/leads" />
      </div>

      <div className="grid md:grid-cols-2 gap-5">
        {/* Recent cancellations */}
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
                  <Badge variant={c.status === "pending" ? "yellow" : c.status === "approved" ? "green" : "neutral"}>
                    {c.status}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* Recent leads */}
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
                  <Badge variant={l.status === "new" ? "blue" : l.status === "converted" ? "green" : "neutral"}>
                    {l.status}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Recent audit log */}
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
                <Badge variant={actionBadge(log.action) as any} size="sm">{actionLabel(log.action)}</Badge>
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
