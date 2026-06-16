"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, Badge } from "@/components/ui";
import { fmt } from "@/lib/format";
import { CurrencyPills } from "@/components/currency-pills";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Activity as ActivityIcon,
  RefreshCw,
  Banknote,
  PauseCircle,
  ShoppingCart,
  Receipt,
  ArrowUpRight,
} from "lucide-react";

// ── Types ──────────────────────────────────────────────────────────────────────
interface Money { amount: number; count: number }
interface DashboardData {
  asOf: string;
  currency: string;
  kpis: {
    totalByCcy: Record<string, number>;
    openCount: number;
    overdueByCcy: Record<string, number>;
    overdueCount: number;
    over90: number;
    pendingApproval: number;
    pendingApprovalCount: number;
  };
  approvedToPay: { overdue: Money; thisWeek: Money; thisMonth: Money; pipeline: Money; currency: string };
  aging: { current: number; b1_30: number; b31_60: number; b61_90: number; b90plus: number };
  approvals: {
    id: string; type: "bill" | "po"; entityId: string; number: string;
    supplierName: string; amount: number; currency: string; dueDate: string; createdAt: string;
  }[];
  approvalCounts: { bills: number; pos: number; totalAmount: number; currency: string };
  activity7d: { billsApproved: number; posPushed: number; paymentRuns: number };
  recentActivity: { id: string; description: string; timestamp: string; type: string; actor?: string }[];
}

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function activityIcon(type: string) {
  const map: Record<string, React.ReactNode> = {
    sync: <RefreshCw size={13} className="text-violet-400" />,
    approval: <CheckCircle2 size={13} className="text-emerald-400" />,
    payment: <Banknote size={13} className="text-blue-400" />,
    hold: <PauseCircle size={13} className="text-amber-400" />,
    query: <AlertCircle size={13} className="text-rose-400" />,
  };
  return map[type] ?? <ActivityIcon size={13} className="text-stone-400" />;
}

const Sk = ({ w = "w-28" }: { w?: string }) => <div className={`h-7 ${w} bg-stone-800 animate-pulse rounded mt-1`} />;
const SkSub = () => <div className="h-3 w-20 bg-stone-800 animate-pulse rounded mt-2" />;

