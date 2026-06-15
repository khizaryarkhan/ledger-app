"use client";

import { useState, useEffect, useMemo } from "react";
import {
  AlertCircle,
  Download,
  Loader2,
  BarChart3,
  DollarSign,
  TrendingDown,
  Users,
} from "lucide-react";
import { Badge, Card } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AgingRow {
  supplierId: string;
  supplierName: string;
  current: number;
  days1to30: number;
  days31to60: number;
  days61to90: number;
  days90plus: number;
  total: number;
  currency: string;
}

interface AgingReport {
  rows: AgingRow[];
  totalCurrent: number;
  total1to30: number;
  total31to60: number;
  total61to90: number;
  total90plus: number;
  totalOutstanding: number;
  currency: string;
}

interface CashRow {
  supplierId: string;
  supplierName: string;
  billNumber: string;
  dueDate: string;
  amount: number;
  currency: string;
  daysUntilDue: number;
  workflowStatus: string;
  bucket:
    | "Due Today"
    | "Due This Week"
    | "Due Next 7 Days"
    | "Due Next 30 Days"
    | "Future";
}

interface CashReport {
  rows: CashRow[];
  dueToday: number;
  dueThisWeek: number;
  dueNext7Days: number;
  dueNext30Days: number;
  future: number;
  currency: string;
}

interface PerformanceRow {
  supplierId: string;
  supplierName: string;
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
  avgDaysToApprove: number;
  openQueries: number;
  currency: string;
}

interface PerformanceReport {
  rows: PerformanceRow[];
  currency: string;
}

type ReportTab = "ap-aging" | "cash-requirements" | "supplier-performance";

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function fmtDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

function SummaryCard({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: string;
  color: string;
  icon: any;
}) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-lg px-4 py-3 flex items-center gap-3">
      <div className={`p-2 rounded-md bg-stone-800 ${color}`}>
        <Icon size={16} />
      </div>
      <div>
        <div className={`text-lg font-bold tabular-nums ${color}`}>{value}</div>
        <div className="text-[11px] text-stone-400 font-medium">{label}</div>
      </div>
    </div>
  );
}

function ErrorBanner({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
      <AlertCircle size={14} /> {message}
      <button
        onClick={onRetry}
        className="ml-auto text-rose-300 hover:text-white underline text-xs"
      >
        Retry
      </button>
    </div>
  );
}

// ── CSV Export ────────────────────────────────────────────────────────────────

