"use client";

import { useState, useEffect } from "react";
import {
  RefreshCw,
  AlertCircle,
  Clock,
  CheckCircle2,
  PauseCircle,
  Banknote,
  CalendarClock,
  FileText,
  User,
  Activity,
} from "lucide-react";
import { Card, Badge, Button } from "@/components/ui";
import { fmt, formatDate } from "@/lib/format";

// ── Types ────────────────────────────────────────────────────────────────────

interface DashboardStats {
  totalPayables: number;
  currency: string;
  dueThisWeek: number;
  dueThisWeekCount: number;
  overdueBills: number;
  overdueBillsCount: number;
  pendingApproval: number;
  pendingApprovalCount: number;
  billsOnHold: number;
  billsOnHoldCount: number;
  readyForPayment: number;
  readyForPaymentCount: number;
}

interface AgingRow {
  id: string;
  supplierName: string;
  billNumber: string;
  dueDate: string;
  balance: number;
  currency: string;
  agingBucket: "Current" | "1-30" | "31-60" | "61-90" | "90+";
}

interface ApprovalTask {
  id: string;
  billNumber: string;
  supplierName: string;
  amount: number;
  currency: string;
  dueDate: string;
  assignedAt: string;
  type: "bill" | "po";
}

interface ActivityItem {
  id: string;
  description: string;
  timestamp: string;
  type: "sync" | "approval" | "payment" | "hold" | "query";
  actor?: string;
}

