"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card } from "@/components/ui";
import { fmt, daysOverdue, daysFromNow } from "@/lib/format";
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, Minus } from "lucide-react";

// ============================================================
// SALES REPORT — Net (Ex VAT) only. Uses invoice.amount field.
// ============================================================

const PERIODS = [
  { id: "this-month",  label: "This Month"   },
  { id: "last-month",  label: "Last Month"   },
  { id: "last-3m",     label: "Last 3M"      },
  { id: "last-6m",     label: "Last 6M"      },
  { id: "ytd",         label: "YTD"          },
  { id: "last-12m",    label: "Last 12M"     },
  { id: "all",         label: "All Time"     },
] as const;
type PeriodId = typeof PERIODS[number]["id"];

function getPeriodRange(id: PeriodId): { from: Date; to: Date; priorFrom: Date; priorTo: Date } {
  const now  = new Date();
  const to   = new Date(now);
  let from: Date, priorFrom: Date, priorTo: Date;

  if (id === "this-month") {
    from      = new Date(now.getFullYear(), now.getMonth(), 1);
    priorFrom = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    priorTo   = new Date(now.getFullYear(), now.getMonth(), 0);
  } else if (id === "last-month") {
    from      = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    to.setDate(0); // last day of last month
    priorFrom = new Date(now.getFullYear(), now.getMonth() - 2, 1);
    priorTo   = new Date(now.getFullYear(), now.getMonth() - 1, 0);
  } else if (id === "last-3m") {
    from      = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    priorFrom = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    priorTo   = new Date(now.getFullYear(), now.getMonth() - 3, 0);
  } else if (id === "last-6m") {
    from      = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    priorFrom = new Date(now.getFullYear(), now.getMonth() - 12, 1);
    priorTo   = new Date(now.getFullYear(), now.getMonth() - 6, 0);
  } else if (id === "ytd") {
    from      = new Date(now.getFullYear(), 0, 1);
    priorFrom = new Date(now.getFullYear() - 1, 0, 1);
    priorTo   = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  } else if (id === "last-12m") {
    from      = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    priorFrom = new Date(now.getFullYear() - 2, now.getMonth(), 1);
    priorTo   = new Date(now.getFullYear() - 1, now.getMonth(), 0);
  } else {
    from      = new Date(2000, 0, 1);
    priorFrom = new Date(2000, 0, 1);
    priorTo   = new Date(2000, 0, 1);
  }
  return { from, to, priorFrom, priorTo };
}

function isSalesInvoice(inv: any) {
  return inv.txnType !== "CreditMemo" && !String(inv.qboId || "").startsWith("CM-");
}

function netAmount(inv: any): number {
  return inv.amount || 0; // Net ex tax — stored in amount field since sync fix
}

