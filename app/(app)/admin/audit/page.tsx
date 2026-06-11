"use client";

import { useState, useEffect, useCallback } from "react";
import { ScrollText, Loader } from "lucide-react";
import { Card, Badge } from "@/components/ui";

const ACTION_BADGE: Record<string, string> = {
  cancellation_requested:   "yellow",
  cancellation_immediate:   "red",
  cancellation_period_end:  "orange",
  cancellation_30_days:     "amber",
  cancellation_60_days:     "amber",
  cancellation_90_days:     "amber",
  cancellation_rejected:    "neutral",
  subscription_reactivated: "green",
  subscription_created:     "green",
  subscription_updated:     "blue",
  subscription_cancelled:   "red",
  invoice_paid:             "green",
  payment_failed:           "red",
};

function actionLabel(action: string) {
  return action.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase());
}

export default function AuditPage() {
  const [logs, setLogs]       = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(0);
  const PAGE_SIZE = 50;

  const load = useCallback(async (offset = 0) => {
    setLoading(true);
    try {
      const r = await fetch(`/api/admin/audit?limit=${PAGE_SIZE}&offset=${offset}`);
      if (r.ok) {
        const d = await r.json();
        setLogs(d.logs ?? []);
      }
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(page * PAGE_SIZE); }, [load, page]);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Billing Audit Log</h1>
          <p className="text-xs text-stone-500 mt-0.5">Immutable record of all billing and subscription events</p>
        </div>
        <button onClick={() => { setPage(0); load(0); }} disabled={loading}
          className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200 transition-colors">
          <Loader size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-2">{[1,2,3,4,5,6].map(i => <div key={i} className="h-10 bg-stone-800 rounded animate-pulse" />)}</div>
        ) : !logs.length ? (
          <div className="py-16 text-center">
            <ScrollText size={28} className="text-stone-600 mx-auto mb-3" />
            <p className="text-sm text-stone-500">No audit events yet</p>
          </div>
        ) : (
          <>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800">
                  {["Event", "Organisation", "Actor", "Role", "Prev status", "New status", "Date"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] text-stone-500 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((log: any) => (
                  <tr key={log.id} className="border-b border-stone-800/50 hover:bg-stone-800/20 transition-colors">
                    <td className="px-4 py-3">
                      <Badge variant={ACTION_BADGE[log.action] as any ?? "neutral"} size="sm">
                        {actionLabel(log.action)}
                      </Badge>
                      {log.stripeActionStatus && log.stripeActionStatus !== "applied" && (
                        <p className="text-[11px] text-rose-400 mt-0.5">{log.stripeActionStatus}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-300 truncate max-w-[140px]">{log.orgName ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-stone-400 truncate max-w-[120px]">{log.actorName ?? log.actorUserId ?? "system"}</td>
                    <td className="px-4 py-3 text-[11px] text-stone-500">{log.actorRole ?? "—"}</td>
                    <td className="px-4 py-3 text-[11px] text-stone-500">{log.previousStatus ?? "—"}</td>
                    <td className="px-4 py-3 text-[11px] text-stone-400">{log.newStatus ?? "—"}</td>
                    <td className="px-4 py-3 text-[11px] text-stone-500 whitespace-nowrap">
                      {new Date(log.createdAt).toLocaleString("en-GB", {
                        day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="flex items-center justify-between px-4 py-3 border-t border-stone-800">
              <span className="text-xs text-stone-500">
                Showing {page * PAGE_SIZE + 1}–{page * PAGE_SIZE + logs.length}
              </span>
              <div className="flex items-center gap-2">
                <button disabled={page === 0} onClick={() => setPage(p => p - 1)}
                  className="text-xs text-stone-400 hover:text-stone-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  ← Previous
                </button>
                <button disabled={logs.length < PAGE_SIZE} onClick={() => setPage(p => p + 1)}
                  className="text-xs text-stone-400 hover:text-stone-200 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                  Next →
                </button>
              </div>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