function exportAgingCSV(report: AgingReport) {
  const headers = [
    "Supplier",
    "Current",
    "1-30 Days",
    "31-60 Days",
    "61-90 Days",
    "90+ Days",
    "Total",
  ];
  const rows = report.rows.map((r) => [
    r.supplierName,
    r.current,
    r.days1to30,
    r.days31to60,
    r.days61to90,
    r.days90plus,
    r.total,
  ]);
  const csv = [headers, ...rows].map((r) => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "ap-aging.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ── AP Aging Tab ─────────────────────────────────────────────────────────────

function AgingTab() {
  const [report, setReport] = useState<AgingReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/reports/ap-aging");
      if (!res.ok) throw new Error("Failed to load AP Aging report");
      const data = await res.json();
      setReport(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!report)
    return (
      <p className="text-stone-500 text-sm py-8 text-center">
        No data available.
      </p>
    );

  const currency = report.currency ?? "USD";

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <SummaryCard
          label="Total Outstanding"
          value={fmtMoney(report.totalOutstanding, currency)}
          color="text-white"
          icon={DollarSign}
        />
        <SummaryCard
          label="Current"
          value={fmtMoney(report.totalCurrent, currency)}
          color="text-emerald-400"
          icon={BarChart3}
        />
        <SummaryCard
          label="1–30 Days"
          value={fmtMoney(report.total1to30, currency)}
          color="text-yellow-400"
          icon={TrendingDown}
        />
        <SummaryCard
          label="31–60 Days"
          value={fmtMoney(report.total31to60, currency)}
          color="text-orange-400"
          icon={TrendingDown}
        />
        <SummaryCard
          label="61–90 Days"
          value={fmtMoney(report.total61to90, currency)}
          color="text-rose-400"
          icon={TrendingDown}
        />
        <SummaryCard
          label="90+ Days"
          value={fmtMoney(report.total90plus, currency)}
          color="text-red-400"
          icon={TrendingDown}
        />
      </div>

      {/* Table */}
      <Card padding="none">
        <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
          <h3 className="text-sm font-semibold text-white">Aging Detail</h3>
          <button
            onClick={() => exportAgingCSV(report)}
            className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-stone-800 hover:bg-stone-700 text-stone-200 ring-1 ring-stone-700 transition-colors"
          >
            <Download size={13} />
            Export CSV
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-800 bg-stone-900/40">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                  Supplier
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-emerald-400 uppercase tracking-wide">
                  Current
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-yellow-400 uppercase tracking-wide">
                  1–30 Days
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-orange-400 uppercase tracking-wide">
                  31–60 Days
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-rose-400 uppercase tracking-wide">
                  61–90 Days
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-red-400 uppercase tracking-wide">
                  90+ Days
                </th>
                <th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-300 uppercase tracking-wide">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row) => (
                <tr
                  key={row.supplierId}
                  className="border-b border-stone-800 last:border-0 hover:bg-stone-800/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-white">
                    {row.supplierName}
                  </td>
                  <td className="px-4 py-3 text-right text-stone-300 tabular-nums text-[13px]">
                    {row.current > 0 ? fmtMoney(row.current, currency) : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-stone-300 tabular-nums text-[13px]">
                    {row.days1to30 > 0
                      ? fmtMoney(row.days1to30, currency)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-stone-300 tabular-nums text-[13px]">
                    {row.days31to60 > 0
                      ? fmtMoney(row.days31to60, currency)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-stone-300 tabular-nums text-[13px]">
                    {row.days61to90 > 0
                      ? fmtMoney(row.days61to90, currency)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[13px]">
                    {row.days90plus > 0 ? (
                      <span className="text-red-400 font-semibold">
                        {fmtMoney(row.days90plus, currency)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-white tabular-nums text-[13px]">
                    {fmtMoney(row.total, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── Cash Requirements Tab ─────────────────────────────────────────────────────

const BUCKET_ORDER: CashRow["bucket"][] = [
  "Due Today",
  "Due This Week",
  "Due Next 7 Days",
  "Due Next 30 Days",
  "Future",
];

function CashTab() {
  const [report, setReport] = useState<CashReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/reports/cash-requirements");
      if (!res.ok) throw new Error("Failed to load Cash Requirements report");
      const data = await res.json();
      setReport(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const grouped = useMemo(() => {
    if (!report) return {};
    const map: Record<string, CashRow[]> = {};
    for (const row of report.rows) {
      if (!map[row.bucket]) map[row.bucket] = [];
      map[row.bucket].push(row);
    }
    return map;
  }, [report]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!report)
    return (
      <p className="text-stone-500 text-sm py-8 text-center">
        No data available.
      </p>
    );

  const currency = report.currency ?? "USD";

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          {
            label: "Due Today",
            value: report.dueToday,
            color: "text-red-400",
          },
          {
            label: "Due This Week",
            value: report.dueThisWeek,
            color: "text-orange-400",
          },
          {
            label: "Due Next 7 Days",
            value: report.dueNext7Days,
            color: "text-yellow-400",
          },
          {
            label: "Due Next 30 Days",
            value: report.dueNext30Days,
            color: "text-blue-400",
          },
          { label: "Future", value: report.future, color: "text-stone-300" },
        ].map((item) => (
          <div
            key={item.label}
            className="bg-stone-900 border border-stone-800 rounded-lg px-4 py-3"
          >
            <div
              className={`text-lg font-bold tabular-nums ${item.color}`}
            >
              {fmtMoney(item.value, currency)}
            </div>
            <div className="text-[11px] text-stone-400 font-medium mt-0.5">
              {item.label}
            </div>
          </div>
        ))}
      </div>

      {/* Grouped table */}
      <div className="space-y-3">
        {BUCKET_ORDER.filter((b) => grouped[b]?.length > 0).map((bucket) => {
          const rows = grouped[bucket];
          const subtotal = rows.reduce((s, r) => s + r.amount, 0);
          return (
            <Card key={bucket} padding="none">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800 bg-stone-900/60">
                <span className="text-xs font-semibold text-stone-300 uppercase tracking-wide">
                  {bucket}
                </span>
                <span className="text-sm font-bold text-white tabular-nums">
                  {fmtMoney(subtotal, currency)}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-stone-800 bg-stone-950/30">
                      <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase tracking-wide">
                        Supplier
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase tracking-wide">
                        Bill #
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase tracking-wide">
                        Due Date
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-stone-500 uppercase tracking-wide">
                        Amount
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase tracking-wide">
                        Currency
                      </th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-stone-500 uppercase tracking-wide">
                        Days
                      </th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-stone-500 uppercase tracking-wide">
                        Status
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, i) => (
                      <tr
                        key={`${row.supplierId}-${row.billNumber}-${i}`}
                        className="border-b border-stone-800 last:border-0 hover:bg-stone-800/20 transition-colors"
                      >
                        <td className="px-4 py-2.5 font-medium text-white text-[13px] max-w-[140px] truncate">
                          {row.supplierName}
                        </td>
                        <td className="px-4 py-2.5 font-mono text-[12px] text-violet-400">
                          {row.billNumber}
                        </td>
                        <td className="px-4 py-2.5 text-stone-400 text-[13px] whitespace-nowrap">
                          {fmtDate(row.dueDate)}
                        </td>
                        <td className="px-4 py-2.5 text-right font-semibold text-white tabular-nums text-[13px]">
                          {fmtMoney(row.amount, row.currency)}
                        </td>
                        <td className="px-4 py-2.5 text-stone-300 text-[13px]">
                          {row.currency}
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-[13px]">
                          {row.daysUntilDue < 0 ? (
                            <span className="text-red-400 font-semibold">
                              {Math.abs(row.daysUntilDue)}d overdue
                            </span>
                          ) : (
                            <span className="text-stone-400">
                              {row.daysUntilDue}d
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center gap-1 rounded-md ring-1 ring-inset font-medium text-[11px] px-2 py-0.5 bg-stone-800 text-stone-300 ring-stone-700">
                            {row.workflowStatus}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          );
        })}
        {Object.keys(grouped).length === 0 && (
          <p className="text-center text-stone-500 text-sm py-10">
            No upcoming cash requirements.
          </p>
        )}
      </div>
    </div>
  );
}

// ── Supplier Performance Tab ──────────────────────────────────────────────────

function PerformanceTab() {
  const [report, setReport] = useState<PerformanceReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/reports/supplier-performance");
      if (!res.ok)
        throw new Error("Failed to load Supplier Performance report");
      const data = await res.json();
      setReport(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const maxBilled = useMemo(
    () => Math.max(...(report?.rows.map((r) => r.totalBilled) ?? [1])),
    [report]
  );

  if (loading) {
    return (
      <div className="space-y-2">
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
    );
  }

  if (error) return <ErrorBanner message={error} onRetry={load} />;
  if (!report || report.rows.length === 0)
    return (
      <p className="text-stone-500 text-sm py-8 text-center">
        No supplier performance data.
      </p>
    );

  const currency = report.currency ?? "USD";

  return (
    <Card padding="none">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-stone-800 bg-stone-900/60">
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                Supplier
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">
                Total Billed
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">
                Total Paid
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">
                Outstanding
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">
                Avg Days to Approve
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">
                Open Queries
              </th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide w-32">
                Billed vs Paid
              </th>
            </tr>
          </thead>
          <tbody>
            {report.rows.map((row) => {
              const billedPct = maxBilled > 0 ? (row.totalBilled / maxBilled) * 100 : 0;
              const paidPct =
                row.totalBilled > 0
                  ? (row.totalPaid / row.totalBilled) * 100
                  : 0;
              return (
                <tr
                  key={row.supplierId}
                  className="border-b border-stone-800 last:border-0 hover:bg-stone-800/30 transition-colors"
                >
                  <td className="px-4 py-3 font-medium text-white max-w-[160px] truncate">
                    {row.supplierName}
                  </td>
                  <td className="px-4 py-3 text-right text-stone-300 tabular-nums text-[13px]">
                    {fmtMoney(row.totalBilled, currency)}
                  </td>
                  <td className="px-4 py-3 text-right text-emerald-400 tabular-nums text-[13px] font-medium">
                    {fmtMoney(row.totalPaid, currency)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[13px]">
                    {row.outstanding > 0 ? (
                      <span className="text-orange-400 font-semibold">
                        {fmtMoney(row.outstanding, currency)}
                      </span>
                    ) : (
                      <span className="text-stone-600">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[13px]">
                    <span
                      className={
                        row.avgDaysToApprove > 5
                          ? "text-orange-400"
                          : "text-stone-300"
                      }
                    >
                      {row.avgDaysToApprove.toFixed(1)}d
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-[13px]">
                    {row.openQueries > 0 ? (
                      <span className="text-rose-400 font-semibold">
                        {row.openQueries}
                      </span>
                    ) : (
                      <span className="text-stone-600">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="w-full h-4 bg-stone-800 rounded-full overflow-hidden relative">
                      <div
                        className="absolute inset-y-0 left-0 bg-stone-600 rounded-full"
                        style={{ width: `${billedPct}%` }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 bg-violet-500 rounded-full"
                        style={{ width: `${(paidPct / 100) * billedPct}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between mt-0.5">
                      <span className="text-[10px] text-stone-500">
                        {paidPct.toFixed(0)}% paid
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const TABS: { id: ReportTab; label: string; icon: any }[] = [
  { id: "ap-aging", label: "AP Aging", icon: TrendingDown },
  { id: "cash-requirements", label: "Cash Requirements", icon: DollarSign },
  { id: "supplier-performance", label: "Supplier Performance", icon: Users },
];

export default function PayablesReportsPage() {
  const [activeTab, setActiveTab] = useState<ReportTab>("ap-aging");

  return (
    <div className="p-6 max-w-[1300px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-white tracking-tight">
          AP Reports
        </h1>
      </div>

      {/* Tab row */}
      <div className="flex items-center gap-1 mb-5 border-b border-stone-800">
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          return (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                active
                  ? "border-violet-500 text-violet-400"
                  : "border-transparent text-stone-400 hover:text-stone-200"
              }`}
            >
              <Icon size={15} />
              {label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "ap-aging" && <AgingTab />}
      {activeTab === "cash-requirements" && <CashTab />}
      {activeTab === "supplier-performance" && <PerformanceTab />}
    </div>
  );
}