function SalesKPI({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: "green" | "red" | "neutral" }) {
  const colour = highlight === "green" ? "text-emerald-600" : highlight === "red" ? "text-rose-600" : "text-stone-900";
  return (
    <div className="bg-white rounded-xl ring-1 ring-stone-200 px-5 py-4">
      <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${colour}`}>{value}</div>
      {sub && <div className="text-[11px] text-stone-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function MiniBar({ pct, color = "bg-stone-800" }: { pct: number; color?: string }) {
  return (
    <div className="w-full h-1.5 bg-stone-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

function SalesReport({ invoices, customers, projects, regions, reps }: any) {
  const [period, setPeriod] = useState<PeriodId>("last-12m");
  const [breakdown, setBreakdown] = useState<"customer" | "rep" | "region">("customer");

  const { from, to, priorFrom, priorTo } = useMemo(() => getPeriodRange(period), [period]);

  const salesInvoices = useMemo(() =>
    invoices.filter((i: any) => isSalesInvoice(i)),
    [invoices]
  );

  const periodInvoices = useMemo(() =>
    salesInvoices.filter((i: any) => {
      const d = new Date(i.invoiceDate);
      return d >= from && d <= to;
    }),
    [salesInvoices, from, to]
  );

  const priorInvoices = useMemo(() =>
    period === "all" ? [] : salesInvoices.filter((i: any) => {
      const d = new Date(i.invoiceDate);
      return d >= priorFrom && d <= priorTo;
    }),
    [salesInvoices, priorFrom, priorTo, period]
  );

  // ── KPIs ────────────────────────────────────────────────────
  const netRevenue   = useMemo(() => periodInvoices.reduce((s: number, i: any) => s + netAmount(i), 0), [periodInvoices]);
  const priorRevenue = useMemo(() => priorInvoices.reduce((s: number, i: any) => s + netAmount(i), 0), [priorInvoices]);
  const growth       = priorRevenue > 0 ? ((netRevenue - priorRevenue) / priorRevenue) * 100 : null;
  const avgInvoice   = periodInvoices.length > 0 ? netRevenue / periodInvoices.length : 0;

  // Open AR for DSO (gross - AR uses total not amount)
  const openAR = useMemo(() =>
    invoices.filter((i: any) => !["Paid","Written Off"].includes(i.paymentStatus) && i.collectionStage !== "Closed")
      .reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0),
    [invoices]
  );
  const net90d = useMemo(() => {
    const d90 = new Date(Date.now() - 90 * 86400000);
    return salesInvoices.filter((i: any) => new Date(i.invoiceDate) >= d90).reduce((s: number, i: any) => s + netAmount(i), 0);
  }, [salesInvoices]);
  const dso = net90d > 0 ? Math.round((openAR / net90d) * 90) : 0;

  // Paid in period / all invoices in period
  const paidInPeriod = periodInvoices.filter((i: any) => i.paymentStatus === "Paid").length;
  const collRate = periodInvoices.length > 0 ? Math.round(paidInPeriod / periodInvoices.length * 100) : 0;

  // ── Monthly trend (last 12 months, always shown) ────────────
  const monthlyTrend = useMemo(() => {
    const months: { label: string; key: string; net: number; prior: number }[] = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const label = d.toLocaleString("default", { month: "short" });
      const priorKey = (() => {
        const pd = new Date(now.getFullYear() - 1, now.getMonth() - i, 1);
        return `${pd.getFullYear()}-${String(pd.getMonth() + 1).padStart(2, "0")}`;
      })();
      const net   = salesInvoices.filter((inv: any) => inv.invoiceDate?.slice(0, 7) === key).reduce((s: number, inv: any) => s + netAmount(inv), 0);
      const prior = salesInvoices.filter((inv: any) => inv.invoiceDate?.slice(0, 7) === priorKey).reduce((s: number, inv: any) => s + netAmount(inv), 0);
      months.push({ label, key, net, prior });
    }
    return months;
  }, [salesInvoices]);

  const maxBar = Math.max(...monthlyTrend.map(m => Math.max(m.net, m.prior)), 1);

  // ── Breakdown ────────────────────────────────────────────────
  const breakdownData = useMemo(() => {
    const map = new Map<string, { label: string; sub?: string; net: number; count: number }>();

    for (const inv of periodInvoices) {
      let key = "", label = "", sub = "";

      if (breakdown === "customer") {
        const c = customers.find((c: any) => c.id === inv.customerId);
        key = inv.customerId; label = c?.name || "Unknown";
      } else if (breakdown === "rep") {
        const c = customers.find((c: any) => c.id === inv.customerId);
        const p = projects.find((p: any) => p.id === inv.projectId);
        const repId = c?.repId || p?.repId || "unassigned";
        const rep = reps?.find((r: any) => r.id === repId);
        key = repId; label = rep?.name || "Unassigned";
      } else {
        const c = customers.find((c: any) => c.id === inv.customerId);
        const p = projects.find((p: any) => p.id === inv.projectId);
        const regId = c?.regionId || p?.regionId || "none";
        const reg = regions?.find((r: any) => r.id === regId);
        key = regId; label = reg?.name || "No Region";
      }

      if (!map.has(key)) map.set(key, { label, sub, net: 0, count: 0 });
      const e = map.get(key)!;
      e.net += netAmount(inv);
      e.count += 1;
    }

    return Array.from(map.values()).sort((a, b) => b.net - a.net);
  }, [periodInvoices, breakdown, customers, projects, reps, regions]);

  const maxBreakdown = Math.max(...breakdownData.map(r => r.net), 1);

  const growthColor = growth === null ? "neutral" : growth >= 0 ? "green" : "red";
  const GrowthIcon  = growth === null ? Minus : growth >= 0 ? TrendingUp : TrendingDown;

  return (
    <div className="p-6 space-y-6">
      {/* Net label */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-stone-500 bg-stone-100 px-3 py-1.5 rounded-full">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
          All values shown <strong>Net (Ex VAT)</strong> — using invoice subtotal ex tax
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl">
          {PERIODS.map(p => (
            <button key={p.id} onClick={() => setPeriod(p.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${period === p.id ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-900"}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-6 gap-3">
        <SalesKPI
          label="Net Revenue"
          value={fmt.money(netRevenue)}
          sub={`${periodInvoices.length} invoices`}
        />
        <SalesKPI
          label="vs Prior Period"
          value={growth !== null ? `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%` : "—"}
          sub={period !== "all" ? fmt.money(priorRevenue) : "No comparison"}
          highlight={growthColor}
        />
        <SalesKPI
          label="Avg Invoice (Net)"
          value={fmt.money(avgInvoice)}
          sub={`${periodInvoices.length} invoices`}
        />
        <SalesKPI
          label="Invoice Count"
          value={String(periodInvoices.length)}
          sub={`${paidInPeriod} paid`}
        />
        <SalesKPI
          label="Collection Rate"
          value={`${collRate}%`}
          sub="Paid in period"
          highlight={collRate >= 80 ? "green" : collRate >= 50 ? "neutral" : "red"}
        />
        <SalesKPI
          label="DSO"
          value={`${dso} days`}
          sub="Open AR / Net 90d sales"
          highlight={dso <= 45 ? "green" : dso <= 90 ? "neutral" : "red"}
        />
      </div>

      {/* Monthly trend */}
      <div className="bg-white rounded-xl ring-1 ring-stone-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-semibold text-stone-900">Monthly Net Revenue</div>
            <div className="text-[11px] text-stone-400 mt-0.5">Last 12 months vs prior year</div>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-stone-500">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-stone-800" /> This year</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-stone-200" /> Prior year</div>
          </div>
        </div>
        <div className="flex items-end gap-1.5 h-48">
          {monthlyTrend.map((m, i) => (
            <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
              {/* Tooltip */}
              <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 bg-stone-900 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap">
                <div className="font-semibold">{m.label}</div>
                <div>This yr: {fmt.money(m.net)}</div>
                <div>Prior yr: {fmt.money(m.prior)}</div>
              </div>
              <div className="flex-1 flex items-end gap-0.5 w-full justify-center">
                {/* Prior year bar */}
                <div className="bg-stone-200 rounded-t w-2.5 transition-all"
                  style={{ height: m.prior > 0 ? `${(m.prior / maxBar) * 100}%` : "2px" }} />
                {/* Current year bar */}
                <div className={`rounded-t w-2.5 transition-all ${m.net >= m.prior ? "bg-stone-800" : "bg-rose-400"}`}
                  style={{ height: m.net > 0 ? `${(m.net / maxBar) * 100}%` : "2px" }} />
              </div>
              <div className="text-[9px] text-stone-400 font-medium">{m.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Breakdown table */}
      <div className="bg-white rounded-xl ring-1 ring-stone-200 overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
          <div className="text-sm font-semibold text-stone-900">
            Revenue by {breakdown === "customer" ? "Customer" : breakdown === "rep" ? "Rep" : "Region"}
          </div>
          <div className="flex items-center gap-1 bg-stone-100 p-0.5 rounded-lg">
            {(["customer", "rep", "region"] as const).map(b => (
              <button key={b} onClick={() => setBreakdown(b)}
                className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors capitalize ${breakdown === b ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"}`}>
                {b === "customer" ? "Customer" : b === "rep" ? "Rep" : "Region"}
              </button>
            ))}
          </div>
        </div>

        {breakdownData.length === 0 ? (
          <div className="px-5 py-8 text-center text-stone-400 text-sm">No sales data for this period</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-stone-400 border-b border-stone-100">
                <th className="text-left font-semibold px-5 py-3">#</th>
                <th className="text-left font-semibold px-3 py-3">{breakdown === "customer" ? "Customer" : breakdown === "rep" ? "Rep" : "Region"}</th>
                <th className="text-right font-semibold px-3 py-3">Net Revenue</th>
                <th className="text-right font-semibold px-3 py-3">Invoices</th>
                <th className="text-right font-semibold px-3 py-3">Avg Invoice</th>
                <th className="text-right font-semibold px-3 py-3">% of Total</th>
                <th className="px-5 py-3 w-40"></th>
              </tr>
            </thead>
            <tbody>
              {breakdownData.map((r, i) => {
                const pct = netRevenue > 0 ? (r.net / netRevenue) * 100 : 0;
                const avg = r.count > 0 ? r.net / r.count : 0;
                return (
                  <tr key={i} className="border-b border-stone-50 hover:bg-stone-50">
                    <td className="px-5 py-3 text-stone-300 text-[11px] font-mono">{String(i + 1).padStart(2, "0")}</td>
                    <td className="px-3 py-3 font-medium text-stone-900 max-w-[220px] truncate">{r.label}</td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums text-stone-900">{fmt.money(r.net)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-stone-500">{r.count}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-stone-500">{fmt.money(avg)}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-stone-500">{pct.toFixed(1)}%</td>
                    <td className="px-5 py-3">
                      <MiniBar pct={pct} color={i === 0 ? "bg-stone-800" : i < 3 ? "bg-stone-500" : "bg-stone-300"} />
                    </td>
                  </tr>
                );
              })}
              {/* Total row */}
              <tr className="bg-stone-900 text-white">
                <td className="px-5 py-3 text-stone-400 text-[11px] font-mono">—</td>
                <td className="px-3 py-3 font-bold text-sm">TOTAL</td>
                <td className="px-3 py-3 text-right font-bold tabular-nums text-sm">{fmt.money(netRevenue)}</td>
                <td className="px-3 py-3 text-right font-bold tabular-nums text-sm">{periodInvoices.length}</td>
                <td className="px-3 py-3 text-right font-bold tabular-nums text-sm">{fmt.money(avgInvoice)}</td>
                <td className="px-3 py-3 text-right font-bold">100%</td>
                <td className="px-5 py-3" />
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const BUCKETS = ["Current", "1-30", "31-60", "61-90", "90+"];
const BUCKET_LABELS: Record<string, string> = {
  "Current": "CURRENT", "1-30": "1 - 30", "31-60": "31 - 60", "61-90": "61 - 90", "90+": "91 AND OVER"
};

function getBucket(inv: any): string {
  if (inv.paymentStatus === "Paid") return "";
  const d = daysOverdue(inv.dueDate);
  if (d <= 0) return "Current";
  if (d <= 30) return "1-30";
  if (d <= 60) return "31-60";
  if (d <= 90) return "61-90";
  return "90+";
}

function emptyBuckets() {
  return { "Current": 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0, total: 0 };
}

function addBuckets(a: any, b: any) {
  const r = { ...a };
  BUCKETS.forEach(k => { r[k] = (r[k] || 0) + (b[k] || 0); });
  r.total = (r.total || 0) + (b.total || 0);
  return r;
}

function invBuckets(inv: any) {
  const b = emptyBuckets();
  if (inv.paymentStatus === "Paid" || inv.collectionStage === "Closed") return b;
  const out = inv.total - (inv.paid || 0);
  if (out <= 0) return b;
  const bucket = getBucket(inv);
  if (bucket) { b[bucket] = out; b.total = out; }
  return b;
}

function BucketCell({ value, highlight }: { value: number; highlight?: boolean }) {
  if (!value || value === 0) return <td className="px-3 py-2 text-right text-stone-300">—</td>;
  return (
    <td className={`px-3 py-2 text-right tabular-nums text-sm ${highlight ? "font-semibold text-stone-900" : "text-stone-700"}`}>
      {fmt.money(value)}
    </td>
  );
}

// ============================================================
// BY CUSTOMER VIEW — matches QBO AR Aging Summary
// ============================================================
function AgingByCustomer({ invoices, customers, projects, regionFilter }: any) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const data = useMemo(() => {
    const custMap: Record<string, { customer: any; projects: Record<string, { project: any; invoices: any[]; buckets: any }>; directInvoices: any[]; totals: any }> = {};

    for (const inv of invoices) {
      if (inv.paymentStatus === "Paid" || inv.collectionStage === "Closed") continue;
      if ((inv.total - (inv.paid || 0)) <= 0) continue;

      // Region filter: check project code OR name (QBO projects have code=QBO-PROJ-xxx, name=D25010-...)
      const cust = customers.find((c: any) => c.id === inv.customerId);
      if (!cust) continue;

      if (regionFilter) {
        const proj = projects.find((p: any) => p.id === inv.projectId);
        const inRegion = cust.regionId === regionFilter || proj?.regionId === regionFilter;
        if (!inRegion) continue;
      }

      if (!custMap[cust.id]) {
        custMap[cust.id] = { customer: cust, projects: {}, directInvoices: [], totals: emptyBuckets() };
      }

      const b = invBuckets(inv);
      custMap[cust.id].totals = addBuckets(custMap[cust.id].totals, b);

      if (inv.projectId) {
        const proj = projects.find((p: any) => p.id === inv.projectId);
        const projId = inv.projectId;
        if (!custMap[cust.id].projects[projId]) {
          custMap[cust.id].projects[projId] = { project: proj, invoices: [], buckets: emptyBuckets() };
        }
        custMap[cust.id].projects[projId].invoices.push(inv);
        custMap[cust.id].projects[projId].buckets = addBuckets(custMap[cust.id].projects[projId].buckets, b);
      } else {
        custMap[cust.id].directInvoices.push(inv);
      }
    }

    return Object.values(custMap).sort((a, b) => b.totals.total - a.totals.total);
  }, [invoices, customers, projects, regionFilter]);

  // Grand totals
  const grandTotals = useMemo(() => data.reduce((acc, r) => addBuckets(acc, r.totals), emptyBuckets()), [data]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-stone-200">
            <th className="text-left font-semibold px-4 py-3 text-stone-600 uppercase text-[11px] tracking-wider w-1/3">Customer / Project</th>
            {BUCKETS.map(b => <th key={b} className="text-right font-semibold px-3 py-3 text-stone-600 uppercase text-[11px] tracking-wider">{BUCKET_LABELS[b]}</th>)}
            <th className="text-right font-semibold px-4 py-3 text-stone-600 uppercase text-[11px] tracking-wider">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.map(({ customer, projects: projMap, directInvoices, totals }) => {
            const isOpen = expanded.has(customer.id);
            const hasProjects = Object.keys(projMap).length > 0 || directInvoices.length > 0;

            return [
              // Customer row
              <tr key={`cust-${customer.id}`}
                className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer"
                onClick={() => hasProjects && toggle(customer.id)}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    {hasProjects
                      ? isOpen ? <ChevronDown size={14} className="text-stone-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-stone-400 flex-shrink-0" />
                      : <span className="w-3.5" />}
                    <span className="font-semibold text-stone-900">{customer.name}</span>
                  </div>
                </td>
                {BUCKETS.map(b => <BucketCell key={b} value={totals[b]} highlight />)}
                <td className="px-4 py-2.5 text-right font-bold text-stone-900 tabular-nums">{fmt.money(totals.total)}</td>
              </tr>,

              // Expanded: projects
              ...(isOpen ? [
                // Direct invoices (no project)
                ...directInvoices.map(inv => {
                  const b = invBuckets(inv);
                  return (
                    <tr key={`inv-${inv.id}`} className="border-b border-stone-50 bg-stone-50/50 hover:bg-stone-50">
                      <td className="px-4 py-1.5">
                        <div className="flex items-center gap-2 pl-6">
                          <Link href={`/invoices/${inv.id}`} className="text-[12px] text-stone-600 hover:text-stone-900 hover:underline font-mono">
                            {inv.invoiceNumber}
                          </Link>
                          <span className="text-[11px] text-stone-400">· Due {inv.dueDate}</span>
                        </div>
                      </td>
                      {BUCKETS.map(bk => <BucketCell key={bk} value={b[bk]} />)}
                      <td className="px-4 py-1.5 text-right tabular-nums text-[12px] text-stone-700">{fmt.money(b.total)}</td>
                    </tr>
                  );
                }),

                // Projects
                ...Object.values(projMap).sort((a: any, b: any) => b.buckets.total - a.buckets.total).map(({ project, invoices: projInvs, buckets: pb }: any) => [
                  // Project subtotal row
                  <tr key={`proj-${project?.id}`} className="border-b border-stone-100 bg-stone-50/50">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2 pl-6">
                        <span className="text-[12px] font-medium text-stone-700">{project?.name || "Unknown Project"}</span>
                        <span className="text-[10px] text-stone-400 font-mono">{project?.code}</span>
                      </div>
                    </td>
                    {BUCKETS.map(b => <BucketCell key={b} value={pb[b]} />)}
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-[12px] text-stone-800">{fmt.money(pb.total)}</td>
                  </tr>,

                  // Individual invoices under project
                  ...projInvs.sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).map((inv: any) => {
                    const ib = invBuckets(inv);
                    return (
                      <tr key={`inv-${inv.id}`} className="border-b border-stone-50 hover:bg-blue-50/30">
                        <td className="px-4 py-1.5">
                          <div className="flex items-center gap-2 pl-12">
                            <Link href={`/invoices/${inv.id}`} className="text-[11px] text-stone-500 hover:text-stone-900 hover:underline font-mono">
                              {inv.invoiceNumber}
                            </Link>
                            <span className="text-[10px] text-stone-400">· Due {inv.dueDate}</span>
                          </div>
                        </td>
                        {BUCKETS.map(bk => <BucketCell key={bk} value={ib[bk]} />)}
                        <td className="px-4 py-1.5 text-right tabular-nums text-[11px] text-stone-600">{fmt.money(ib.total)}</td>
                      </tr>
                    );
                  }),
                ]).flat(),

                // Customer total row
                <tr key={`cust-total-${customer.id}`} className="border-b-2 border-stone-200 bg-stone-100/50">
                  <td className="px-4 py-2 pl-4">
                    <span className="text-[12px] font-bold text-stone-700">Total for {customer.name}</span>
                  </td>
                  {BUCKETS.map(b => <td key={b} className="px-3 py-2 text-right text-[12px] font-bold tabular-nums text-stone-800">{totals[b] > 0 ? fmt.money(totals[b]) : "—"}</td>)}
                  <td className="px-4 py-2 text-right text-[12px] font-bold tabular-nums text-stone-900">{fmt.money(totals.total)}</td>
                </tr>,
              ] : [])
            ];
          })}

          {/* Grand total */}
          <tr className="bg-stone-900 text-white">
            <td className="px-4 py-3 font-bold text-sm">TOTAL</td>
            {BUCKETS.map(b => (
              <td key={b} className="px-3 py-3 text-right font-bold tabular-nums text-sm">
                {grandTotals[b] > 0 ? fmt.money(grandTotals[b]) : "—"}
              </td>
            ))}
            <td className="px-4 py-3 text-right font-bold tabular-nums text-sm">{fmt.money(grandTotals.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// BY PROJECT VIEW
// ============================================================
function AgingByProject({ invoices, customers, projects, regionFilter }: any) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const data = useMemo(() => {
    const projMap: Record<string, { project: any; customer: any; invoices: any[]; buckets: any }> = {};

    for (const inv of invoices) {
      if (inv.paymentStatus === "Paid" || inv.collectionStage === "Closed") continue;
      if ((inv.total - (inv.paid || 0)) <= 0) continue;
      if (!inv.projectId) continue;

      const proj = projects.find((p: any) => p.id === inv.projectId);

      // Region filter: check project code OR name
      if (regionFilter) {
        const cust2 = customers.find((c: any) => c.id === inv.customerId);
        if (cust2?.regionId !== regionFilter && proj?.regionId !== regionFilter) continue;
      }
      const cust = customers.find((c: any) => c.id === inv.customerId);
      if (!proj) continue;

      if (!projMap[proj.id]) projMap[proj.id] = { project: proj, customer: cust, invoices: [], buckets: emptyBuckets() };
      const b = invBuckets(inv);
      projMap[proj.id].invoices.push(inv);
      projMap[proj.id].buckets = addBuckets(projMap[proj.id].buckets, b);
    }

    return Object.values(projMap).sort((a, b) => b.buckets.total - a.buckets.total);
  }, [invoices, customers, projects, regionFilter]);

  const grandTotals = useMemo(() => data.reduce((acc, r) => addBuckets(acc, r.buckets), emptyBuckets()), [data]);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b-2 border-stone-200">
            <th className="text-left font-semibold px-4 py-3 text-stone-600 uppercase text-[11px] tracking-wider w-1/3">Project / Invoice</th>
            {BUCKETS.map(b => <th key={b} className="text-right font-semibold px-3 py-3 text-stone-600 uppercase text-[11px] tracking-wider">{BUCKET_LABELS[b]}</th>)}
            <th className="text-right font-semibold px-4 py-3 text-stone-600 uppercase text-[11px] tracking-wider">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.map(({ project, customer, invoices: projInvs, buckets }) => {
            const isOpen = expanded.has(project.id);
            return [
              <tr key={`proj-${project.id}`} className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer" onClick={() => toggle(project.id)}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown size={14} className="text-stone-400" /> : <ChevronRight size={14} className="text-stone-400" />}
                    <div>
                      <div className="font-semibold text-stone-900">{project.name}</div>
                      <div className="text-[10px] text-stone-400 font-mono mt-0.5">{project.code} · {customer?.name}</div>
                    </div>
                  </div>
                </td>
                {BUCKETS.map(b => <BucketCell key={b} value={buckets[b]} highlight />)}
                <td className="px-4 py-2.5 text-right font-bold text-stone-900 tabular-nums">{fmt.money(buckets.total)}</td>
              </tr>,

              ...(isOpen ? projInvs.sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).map((inv: any) => {
                const ib = invBuckets(inv);
                return (
                  <tr key={`inv-${inv.id}`} className="border-b border-stone-50 bg-stone-50/50 hover:bg-blue-50/30">
                    <td className="px-4 py-1.5">
                      <div className="flex items-center gap-2 pl-7">
                        <Link href={`/invoices/${inv.id}`} className="text-[11px] text-stone-500 hover:text-stone-900 hover:underline font-mono">{inv.invoiceNumber}</Link>
                        <span className="text-[10px] text-stone-400">· Due {inv.dueDate}</span>
                      </div>
                    </td>
                    {BUCKETS.map(bk => <BucketCell key={bk} value={ib[bk]} />)}
                    <td className="px-4 py-1.5 text-right tabular-nums text-[11px] text-stone-600">{fmt.money(ib.total)}</td>
                  </tr>
                );
              }) : [])
            ];
          })}

          <tr className="bg-stone-900 text-white">
            <td className="px-4 py-3 font-bold text-sm">TOTAL</td>
            {BUCKETS.map(b => <td key={b} className="px-3 py-3 text-right font-bold tabular-nums text-sm">{grandTotals[b] > 0 ? fmt.money(grandTotals[b]) : "—"}</td>)}
            <td className="px-4 py-3 text-right font-bold tabular-nums text-sm">{fmt.money(grandTotals.total)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// ACTIVITY REPORT
// ============================================================
function ActivityReport({ communications }: any) {
  const activity = useMemo(() => {
    const days: { date: string; sent: number; received: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const day = d.toISOString().slice(0, 10);
      const start = new Date(day).getTime();
      const end = start + 86400000;
      const sent = communications.filter((c: any) => c.direction === "Outbound" && c.channel === "Email" && new Date(c.sentAt).getTime() >= start && new Date(c.sentAt).getTime() < end).length;
      const received = communications.filter((c: any) => c.direction === "Inbound" && new Date(c.sentAt).getTime() >= start && new Date(c.sentAt).getTime() < end).length;
      days.push({ date: day, sent, received });
    }
    return days;
  }, [communications]);

  const maxActivity = Math.max(1, ...activity.map(d => Math.max(d.sent, d.received)));

  return (
    <Card>
      <h3 className="text-sm font-semibold text-stone-900 mb-4">Email activity (last 14 days)</h3>
      <div className="flex items-end gap-1 h-48 mb-3">
        {activity.map((d, i) => (
          <div key={i} className="flex-1 flex flex-col items-center gap-1">
            <div className="flex-1 flex items-end gap-0.5 w-full justify-center">
              <div className="bg-stone-900 rounded-t w-2.5" style={{ height: `${(d.sent / maxActivity) * 100}%` }} title={`${d.sent} sent`} />
              <div className="bg-emerald-500 rounded-t w-2.5" style={{ height: `${(d.received / maxActivity) * 100}%` }} title={`${d.received} received`} />
            </div>
            <div className="text-[9px] text-stone-500">{new Date(d.date).getDate()}</div>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-4 text-xs text-stone-600 pt-3 border-t border-stone-100">
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-stone-900" /> Sent ({activity.reduce((s, d) => s + d.sent, 0)})</div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-emerald-500" /> Received ({activity.reduce((s, d) => s + d.received, 0)})</div>
      </div>
    </Card>
  );
}


// ============================================================
// REGIONAL AR REPORT — Management view
// ============================================================
function RegionalReport({ invoices, customers, projects, regions, regionFilter }: any) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const data = useMemo(() => {
    const regionMap: Record<string, {
      region: string;
      invoices: any[];
      buckets: any;
      customers: Set<string>;
      overdueCount: number;
    }> = {};

    for (const inv of invoices) {
      if (inv.paymentStatus === "Paid" || inv.collectionStage === "Closed") continue;
      const out = inv.total - (inv.paid || 0);
      if (out <= 0) continue;

      const proj = projects.find((p: any) => p.id === inv.projectId);
      const cust3 = customers.find((c: any) => c.id === inv.customerId);
      if (regionFilter) {
        if (cust3?.regionId !== regionFilter && proj?.regionId !== regionFilter) continue;
      }
      const regionId = cust3?.regionId || proj?.regionId || null;
      const regionLabel = (regions ?? []).find((r: any) => r.id === regionId)?.name || "Other";

      if (!regionMap[regionLabel]) {
        regionMap[regionLabel] = { region: regionLabel, invoices: [], buckets: emptyBuckets(), customers: new Set(), overdueCount: 0 };
      }

      regionMap[regionLabel].invoices.push(inv);
      regionMap[regionLabel].buckets = addBuckets(regionMap[regionLabel].buckets, invBuckets(inv));
      regionMap[regionLabel].customers.add(inv.customerId);
      if (daysOverdue(inv.dueDate) > 0) regionMap[regionLabel].overdueCount++;
    }

    return Object.values(regionMap).sort((a, b) => b.buckets.total - a.buckets.total);
  }, [invoices, projects]);

  const grandTotal = useMemo(() => data.reduce((acc, r) => addBuckets(acc, r.buckets), emptyBuckets()), [data]);
  const maxTotal = Math.max(...data.map(r => r.buckets.total), 1);

  return (
    <div className="p-4 space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-5 gap-3">
        {data.map(r => {
          const overduePct = r.buckets.total > 0 ? ((r.buckets["1-30"] + r.buckets["31-60"] + r.buckets["61-90"] + r.buckets["90+"]) / r.buckets.total * 100) : 0;
          return (
            <div key={r.region} className="bg-white rounded-lg ring-1 ring-stone-200 p-4 cursor-pointer hover:ring-stone-300"
              onClick={() => toggle(r.region)}>
              <div className="flex items-start justify-between mb-2">
                <div className="text-sm font-semibold text-stone-900">{r.region}</div>
                {overduePct > 50 && <span className="text-[10px] px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded font-medium">High risk</span>}
                {overduePct > 20 && overduePct <= 50 && <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">Watch</span>}
              </div>
              <div className="text-xl font-bold text-stone-900 tabular-nums mb-1">{fmt.money(r.buckets.total)}</div>
              <div className="text-[11px] text-stone-500 mb-3">{r.customers.size} customers · {r.invoices.length} invoices</div>

              {/* Aging bar */}
              <div className="h-1.5 rounded-full overflow-hidden flex gap-px mb-2">
                {AGING_COLORS_REG.map(({ key, color }) => {
                  const pct = r.buckets.total > 0 ? (r.buckets[key] || 0) / r.buckets.total * 100 : 0;
                  if (pct === 0) return null;
                  return <div key={key} className={`${color} h-full`} style={{ width: `${pct}%` }} />;
                })}
              </div>
              <div className="text-[10px] text-stone-500">
                {overduePct.toFixed(0)}% overdue · {r.overdueCount} invoices
              </div>

              {/* Bar vs total */}
              <div className="mt-2 h-1 bg-stone-100 rounded-full">
                <div className="h-full bg-stone-700 rounded-full" style={{ width: `${r.buckets.total / maxTotal * 100}%` }} />
              </div>
              <div className="text-[10px] text-stone-400 mt-1">{(r.buckets.total / grandTotal.total * 100).toFixed(1)}% of total AR</div>
            </div>
          );
        })}
      </div>

      {/* Detailed breakdown when expanded */}
      {data.map(r => expanded.has(r.region) && (
        <div key={r.region} className="ring-1 ring-stone-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
            <div className="font-semibold text-stone-900">{r.region} — Detailed Aging</div>
            <div className="font-bold text-stone-900 tabular-nums">{fmt.money(r.buckets.total)}</div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
              <th className="text-left font-semibold px-4 py-2">Customer</th>
              <th className="text-left font-semibold px-3 py-2">Project</th>
              <th className="text-left font-semibold px-3 py-2">Invoice</th>
              <th className="text-left font-semibold px-3 py-2">Due</th>
              {BUCKETS.map(b => <th key={b} className="text-right font-semibold px-3 py-2">{BUCKET_LABELS[b]}</th>)}
              <th className="text-right font-semibold px-4 py-2">Total</th>
            </tr></thead>
            <tbody>
              {r.invoices.sort((a: any, b: any) => (b.total - (b.paid||0)) - (a.total - (a.paid||0))).map((inv: any) => {
                const cust = customers.find((c: any) => c.id === inv.customerId);
                const proj = projects.find((p: any) => p.id === inv.projectId);
                const ib = invBuckets(inv);
                return (
                  <tr key={inv.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-2 text-[12px] text-stone-700">{cust?.name}</td>
                    <td className="px-3 py-2 text-[11px] text-stone-500 font-mono">{proj?.code || "—"}</td>
                    <td className="px-3 py-2"><Link href={`/invoices/${inv.id}`} className="text-[11px] font-mono text-blue-600 hover:underline">{inv.invoiceNumber}</Link></td>
                    <td className="px-3 py-2 text-[11px] text-stone-500">{inv.dueDate}</td>
                    {BUCKETS.map(bk => <BucketCell key={bk} value={ib[bk]} />)}
                    <td className="px-4 py-2 text-right font-semibold text-[12px] tabular-nums">{fmt.money(ib.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* Grand total table */}
      <div className="ring-1 ring-stone-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 font-semibold text-stone-900">Regional Summary</div>
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
            <th className="text-left font-semibold px-4 py-2.5">Region</th>
            <th className="text-right font-semibold px-3 py-2.5">Customers</th>
            <th className="text-right font-semibold px-3 py-2.5">Invoices</th>
            {BUCKETS.map(b => <th key={b} className="text-right font-semibold px-3 py-2.5">{BUCKET_LABELS[b]}</th>)}
            <th className="text-right font-semibold px-4 py-2.5">Total</th>
            <th className="text-right font-semibold px-4 py-2.5">% of AR</th>
          </tr></thead>
          <tbody>
            {data.map(r => (
              <tr key={r.region} className="border-b border-stone-100 hover:bg-stone-50">
                <td className="px-4 py-2.5 font-medium text-stone-900">{r.region}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.customers.size}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.invoices.length}</td>
                {BUCKETS.map(b => <BucketCell key={b} value={r.buckets[b]} />)}
                <td className="px-4 py-2.5 text-right font-bold tabular-nums">{fmt.money(r.buckets.total)}</td>
                <td className="px-4 py-2.5 text-right text-stone-500 tabular-nums">{grandTotal.total > 0 ? (r.buckets.total / grandTotal.total * 100).toFixed(1) : 0}%</td>
              </tr>
            ))}
            <tr className="bg-stone-900 text-white">
              <td className="px-4 py-3 font-bold">TOTAL</td>
              <td className="px-3 py-3 text-right font-bold">{data.reduce((s, r) => s + r.customers.size, 0)}</td>
              <td className="px-3 py-3 text-right font-bold">{data.reduce((s, r) => s + r.invoices.length, 0)}</td>
              {BUCKETS.map(b => <td key={b} className="px-3 py-3 text-right font-bold tabular-nums">{grandTotal[b] > 0 ? fmt.money(grandTotal[b]) : "—"}</td>)}
              <td className="px-4 py-3 text-right font-bold tabular-nums">{fmt.money(grandTotal.total)}</td>
              <td className="px-4 py-3 text-right font-bold">100%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================
// BY REP REPORT — matches RegionalReport style
// ============================================================
function AgingByRep({ invoices, customers, projects, reps, regionFilter }: any) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const data = useMemo(() => {
    const repMap: Record<string, { rep: any; invoices: any[]; buckets: any; custSet: Set<string>; overdueCount: number }> = {};

    for (const inv of invoices) {
      if (inv.paymentStatus === "Paid" || inv.collectionStage === "Closed") continue;
      const out = inv.total - (inv.paid || 0);
      if (out <= 0) continue;

      const cust = customers.find((c: any) => c.id === inv.customerId);
      const proj = projects.find((p: any) => p.id === inv.projectId);

      if (regionFilter) {
        if (cust?.regionId !== regionFilter && proj?.regionId !== regionFilter) continue;
      }

      const repId = cust?.repId || proj?.repId || "unassigned";
      const rep = reps.find((r: any) => r.id === repId) || { id: "unassigned", name: "Unassigned" };

      if (!repMap[repId]) repMap[repId] = { rep, invoices: [], buckets: emptyBuckets(), custSet: new Set(), overdueCount: 0 };
      repMap[repId].invoices.push(inv);
      repMap[repId].buckets = addBuckets(repMap[repId].buckets, invBuckets(inv));
      repMap[repId].custSet.add(inv.customerId);
      if (daysOverdue(inv.dueDate) > 0) repMap[repId].overdueCount++;
    }

    return Object.values(repMap).sort((a, b) => b.buckets.total - a.buckets.total);
  }, [invoices, customers, projects, reps, regionFilter]);

  const grandTotal = useMemo(() => data.reduce((acc, r) => addBuckets(acc, r.buckets), emptyBuckets()), [data]);
  const maxTotal = Math.max(...data.map(r => r.buckets.total), 1);

  return (
    <div className="p-4 space-y-4">
      {/* Summary cards — same layout as RegionalReport */}
      <div className="grid grid-cols-5 gap-3">
        {data.map(r => {
          const overduePct = r.buckets.total > 0 ? ((r.buckets["1-30"] + r.buckets["31-60"] + r.buckets["61-90"] + r.buckets["90+"]) / r.buckets.total * 100) : 0;
          return (
            <div key={r.rep.id} className="bg-white rounded-lg ring-1 ring-stone-200 p-4 cursor-pointer hover:ring-stone-300"
              onClick={() => toggle(r.rep.id)}>
              <div className="flex items-start justify-between mb-2">
                <div className="text-sm font-semibold text-stone-900">{r.rep.name}</div>
                {overduePct > 50 && <span className="text-[10px] px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded font-medium">High risk</span>}
                {overduePct > 20 && overduePct <= 50 && <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">Watch</span>}
              </div>
              <div className="text-xl font-bold text-stone-900 tabular-nums mb-1">{fmt.money(r.buckets.total)}</div>
              <div className="text-[11px] text-stone-500 mb-3">{r.custSet.size} customers · {r.invoices.length} invoices</div>
              <div className="h-1.5 rounded-full overflow-hidden flex gap-px mb-2">
                {AGING_COLORS_REG.map(({ key, color }) => {
                  const pct = r.buckets.total > 0 ? (r.buckets[key] || 0) / r.buckets.total * 100 : 0;
                  if (pct === 0) return null;
                  return <div key={key} className={`${color} h-full`} style={{ width: `${pct}%` }} />;
                })}
              </div>
              <div className="text-[10px] text-stone-500">{overduePct.toFixed(0)}% overdue · {r.overdueCount} invoices</div>
              <div className="mt-2 h-1 bg-stone-100 rounded-full">
                <div className="h-full bg-stone-700 rounded-full" style={{ width: `${r.buckets.total / maxTotal * 100}%` }} />
              </div>
              <div className="text-[10px] text-stone-400 mt-1">{(r.buckets.total / grandTotal.total * 100).toFixed(1)}% of total AR</div>
            </div>
          );
        })}
      </div>

      {/* Expanded detail per rep */}
      {data.map(r => expanded.has(r.rep.id) && (
        <div key={r.rep.id} className="ring-1 ring-stone-200 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
            <div className="font-semibold text-stone-900">{r.rep.name} — Detailed Aging</div>
            <div className="font-bold text-stone-900 tabular-nums">{fmt.money(r.buckets.total)}</div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
              <th className="text-left font-semibold px-4 py-2">Customer</th>
              <th className="text-left font-semibold px-3 py-2">Project</th>
              <th className="text-left font-semibold px-3 py-2">Invoice</th>
              <th className="text-left font-semibold px-3 py-2">Due</th>
              {BUCKETS.map(b => <th key={b} className="text-right font-semibold px-3 py-2">{BUCKET_LABELS[b]}</th>)}
              <th className="text-right font-semibold px-4 py-2">Total</th>
            </tr></thead>
            <tbody>
              {r.invoices.sort((a: any, b: any) => (b.total - (b.paid||0)) - (a.total - (a.paid||0))).map((inv: any) => {
                const cust = customers.find((c: any) => c.id === inv.customerId);
                const proj = projects.find((p: any) => p.id === inv.projectId);
                const ib = invBuckets(inv);
                return (
                  <tr key={inv.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-2 text-[12px] text-stone-700">{cust?.name}</td>
                    <td className="px-3 py-2 text-[11px] text-stone-500 font-mono">{proj?.code || "—"}</td>
                    <td className="px-3 py-2"><Link href={`/invoices/${inv.id}`} className="text-[11px] font-mono text-blue-600 hover:underline">{inv.invoiceNumber}</Link></td>
                    <td className="px-3 py-2 text-[11px] text-stone-500">{inv.dueDate}</td>
                    {BUCKETS.map(bk => <BucketCell key={bk} value={ib[bk]} />)}
                    <td className="px-4 py-2 text-right font-semibold text-[12px] tabular-nums">{fmt.money(ib.total)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* Rep Summary table */}
      <div className="ring-1 ring-stone-200 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-stone-50 border-b border-stone-200 font-semibold text-stone-900">Rep Summary</div>
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
            <th className="text-left font-semibold px-4 py-2.5">Rep</th>
            <th className="text-right font-semibold px-3 py-2.5">Customers</th>
            <th className="text-right font-semibold px-3 py-2.5">Invoices</th>
            {BUCKETS.map(b => <th key={b} className="text-right font-semibold px-3 py-2.5">{BUCKET_LABELS[b]}</th>)}
            <th className="text-right font-semibold px-4 py-2.5">Total</th>
            <th className="text-right font-semibold px-4 py-2.5">% of AR</th>
          </tr></thead>
          <tbody>
            {data.map(r => (
              <tr key={r.rep.id} className="border-b border-stone-100 hover:bg-stone-50">
                <td className="px-4 py-2.5 font-medium text-stone-900">{r.rep.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.custSet.size}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.invoices.length}</td>
                {BUCKETS.map(b => <BucketCell key={b} value={r.buckets[b]} />)}
                <td className="px-4 py-2.5 text-right font-bold tabular-nums">{fmt.money(r.buckets.total)}</td>
                <td className="px-4 py-2.5 text-right text-stone-500 tabular-nums">{grandTotal.total > 0 ? (r.buckets.total / grandTotal.total * 100).toFixed(1) : 0}%</td>
              </tr>
            ))}
            <tr className="bg-stone-900 text-white">
              <td className="px-4 py-3 font-bold">TOTAL</td>
              <td className="px-3 py-3 text-right font-bold">{new Set(data.flatMap(r => [...r.custSet])).size}</td>
              <td className="px-3 py-3 text-right font-bold">{data.reduce((s, r) => s + r.invoices.length, 0)}</td>
              {BUCKETS.map(b => <td key={b} className="px-3 py-3 text-right font-bold tabular-nums">{grandTotal[b] > 0 ? fmt.money(grandTotal[b]) : "—"}</td>)}
              <td className="px-4 py-3 text-right font-bold tabular-nums">{fmt.money(grandTotal.total)}</td>
              <td className="px-4 py-3 text-right font-bold">100%</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

const AGING_COLORS_REG = [
  { key: "Current", color: "bg-emerald-500" },
  { key: "1-30", color: "bg-amber-400" },
  { key: "31-60", color: "bg-orange-500" },
  { key: "61-90", color: "bg-rose-500" },
  { key: "90+", color: "bg-rose-700" },
];

// ============================================================
// MAIN PAGE
// ============================================================
export default function ReportsPage() {
  const { invoices, customers, projects, regions, reps, communications } = useData() as any;
  const [report, setReport] = useState<"aging-customer" | "aging-project" | "regional" | "by-rep" | "activity" | "sales">("aging-customer");
  const [regionFilter, setRegionFilter] = useState("");

  const tabs = [
    { id: "sales", label: "Sales Report" },
    { id: "aging-customer", label: "AR Aging by Customer" },
    { id: "aging-project", label: "AR Aging by Project" },
    { id: "regional", label: "Regional AR" },
    { id: "by-rep", label: "AR by Rep" },
    { id: "activity", label: "Activity" },
  ];

  return (
    <div className="p-6 max-w-[1500px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Reports</h1>
          <p className="text-sm text-stone-500 mt-1">Receivables analysis and team activity</p>
        </div>
        <div className="flex items-center gap-3">
          {report !== "sales" && (
            <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}
              className="h-9 px-3 pr-8 text-sm rounded-md ring-1 ring-stone-200 bg-white appearance-none"
              style={{backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundPosition: "right 0.5rem center", backgroundSize: "12px"}}>
              <option value="">All regions</option>
              {(regions ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          <div className="text-xs text-stone-500">As of {new Date().toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" })}</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-stone-200">
        {tabs.map(tab => (
          <button key={tab.id} onClick={() => setReport(tab.id as any)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${report === tab.id ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-900"}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {report === "sales" && (
        <SalesReport
          invoices={invoices}
          customers={customers}
          projects={projects}
          regions={regions}
          reps={reps ?? []}
        />
      )}

      {report !== "sales" && (
        <Card padding="none">
          {/* Report header */}
          <div className="px-4 py-4 border-b border-stone-200 text-center">
            <div className="text-lg font-semibold text-stone-900">
              {report === "aging-customer" ? "A/R Ageing Summary Report"
                : report === "aging-project" ? "A/R Ageing by Project"
                : report === "regional" ? "Regional AR Analysis"
                : report === "by-rep" ? "AR by Sales Rep"
                : "Email Activity"}
            </div>
            <div className="text-sm text-stone-500 mt-0.5">EDC - Engineering Design Consultants Limited</div>
            <div className="text-xs text-stone-400 mt-0.5">As of {new Date().toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" })}</div>
          </div>

          {report === "aging-customer" && <AgingByCustomer
            invoices={invoices}
            customers={customers} projects={projects} regionFilter={regionFilter} />}
          {report === "aging-project" && <AgingByProject
            invoices={invoices}
            customers={customers} projects={projects} regionFilter={regionFilter} />}
          {report === "regional" && <RegionalReport invoices={invoices} customers={customers} projects={projects} regions={regions} regionFilter={regionFilter} />}
          {report === "by-rep" && <AgingByRep invoices={invoices} customers={customers} projects={projects} reps={reps ?? []} regionFilter={regionFilter} />}
          {report === "activity" && <div className="p-4"><ActivityReport communications={communications} /></div>}
        </Card>
      )}
    </div>
  );
}
