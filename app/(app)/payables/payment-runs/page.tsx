"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  AlertCircle,
  Loader2,
  RefreshCw,
  Banknote,
} from "lucide-react";
import { Badge, Card, EmptyState } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

type RunStatus =
  | "Draft"
  | "Pending Approval"
  | "Approved"
  | "Scheduled"
  | "Posted"
  | "Cancelled";

interface PaymentRun {
  id: string;
  runNumber: string;
  currency: string;
  scheduledDate: string;
  billCount: number;
  totalAmount: number;
  status: RunStatus;
  createdByName: string;
  approvedByName?: string;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function statusBadge(status: RunStatus): string {
  const map: Record<RunStatus, string> = {
    Draft: "neutral",
    "Pending Approval": "orange",
    Approved: "purple",
    Scheduled: "blue",
    Posted: "green",
    Cancelled: "red",
  };
  return map[status];
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

function AmountStatCard({
  label,
  count,
  amount,
  currency,
  color,
}: {
  label: string;
  count: number;
  amount: number;
  currency: string;
  color: string;
}) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-lg px-4 py-3 flex flex-col gap-1 min-w-[160px]">
      <span className={`text-xl font-bold tabular-nums ${color}`}>{count}</span>
      <span className="text-[11px] text-stone-400 font-medium">{label}</span>
      {amount > 0 && (
        <span className={`text-xs tabular-nums font-medium ${color} opacity-70`}>
          {fmtMoney(amount, currency)}
        </span>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PaymentRunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<PaymentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/payment-runs");
      if (!res.ok) throw new Error("Failed to load payment runs");
      const data = await res.json();
      setRuns(Array.isArray(data) ? data : data.runs ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleNewRun() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/payment-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currency: "USD" }),
      });
      if (!res.ok) throw new Error("Failed to create payment run");
      const data = await res.json();
      const id = data.id ?? data.run?.id;
      if (id) {
        router.push(`/payables/payment-runs/${id}`);
      } else {
        await load();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  const stats = useMemo(() => {
    const defaultCurrency = runs[0]?.currency ?? "USD";
    return {
      draft: {
        count: runs.filter((r) => r.status === "Draft").length,
        amount: runs
          .filter((r) => r.status === "Draft")
          .reduce((s, r) => s + r.totalAmount, 0),
      },
      pendingApproval: {
        count: runs.filter((r) => r.status === "Pending Approval").length,
        amount: runs
          .filter((r) => r.status === "Pending Approval")
          .reduce((s, r) => s + r.totalAmount, 0),
      },
      approved: {
        count: runs.filter((r) => r.status === "Approved").length,
        amount: runs
          .filter((r) => r.status === "Approved")
          .reduce((s, r) => s + r.totalAmount, 0),
      },
      posted: {
        count: runs.filter((r) => r.status === "Posted").length,
        amount: runs
          .filter((r) => r.status === "Posted")
          .reduce((s, r) => s + r.totalAmount, 0),
      },
      currency: defaultCurrency,
    };
  }, [runs]);

  return (
    <div className="p-6 max-w-[1300px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-white tracking-tight">
          Payment Runs
        </h1>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-stone-800 hover:bg-stone-700 text-stone-200 ring-1 ring-stone-700 transition-colors disabled:opacity-50"
          >
            {loading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <RefreshCw size={14} />
            )}
            Refresh
          </button>
          <button
            onClick={handleNewRun}
            disabled={creating}
            className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
          >
            {creating ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={15} />
            )}
            New Payment Run
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <AmountStatCard
          label="Draft"
          count={stats.draft.count}
          amount={stats.draft.amount}
          currency={stats.currency}
          color="text-stone-300"
        />
        <AmountStatCard
          label="Pending Approval"
          count={stats.pendingApproval.count}
          amount={stats.pendingApproval.amount}
          currency={stats.currency}
          color="text-orange-400"
        />
        <AmountStatCard
          label="Approved"
          count={stats.approved.count}
          amount={stats.approved.amount}
          currency={stats.currency}
          color="text-violet-400"
        />
        <AmountStatCard
          label="Posted"
          count={stats.posted.count}
          amount={stats.posted.amount}
          currency={stats.currency}
          color="text-emerald-400"
        />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={14} /> {error}
          <button
            onClick={load}
            className="ml-auto text-rose-300 hover:text-white underline text-xs"
          >
            Retry
          </button>
        </div>
      )}

      <Card padding="none">
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5 space-y-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : runs.length === 0 ? (
            <EmptyState
              icon={Banknote}
              title="No payment runs"
              description="Create a payment run to batch bill payments."
              action={
                <button
                  onClick={handleNewRun}
                  disabled={creating}
                  className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
                >
                  <Plus size={14} />
                  New Payment Run
                </button>
              }
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Run #
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Currency
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Scheduled Date
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Bills
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Total Amount
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Created By
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Approved By
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Created
                  </th>
                </tr>
              </thead>
              <tbody>
                {runs.map((run) => (
                  <tr
                    key={run.id}
                    onClick={() =>
                      router.push(`/payables/payment-runs/${run.id}`)
                    }
                    className="border-b border-stone-800 hover:bg-stone-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-[12px] text-violet-400">
                      {run.runNumber}
                    </td>
                    <td className="px-4 py-3 text-stone-300 font-medium">
                      {run.currency}
                    </td>
                    <td className="px-4 py-3 text-stone-400 text-[13px] whitespace-nowrap">
                      {fmtDate(run.scheduledDate)}
                    </td>
                    <td className="px-4 py-3 text-right text-stone-300 tabular-nums">
                      {run.billCount}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-white tabular-nums text-[13px]">
                      {fmtMoney(run.totalAmount, run.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusBadge(run.status)}>
                        {run.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-stone-400 text-[13px]">
                      {run.createdByName}
                    </td>
                    <td className="px-4 py-3 text-stone-400 text-[13px]">
                      {run.approvedByName ?? (
                        <span className="text-stone-600 italic">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-stone-400 text-[13px] whitespace-nowrap">
                      {fmtDate(run.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>
    </div>
  );
}