export default function PayablesDashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/dashboard");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      setData(await res.json());
    } catch (e: any) {
      setError(e.message || "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const k = data?.kpis;
  const atp = data?.approvedToPay;
  const ag = data?.aging;
  const ccy = data?.currency ?? "EUR";
  const maxBucket = ag ? Math.max(ag.current, ag.b1_30, ag.b31_60, ag.b61_90, ag.b90plus, 1) : 1;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Payables Dashboard</h1>
          <p className="text-sm text-stone-400 mt-1">Overview of payables, aging and approval activity</p>
        </div>
        <div className="text-xs text-stone-500">Last updated {fmt.date(new Date())}</div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-400 text-sm">
          <AlertCircle size={16} />
          {error}
          <button onClick={load} className="ml-auto underline hover:no-underline text-rose-300">Retry</button>
        </div>
      )}

      {/* KPI cards */}
      <div className="grid grid-cols-4 gap-3 mb-3">
        <Link href="/payables/bills">
          <Card padding="md" className="cursor-pointer hover:ring-1 hover:ring-stone-600 transition-all h-full">
            <div className="flex items-center justify-between mb-2">
              <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">Total Payable</div>
              <div className="text-[10px] text-stone-400">As at {fmt.date(new Date())}</div>
            </div>
            {loading ? <><Sk /><SkSub /></> : <>
              <div className="text-2xl font-semibold text-white tracking-tight">
                <CurrencyPills breakdown={k?.totalByCcy ?? {}} stacked />
              </div>
              <div className="mt-2 text-[11px] text-stone-500">{k?.openCount ?? 0} open bills</div>
            </>}
          </Card>
        </Link>
        <Link href="/payables/bills">
          <Card padding="md" className="cursor-pointer hover:ring-1 hover:ring-stone-600 transition-all h-full">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Overdue</div>
            {loading ? <><Sk /><SkSub /></> : <>
              <div className="text-2xl font-semibold text-rose-600 tracking-tight">
                <CurrencyPills breakdown={k?.overdueByCcy ?? {}} />
              </div>
              <div className="mt-2 text-[11px] text-stone-500">{k?.overdueCount ?? 0} overdue bills</div>
            </>}
          </Card>
        </Link>
        <Link href="/payables/bills">
          <Card padding="md" className="cursor-pointer hover:ring-1 hover:ring-stone-600 transition-all h-full">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">90+ Days</div>
            {loading ? <><Sk /><SkSub /></> : <>
              <div className="text-2xl font-semibold text-rose-700 tracking-tight">{fmt.money(k?.over90 ?? 0, ccy)}</div>
              <div className="mt-2 text-[11px] text-stone-500">Escalation candidates</div>
            </>}
          </Card>
        </Link>
        <Link href="/payables/approval-inbox">
          <Card padding="md" className="cursor-pointer hover:ring-1 hover:ring-stone-600 transition-all h-full">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Pending Approval</div>
            {loading ? <><Sk /><SkSub /></> : <>
              <div className="text-2xl font-semibold text-white tracking-tight">{fmt.money(k?.pendingApproval ?? 0, ccy)}</div>
              <div className="mt-2 text-[11px] text-stone-500">{k?.pendingApprovalCount ?? 0} awaiting approval</div>
            </>}
          </Card>
        </Link>
      </div>

      {/* Approved to Pay band */}
      <Card padding="md" className="mb-3">
        <div className="flex items-center justify-between mb-4">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">Approved to Pay</div>
          {!loading && (atp?.overdue.count ?? 0) > 0 && (
            <div className="flex items-center gap-1 text-[11px] text-rose-400 bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded-full">
              <AlertTriangle size={10} /> {atp!.overdue.count} overdue
            </div>
          )}
        </div>
        {loading ? (
          <div className="grid grid-cols-4 gap-4">{[0,1,2,3].map(i => <div key={i}><Sk /><SkSub /></div>)}</div>
        ) : (
          <div className="grid grid-cols-4 gap-4 divide-x divide-stone-800">
            <div className="pr-4">
              <div className="text-[10px] uppercase tracking-wider text-rose-500/80 font-semibold mb-1">Overdue</div>
              <div className={`text-2xl font-semibold tabular-nums tracking-tight ${(atp?.overdue.amount ?? 0) > 0 ? "text-rose-400" : "text-stone-600"}`}>
                {fmt.money(atp?.overdue.amount ?? 0, ccy)}
              </div>
              <div className="mt-1.5 text-[11px] text-stone-500">
                {(atp?.overdue.count ?? 0) === 0 ? "None — all on track" : `${atp!.overdue.count} bill${atp!.overdue.count !== 1 ? "s" : ""} past due`}
              </div>
            </div>
            <div className="px-4">
              <div className="text-[10px] uppercase tracking-wider text-amber-500/80 font-semibold mb-1">This Week</div>
              <div className={`text-2xl font-semibold tabular-nums tracking-tight ${(atp?.thisWeek.amount ?? 0) > 0 ? "text-amber-400" : "text-stone-600"}`}>
                {fmt.money(atp?.thisWeek.amount ?? 0, ccy)}
              </div>
              <div className="mt-1.5 text-[11px] text-stone-500">
                {(atp?.thisWeek.count ?? 0) === 0 ? "Nothing due" : `${atp!.thisWeek.count} bill${atp!.thisWeek.count !== 1 ? "s" : ""} · due ≤7 days`}
              </div>
            </div>
            <div className="px-4">
              <div className="text-[10px] uppercase tracking-wider text-sky-500/80 font-semibold mb-1">This Month</div>
              <div className={`text-2xl font-semibold tabular-nums tracking-tight ${(atp?.thisMonth.amount ?? 0) > 0 ? "text-sky-400" : "text-stone-600"}`}>
                {fmt.money(atp?.thisMonth.amount ?? 0, ccy)}
              </div>
              <div className="mt-1.5 text-[11px] text-stone-500">
                {(atp?.thisMonth.count ?? 0) === 0 ? "Nothing due" : `${atp!.thisMonth.count} bill${atp!.thisMonth.count !== 1 ? "s" : ""} · due 8–30 days`}
              </div>
            </div>
            <div className="pl-4">
              <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">Total Pipeline</div>
              <div className="text-2xl font-semibold tabular-nums tracking-tight text-white">
                {fmt.money(atp?.pipeline.amount ?? 0, ccy)}
              </div>
              <div className="mt-1.5 text-[11px] text-stone-500">{atp?.pipeline.count ?? 0} approved to pay</div>
            </div>
          </div>
        )}
      </Card>

      {/* Pending Approvals panel */}
      <Card padding="none" className="mb-3">
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-white">Pending Approvals</h2>
            <p className="text-xs text-stone-500 mt-0.5">Bills and POs awaiting your approval</p>
          </div>
          <Link href="/payables/approval-inbox" className="text-xs text-stone-400 hover:text-white inline-flex items-center gap-1">
            Open inbox <ArrowUpRight size={12} />
          </Link>
        </div>
        {loading ? (
          <div className="p-5 space-y-3">{[0,1,2].map(i => <div key={i} className="h-12 bg-stone-800 animate-pulse rounded" />)}</div>
        ) : (data?.approvals.length ?? 0) === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <div className="w-10 h-10 rounded-full bg-stone-800 flex items-center justify-center mb-3">
              <CheckCircle2 size={18} className="text-stone-500" />
            </div>
            <p className="text-sm font-semibold text-white mb-1">All clear</p>
            <p className="text-xs text-stone-500">Nothing is waiting for your approval.</p>
          </div>
        ) : (
          <ul className="divide-y divide-stone-800">
            {data!.approvals.map((a) => (
              <li key={a.id}>
                <Link
                  href={a.type === "bill" ? `/payables/bills/${a.entityId}` : `/payables/purchase-orders/${a.entityId}`}
                  className="px-5 py-3 flex items-center justify-between hover:bg-stone-800/40 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {a.type === "bill"
                      ? <Receipt size={15} className="text-stone-400 shrink-0" />
                      : <ShoppingCart size={15} className="text-stone-400 shrink-0" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[12px] text-violet-400">{a.number}</span>
                        <Badge variant={a.type === "po" ? "blue" : "neutral"} size="sm">{a.type === "po" ? "PO" : "Bill"}</Badge>
                      </div>
                      <div className="text-xs text-stone-400 mt-0.5 truncate">{a.supplierName}</div>
                    </div>
                  </div>
                  <div className="text-right ml-4 shrink-0">
                    <div className="font-semibold text-white tabular-nums text-sm">{fmt.money(a.amount, a.currency)}</div>
                    {a.dueDate && <div className="text-[11px] text-stone-500 mt-0.5">Due {fmt.date(a.dueDate)}</div>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Aging buckets + Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        {/* Aging */}
        <Card padding="none" className="lg:col-span-2">
          <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-white">Aging buckets</h2>
              <p className="text-xs text-stone-500 mt-0.5">Outstanding balance grouped by days overdue</p>
            </div>
            <Link href="/payables/reports" className="text-xs text-stone-400 hover:text-white inline-flex items-center gap-1">
              Aging report <ArrowUpRight size={12} />
            </Link>
          </div>
          <div className="p-5 space-y-3">
            {loading ? (
              [0,1,2,3,4].map(i => <div key={i} className="h-7 bg-stone-800 animate-pulse rounded" />)
            ) : (
              ([
                { label: "Current (not due)", val: ag?.current ?? 0, color: "bg-emerald-500" },
                { label: "1-30 days",  val: ag?.b1_30 ?? 0,  color: "bg-amber-400" },
                { label: "31-60 days", val: ag?.b31_60 ?? 0, color: "bg-orange-500" },
                { label: "61-90 days", val: ag?.b61_90 ?? 0, color: "bg-rose-400" },
                { label: "90+ days",   val: ag?.b90plus ?? 0, color: "bg-rose-600" },
              ]).map((b) => (
                <div key={b.label} className="flex items-center gap-3">
                  <div className="w-32 text-xs text-stone-400 shrink-0">{b.label}</div>
                  <div className="flex-1 h-6 bg-stone-800/60 rounded overflow-hidden">
                    <div className={`h-full ${b.color} rounded`} style={{ width: `${(b.val / maxBucket) * 100}%` }} />
                  </div>
                  <div className="w-28 text-right text-sm font-semibold text-white tabular-nums shrink-0">{fmt.money(b.val, ccy)}</div>
                </div>
              ))
            )}
          </div>
        </Card>

        {/* Activity (7 days) */}
        <Card padding="none">
          <div className="px-5 py-4 border-b border-stone-800">
            <h2 className="text-base font-semibold text-white">Activity (7 days)</h2>
            <p className="text-xs text-stone-500 mt-0.5">Recent payables actions</p>
          </div>
          <div className="p-5">
            {loading ? (
              <div className="space-y-3">{[0,1,2].map(i => <div key={i} className="h-8 bg-stone-800 animate-pulse rounded" />)}</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 mb-4">
                  <div className="text-center bg-stone-800/40 rounded-lg py-3">
                    <div className="text-xl font-bold text-emerald-400 tabular-nums">{data?.activity7d.billsApproved ?? 0}</div>
                    <div className="text-[10px] text-stone-500 mt-1">Bills approved</div>
                  </div>
                  <div className="text-center bg-stone-800/40 rounded-lg py-3">
                    <div className="text-xl font-bold text-violet-400 tabular-nums">{data?.activity7d.posPushed ?? 0}</div>
                    <div className="text-[10px] text-stone-500 mt-1">POs pushed</div>
                  </div>
                  <div className="text-center bg-stone-800/40 rounded-lg py-3">
                    <div className="text-xl font-bold text-blue-400 tabular-nums">{data?.activity7d.paymentRuns ?? 0}</div>
                    <div className="text-[10px] text-stone-500 mt-1">Payment runs</div>
                  </div>
                </div>
                {(data?.recentActivity.length ?? 0) === 0 ? (
                  <p className="text-xs text-stone-500 text-center py-4">No activity in the last 7 days.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {data!.recentActivity.map((item) => (
                      <li key={item.id} className="flex items-start gap-2.5">
                        <div className="mt-0.5 w-5 h-5 rounded-full bg-stone-800 flex items-center justify-center shrink-0">
                          {activityIcon(item.type)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] text-stone-200 leading-snug">{item.description}</p>
                          <p className="text-[11px] text-stone-500 mt-0.5">{timeAgo(item.timestamp)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