interface DashboardData {
  stats: DashboardStats;
  aging: AgingRow[];
  approvalTasks: ApprovalTask[];
  recentActivity: ActivityItem[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function agingBadge(bucket: AgingRow["agingBucket"]) {
  const map: Record<string, string> = {
    Current: "green",
    "1-30": "yellow",
    "31-60": "orange",
    "61-90": "red",
    "90+": "red",
  };
  return map[bucket] || "neutral";
}

// Extra Tailwind class for 90+ dark-red
function agingBadgeClass(bucket: AgingRow["agingBucket"]) {
  if (bucket === "90+") return "bg-rose-900/40 text-rose-300 ring-rose-700/50";
  return "";
}

function activityIcon(type: ActivityItem["type"]) {
  const icons: Record<string, React.ReactNode> = {
    sync: <RefreshCw size={13} className="text-violet-400" />,
    approval: <CheckCircle2 size={13} className="text-emerald-400" />,
    payment: <Banknote size={13} className="text-blue-400" />,
    hold: <PauseCircle size={13} className="text-amber-400" />,
    query: <AlertCircle size={13} className="text-rose-400" />,
  };
  return icons[type] || <Activity size={13} className="text-stone-400" />;
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

function StatCardSkeleton() {
  return (
    <Card padding="md">
      <Skeleton className="h-3 w-24 mb-3" />
      <Skeleton className="h-7 w-32 mb-2" />
      <Skeleton className="h-3 w-16" />
    </Card>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function PayablesDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/dashboard");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleSync() {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const res = await fetch("/api/payables/sync", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      setSyncMessage("Sync started successfully");
      setTimeout(() => setSyncMessage(null), 4000);
      await load();
    } catch {
      setSyncMessage("Sync failed — please try again");
    } finally {
      setSyncing(false);
    }
  }

  const stats = data?.stats;
  const aging = data?.aging ?? [];
  const approvalTasks = data?.approvalTasks ?? [];
  const recentActivity = data?.recentActivity ?? [];

  return (
    <div className="p-6 max-w-[1600px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Payables Dashboard</h1>
          <p className="text-sm text-stone-500 mt-1">Accounts Payable overview</p>
        </div>
        <div className="flex items-center gap-3">
          {syncMessage && (
            <span
              className={`text-sm px-3 py-1.5 rounded-md ${
                syncMessage.includes("failed")
                  ? "bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/30"
                  : "bg-violet-500/10 text-violet-400 ring-1 ring-violet-500/30"
              }`}
            >
              {syncMessage}
            </span>
          )}
          <Button
            variant="secondary"
            icon={RefreshCw}
            onClick={handleSync}
            disabled={syncing}
            className={syncing ? "opacity-60" : ""}
          >
            {syncing ? "Syncing…" : "Sync Now"}
          </Button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="mb-6 flex items-center gap-2 px-4 py-3 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-400 text-sm">
          <AlertCircle size={16} />
          {error}
          <button
            onClick={load}
            className="ml-auto underline hover:no-underline text-rose-300"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Stat cards 2×3 grid ── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {loading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            {/* Total Payables */}
            <Card padding="md" className="border-violet-800/40">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">
                  Total Payables
                </span>
                <Banknote size={16} className="text-violet-500" />
              </div>
              <div className="text-2xl font-semibold text-white tabular-nums">
                {stats ? fmt.money(stats.totalPayables, stats.currency) : "—"}
              </div>
              <p className="text-xs text-stone-500 mt-1">Outstanding balance</p>
            </Card>

            {/* Due This Week */}
            <Card padding="md">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">
                  Due This Week
                </span>
                <CalendarClock size={16} className="text-amber-500" />
              </div>
              <div className="text-2xl font-semibold text-white tabular-nums">
                {stats ? fmt.money(stats.dueThisWeek, stats.currency) : "—"}
              </div>
              <p className="text-xs text-stone-500 mt-1">
                {stats?.dueThisWeekCount ?? 0} bill
                {stats?.dueThisWeekCount !== 1 ? "s" : ""}
              </p>
            </Card>

            {/* Overdue Bills */}
            <Card padding="md">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">
                  Overdue Bills
                </span>
                <AlertCircle size={16} className="text-rose-500" />
              </div>
              <div className="text-2xl font-semibold text-rose-400 tabular-nums">
                {stats ? fmt.money(stats.overdueBills, stats.currency) : "—"}
              </div>
              <p className="text-xs text-stone-500 mt-1">
                {stats?.overdueBillsCount ?? 0} bill
                {stats?.overdueBillsCount !== 1 ? "s" : ""} past due
              </p>
            </Card>

            {/* Pending Approval */}
            <Card padding="md">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">
                  Pending Approval
                </span>
                <Clock size={16} className="text-blue-500" />
              </div>
              <div className="text-2xl font-semibold text-white tabular-nums">
                {stats ? fmt.money(stats.pendingApproval, stats.currency) : "—"}
              </div>
              <p className="text-xs text-stone-500 mt-1">
                {stats?.pendingApprovalCount ?? 0} awaiting review
              </p>
            </Card>

            {/* Bills On Hold */}
            <Card padding="md">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">
                  Bills On Hold
                </span>
                <PauseCircle size={16} className="text-orange-500" />
              </div>
              <div className="text-2xl font-semibold text-white tabular-nums">
                {stats ? fmt.money(stats.billsOnHold, stats.currency) : "—"}
              </div>
              <p className="text-xs text-stone-500 mt-1">
                {stats?.billsOnHoldCount ?? 0} bill
                {stats?.billsOnHoldCount !== 1 ? "s" : ""}
              </p>
            </Card>

            {/* Ready for Payment */}
            <Card padding="md">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">
                  Ready for Payment
                </span>
                <CheckCircle2 size={16} className="text-emerald-500" />
              </div>
              <div className="text-2xl font-semibold text-emerald-400 tabular-nums">
                {stats ? fmt.money(stats.readyForPayment, stats.currency) : "—"}
              </div>
              <p className="text-xs text-stone-500 mt-1">
                {stats?.readyForPaymentCount ?? 0} approved &amp; ready
              </p>
            </Card>
          </>
        )}
      </div>

      {/* ── AP Aging Table ── */}
      <Card padding="none" className="mb-6">
        <div className="px-5 py-4 border-b border-stone-800">
          <h2 className="text-base font-semibold text-white">AP Aging</h2>
          <p className="text-xs text-stone-500 mt-0.5">
            Bills grouped by days overdue
          </p>
        </div>

        {loading ? (
          <div className="p-5 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : aging.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 text-center">
            <div className="w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center mb-3">
              <FileText size={18} className="text-stone-500" />
            </div>
            <p className="text-sm font-semibold text-white mb-1">No aging data</p>
            <p className="text-xs text-stone-500">All bills are current or no bills exist yet.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold">
                    Supplier
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold">
                    Bill #
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold">
                    Due Date
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] uppercase tracking-wider text-stone-500 font-semibold">
                    Balance
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] uppercase tracking-wider text-stone-500 font-semibold">
                    Aging
                  </th>
                </tr>
              </thead>
              <tbody>
                {aging.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-stone-800 hover:bg-stone-800/40 transition-colors"
                  >
                    <td className="px-4 py-3 font-medium text-white">
                      {row.supplierName}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-stone-400">
                      {row.billNumber}
                    </td>
                    <td className="px-4 py-3 text-stone-300 text-xs whitespace-nowrap">
                      {formatDate(row.dueDate)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-white tabular-nums">
                      {fmt.money(row.balance, row.currency)}
                    </td>
                    <td className="px-4 py-3">
                      {row.agingBucket === "90+" ? (
                        <span
                          className={`inline-flex items-center rounded-md ring-1 ring-inset font-medium text-[11px] px-2 py-0.5 ${agingBadgeClass(row.agingBucket)}`}
                        >
                          90+ days
                        </span>
                      ) : (
                        <Badge variant={agingBadge(row.agingBucket)}>
                          {row.agingBucket === "Current"
                            ? "Current"
                            : `${row.agingBucket} days`}
                        </Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* ── My Approval Tasks ── */}
        <Card padding="none">
          <div className="px-5 py-4 border-b border-stone-800">
            <h2 className="text-base font-semibold text-white">My Approval Tasks</h2>
            <p className="text-xs text-stone-500 mt-0.5">Bills and POs assigned to you</p>
          </div>

          {loading ? (
            <div className="p-5 space-y-3">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : approvalTasks.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center mb-3">
                <CheckCircle2 size={18} className="text-stone-500" />
              </div>
              <p className="text-sm font-semibold text-white mb-1">All clear</p>
              <p className="text-xs text-stone-500">
                No bills or POs waiting for your approval.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-stone-800">
              {approvalTasks.map((task) => (
                <li
                  key={task.id}
                  className="px-5 py-3.5 flex items-center justify-between hover:bg-stone-800/40 transition-colors"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-medium text-sm text-white truncate">
                        {task.supplierName}
                      </span>
                      <Badge variant={task.type === "po" ? "blue" : "neutral"} size="sm">
                        {task.type === "po" ? "PO" : "Bill"}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-stone-400">
                      <span className="font-mono">{task.billNumber}</span>
                      <span>·</span>
                      <span>Due {formatDate(task.dueDate)}</span>
                    </div>
                  </div>
                  <div className="text-right ml-4 shrink-0">
                    <div className="font-semibold text-white tabular-nums text-sm">
                      {fmt.money(task.amount, task.currency)}
                    </div>
                    <div className="text-[11px] text-stone-500 mt-0.5">
                      Assigned {timeAgo(task.assignedAt)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* ── Recent Activity ── */}
        <Card padding="none">
          <div className="px-5 py-4 border-b border-stone-800">
            <h2 className="text-base font-semibold text-white">Recent Activity</h2>
            <p className="text-xs text-stone-500 mt-0.5">Latest actions in Payables</p>
          </div>

          {loading ? (
            <div className="p-5 space-y-3">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          ) : recentActivity.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center mb-3">
                <Activity size={18} className="text-stone-500" />
              </div>
              <p className="text-sm font-semibold text-white mb-1">No activity yet</p>
              <p className="text-xs text-stone-500">
                Actions like syncs, approvals, and payments will appear here.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-stone-800">
              {recentActivity.map((item) => (
                <li key={item.id} className="px-5 py-3 flex items-start gap-3">
                  <div className="mt-0.5 flex-shrink-0 w-5 h-5 rounded-full bg-stone-800 flex items-center justify-center">
                    {activityIcon(item.type)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-stone-200 leading-snug">{item.description}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-stone-500">
                      {item.actor && (
                        <>
                          <User size={10} />
                          <span>{item.actor}</span>
                          <span>·</span>
                        </>
                      )}
                      <span>{timeAgo(item.timestamp)}</span>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
