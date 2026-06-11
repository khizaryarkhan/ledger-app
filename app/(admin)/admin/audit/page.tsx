"use client";

import { useState, useEffect } from "react";
import { ScrollText, RefreshCw } from "lucide-react";
import { Card, Badge } from "@/components/ui";

const ACTION_BADGE: Record<string, string> = {
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

function actionLabel(action: string) {
  return action.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

export default function AuditPage() {
  const [logs, setLogs]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/audit?limit=100");
      if (r.ok) {
        const d = await r.json();
        setLogs(d.logs ?? []);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Billing Audit Log</h1>
          <p className="text-xs text-stone-500 mt-0.5">All billing events and admin decisions</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200 transition-colors">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-2">
            {[...Array(8)].map((_, i) => <div key={i} className="h-10 bg-stone-800 rounded animate-pulse" />)}
          </div>
        ) : !logs.length ? (
          <div className="py-16 text-center">
            <ScrollText size={28} className="text-stone-600 mx-auto mb-3" />
            <p className="text-sm text-stone-500">No audit events yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800">
                {["Action", "Organisation", "Actor", "Role", "Previous", "New", "Stripe", "Date"].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-[11px] text-stone-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((log: any) => (
                <tr key={log.id} className="border-b border-stone-800/50 hover:bg-stone-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <Badge variant={ACTION_BADGE[log.action] as any ?? "neutral"} size="sm">
                      {actionLabel(log.action)}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-300">{log.orgName ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-stone-400 max-w-[120px] truncate">{log.actorEmail ?? "System"}</td>
                  <td className="px-4 py-3 text-xs text-stone-500">{log.actorRole ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-stone-500">{log.previousStatus ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-stone-400">{log.newStatus ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-stone-500 truncate max-w-[80px]">
                    {log.stripeEventId ? log.stripeEventId.slice(-12) : "—"}
                  </td>
                  <td className="px-4 py-3 text-xs text-stone-500 whitespace-nowrap">
                    {new Date(log.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
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
