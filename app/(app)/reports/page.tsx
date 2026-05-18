"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Button } from "@/components/ui";
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
  { id: "custom",      label: "Custom"       },
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
  } else if (id === "all") {
    from      = new Date(2000, 0, 1);
    priorFrom = new Date(2000, 0, 1);
    priorTo   = new Date(2000, 0, 1);
  } else {
    // "custom" — caller handles dates directly; return sentinels
    from = priorFrom = priorTo = new Date(2000, 0, 1);
  }
  return { from, to, priorFrom, priorTo };
}

function isCreditMemo(inv: any): boolean {
  return inv.txnType === "CreditMemo" || String(inv.qboId || "").startsWith("CM-");
}

/** Positive for invoices, negative for credit memos — gives net revenue impact.
 *  CMs are stored with a positive amount (face value), so we negate them here. */
function netAmount(inv: any): number {
  const base = Math.abs(inv.amount || 0); // abs guards against any legacy negative CMs in DB
  return isCreditMemo(inv) ? -base : base;
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

function SalesReport({ invoices, customers, projects, regions, reps, fixedBreakdown }: any) {
  const { orgSettings } = useData() as any;
  const ccy: string = orgSettings?.currency ?? "EUR";
  const [period, setPeriod] = useState<PeriodId>("last-12m");
  const [breakdown, setBreakdown] = useState<"customer" | "project" | "rep" | "region">(fixedBreakdown ?? "customer");
  // Sync breakdown when the sidebar selection changes
  const activeBreakdown: "customer" | "project" | "rep" | "region" = fixedBreakdown ?? breakdown;
  const todayStr = new Date().toISOString().slice(0, 10);
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const [customFrom, setCustomFrom] = useState(firstOfMonth);
  const [customTo,   setCustomTo]   = useState(todayStr);

  const isCustom = period === "custom";

  const { from, to, priorFrom, priorTo } = useMemo(() => {
    if (isCustom) {
      const f = new Date(customFrom + "T00:00:00");
      const t = new Date(customTo   + "T23:59:59");
      // Prior period: same length shifted back
      const len = t.getTime() - f.getTime();
      const pf  = new Date(f.getTime() - len - 86400000);
      const pt  = new Date(f.getTime() - 86400000);
      return { from: f, to: t, priorFrom: pf, priorTo: pt };
    }
    return getPeriodRange(period);
  }, [period, customFrom, customTo, isCustom]);

  // All billing items (invoices + credit memos combined — CMs reduce revenue)
  const salesInvoices = useMemo(() => invoices, [invoices]);

  const periodItems = useMemo(() =>
    salesInvoices.filter((i: any) => {
      const d = new Date(i.invoiceDate);
      return d >= from && d <= to;
    }),
    [salesInvoices, from, to]
  );

  const priorItems = useMemo(() =>
    (period === "all") ? [] : salesInvoices.filter((i: any) => {
      const d = new Date(i.invoiceDate);
      return d >= priorFrom && d <= priorTo;
    }),
    [salesInvoices, priorFrom, priorTo, period]
  );

  // Split current period into regular invoices vs credit memos
  const periodInvoices = useMemo(() => periodItems.filter((i: any) => !isCreditMemo(i)), [periodItems]);
  const periodCNs      = useMemo(() => periodItems.filter((i: any) =>  isCreditMemo(i)), [periodItems]);

  // ── KPIs ────────────────────────────────────────────────────
  const grossRevenue = useMemo(() => periodInvoices.reduce((s: number, i: any) => s + netAmount(i), 0), [periodInvoices]);
  const cnAdjustment = useMemo(() => periodCNs.reduce((s: number, i: any) => s + netAmount(i), 0), [periodCNs]); // always ≤ 0
  const netRevenue   = grossRevenue + cnAdjustment;

  const priorNet     = useMemo(() => priorItems.reduce((s: number, i: any) => s + netAmount(i), 0), [priorItems]);
  const growth       = priorNet > 0 ? ((netRevenue - priorNet) / priorNet) * 100 : null;
  const avgInvoice   = periodInvoices.length > 0 ? grossRevenue / periodInvoices.length : 0;

  // Open AR for DSO (gross — collectionStage is NOT a payment status, never filter on it)
  const openAR = useMemo(() =>
    invoices.filter((i: any) => !["Paid","Written Off"].includes(i.paymentStatus) && i.txnType !== "CreditMemo")
      .reduce((s: number, i: any) => s + (i.qboBalance != null ? Number(i.qboBalance) : Math.max(0, Number(i.total || 0) - Number(i.paid || 0))), 0),
    [invoices]
  );
  const net90d = useMemo(() => {
    const d90 = new Date(Date.now() - 90 * 86400000);
    // Use net (invoices minus CNs) for a correct DSO denominator
    return salesInvoices.filter((i: any) => new Date(i.invoiceDate) >= d90).reduce((s: number, i: any) => s + netAmount(i), 0);
  }, [salesInvoices]);
  const dso = net90d > 0 ? Math.round((openAR / net90d) * 90) : 0;

  // Paid in period / regular invoices only (CNs don't have a paid status)
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
    type Row = { label: string; gross: number; cnAdj: number; net: number; invCount: number; cnCount: number; projectIds: Set<string> };
    const map = new Map<string, Row>();

    // Iterate all period items (invoices + credit memos)
    for (const inv of periodItems) {
      let key = "", label = "";

      if (activeBreakdown === "customer") {
        const c = customers.find((c: any) => c.id === inv.customerId);
        key = inv.customerId || "unknown"; label = c?.name || "Unknown";
      } else if (activeBreakdown === "project") {
        const proj = projects.find((p: any) => p.id === inv.projectId);
        key = inv.projectId || "no-project"; label = proj?.name || "No Project";
      } else if (activeBreakdown === "rep") {
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

      if (!map.has(key)) map.set(key, { label, gross: 0, cnAdj: 0, net: 0, invCount: 0, cnCount: 0, projectIds: new Set() });
      const e = map.get(key)!;
      const amt = netAmount(inv);
      e.net += amt;
      if (isCreditMemo(inv)) {
        e.cnAdj += amt; // negative
        e.cnCount += 1;
      } else {
        e.gross += amt;
        e.invCount += 1;
        if (inv.projectId) e.projectIds.add(inv.projectId);
      }
    }

    return Array.from(map.values()).sort((a, b) => b.net - a.net);
  }, [periodItems, activeBreakdown, customers, projects, reps, regions]);

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
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex items-center gap-1 bg-stone-100 p-1 rounded-xl">
            {PERIODS.map(p => (
              <button key={p.id} onClick={() => setPeriod(p.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${period === p.id ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-900"}`}>
                {p.label}
              </button>
            ))}
          </div>
          {isCustom && (
            <div className="flex items-center gap-1.5 bg-white ring-1 ring-stone-200 rounded-xl px-3 py-1.5">
              <span className="text-[11px] text-stone-400 font-medium">From</span>
              <input type="date" value={customFrom} max={customTo}
                onChange={e => setCustomFrom(e.target.value)}
                className="text-xs text-stone-700 border-none outline-none bg-transparent cursor-pointer" />
              <span className="text-[11px] text-stone-400 font-medium ml-1">To</span>
              <input type="date" value={customTo} min={customFrom} max={todayStr}
                onChange={e => setCustomTo(e.target.value)}
                className="text-xs text-stone-700 border-none outline-none bg-transparent cursor-pointer" />
            </div>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-6 gap-3">
        <SalesKPI
          label="Gross Invoiced"
          value={fmt.money(grossRevenue, ccy)}
          sub={`${periodInvoices.length} invoice${periodInvoices.length !== 1 ? "s" : ""}`}
        />
        <SalesKPI
          label="Credit Note Adj."
          value={cnAdjustment < 0 ? `−${fmt.money(Math.abs(cnAdjustment), ccy)}` : "—"}
          sub={periodCNs.length > 0 ? `${periodCNs.length} credit note${periodCNs.length !== 1 ? "s" : ""}` : "None issued"}
          highlight={cnAdjustment < 0 ? "red" : "neutral"}
        />
        <SalesKPI
          label="Net Revenue"
          value={fmt.money(netRevenue, ccy)}
          sub="Gross minus credit notes"
          highlight={netRevenue >= grossRevenue * 0.95 ? "green" : "neutral"}
        />
        <SalesKPI
          label="vs Prior Period"
          value={growth !== null ? `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%` : "—"}
          sub={period !== "all" ? fmt.money(priorNet, ccy) : "No comparison"}
          highlight={growthColor}
        />
        <SalesKPI
          label="Collection Rate"
          value={`${collRate}%`}
          sub={`${paidInPeriod} of ${periodInvoices.length} paid`}
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
                <div>This yr: {fmt.money(m.net, ccy)}</div>
                <div>Prior yr: {fmt.money(m.prior, ccy)}</div>
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
            Revenue by {activeBreakdown === "customer" ? "Customer" : activeBreakdown === "project" ? "Project" : activeBreakdown === "rep" ? "Rep" : "Region"}
          </div>
          {!fixedBreakdown && (
            <div className="flex items-center gap-1 bg-stone-100 p-0.5 rounded-lg">
              {(["customer", "project", "rep", "region"] as const).map(b => (
                <button key={b} onClick={() => setBreakdown(b)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors capitalize ${activeBreakdown === b ? "bg-white text-stone-900 shadow-sm" : "text-stone-500 hover:text-stone-800"}`}>
                  {b === "customer" ? "Customer" : b === "project" ? "Project" : b === "rep" ? "Rep" : "Region"}
                </button>
              ))}
            </div>
          )}
        </div>

        {breakdownData.length === 0 ? (
          <div className="px-5 py-8 text-center text-stone-400 text-sm">No sales data for this period</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-stone-400 border-b border-stone-100">
                <th className="text-left font-semibold px-5 py-3">#</th>
                <th className="text-left font-semibold px-3 py-3">{activeBreakdown === "customer" ? "Customer" : activeBreakdown === "project" ? "Project" : activeBreakdown === "rep" ? "Rep" : "Region"}</th>
                <th className="text-right font-semibold px-3 py-3">Gross</th>
                <th className="text-right font-semibold px-3 py-3">CN Adj.</th>
                <th className="text-right font-semibold px-3 py-3">Net Revenue</th>
                {activeBreakdown !== "project" && <th className="text-right font-semibold px-3 py-3">Projects</th>}
                <th className="text-right font-semibold px-3 py-3">Invoices</th>
                <th className="text-right font-semibold px-3 py-3">Avg Invoice</th>
                <th className="text-right font-semibold px-3 py-3">% of Total</th>
                <th className="px-5 py-3 w-32"></th>
              </tr>
            </thead>
            <tbody>
              {breakdownData.map((r, i) => {
                const pct = netRevenue > 0 ? (r.net / netRevenue) * 100 : 0;
                const avg = r.invCount > 0 ? r.gross / r.invCount : 0;
                return (
                  <tr key={i} className="border-b border-stone-50 hover:bg-stone-50">
                    <td className="px-5 py-3 text-stone-300 text-[11px] font-mono">{String(i + 1).padStart(2, "0")}</td>
                    <td className="px-3 py-3 font-medium text-stone-900 max-w-[200px] truncate">{r.label}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-stone-600">{fmt.money(r.gross, ccy)}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {r.cnAdj < 0
                        ? <span className="text-rose-600 font-medium">−{fmt.money(Math.abs(r.cnAdj), ccy)}</span>
                        : <span className="text-stone-300">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums text-stone-900">{fmt.money(r.net, ccy)}</td>
                    {activeBreakdown !== "project" && <td className="px-3 py-3 text-right tabular-nums text-stone-500">{r.projectIds.size > 0 ? r.projectIds.size : <span className="text-stone-300">—</span>}</td>}
                    <td className="px-3 py-3 text-right tabular-nums text-stone-500">
                      {r.invCount}
                      {r.cnCount > 0 && <span className="text-[10px] text-rose-400 ml-1">−{r.cnCount}CN</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-stone-500">{fmt.money(avg, ccy)}</td>
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
                <td className="px-3 py-3 text-right font-bold tabular-nums text-sm">{fmt.money(grossRevenue, ccy)}</td>
                <td className="px-3 py-3 text-right font-bold tabular-nums text-sm text-rose-300">
                  {cnAdjustment < 0 ? `−${fmt.money(Math.abs(cnAdjustment), ccy)}` : "—"}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums text-sm">{fmt.money(netRevenue, ccy)}</td>
                {activeBreakdown !== "project" && (
                  <td className="px-3 py-3 text-right font-bold tabular-nums text-sm">
                    {breakdownData.reduce((s, r) => s + r.projectIds.size, 0)}
                  </td>
                )}
                <td className="px-3 py-3 text-right font-bold tabular-nums text-sm">
                  {periodInvoices.length}
                  {periodCNs.length > 0 && <span className="text-rose-300 ml-1 text-[10px]">−{periodCNs.length}CN</span>}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums text-sm">{fmt.money(avgInvoice, ccy)}</td>
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

/** Days overdue relative to a specific reference date (not necessarily today) */
function daysOverdueAt(dueDate: string, asAt: Date): number {
  return Math.floor((asAt.getTime() - new Date(dueDate).getTime()) / 86400000);
}

function getBucket(inv: any, asAt: Date): string {
  if (inv.paymentStatus === "Paid") return "";
  const d = daysOverdueAt(inv.dueDate, asAt);
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

function invBuckets(inv: any, asAt: Date) {
  const b = emptyBuckets();

  // Credit memos: place unapplied balance (negative) in Current bucket.
  // They don't age like invoices — they're available credits reducing net AR.
  if (inv.txnType === "CreditMemo") {
    const openBal = inv.qboBalance ?? 0; // already negative
    if (openBal >= 0) return b; // fully applied — don't show
    b["Current"] = openBal;
    b.total = openBal;
    return b;
  }

  // For historical view: if paidAt is after asAt (or null), invoice was open then — use full outstanding
  // For today's view: skip paid invoices (collectionStage is NOT a payment status — never filter on it)
  const isHistorical = asAt.toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10);
  if (!isHistorical) {
    if (inv.paymentStatus === "Paid") return b;
  }
  // Outstanding as-at: if paid after asAt, full balance was open; otherwise use qboBalance
  // (authoritative open balance from QBO) falling back to total-paid for local-only rows.
  const out = (isHistorical && inv.paidAt && inv.paidAt > asAt.toISOString().slice(0, 10))
    ? Number(inv.total)  // paid after the as-at date → full amount was outstanding then
    : (inv.qboBalance != null ? Number(inv.qboBalance) : Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0)));
  if (out <= 0) return b;
  const bucket = getBucket(inv, asAt);
  if (bucket) { b[bucket] = out; b.total = out; }
  return b;
}

function BucketCell({ value, highlight, ccy = "EUR" }: { value: number; highlight?: boolean; ccy?: string }) {
  if (!value || value === 0) return <td className="px-3 py-2 text-right text-stone-300">—</td>;
  const isCredit = value < 0;
  return (
    <td className={`px-3 py-2 text-right tabular-nums text-sm ${
      isCredit ? "text-rose-600 font-medium" : highlight ? "font-semibold text-stone-900" : "text-stone-700"
    }`}>
      {fmt.money(value, ccy)}
    </td>
  );
}

// ============================================================
// BY CUSTOMER VIEW — matches QBO AR Aging Summary
// ============================================================
function AgingByCustomer({ invoices, customers, projects, regionFilter, asAt }: any) {
  const { orgSettings } = useData() as any;
  const ccy: string = orgSettings?.currency ?? "EUR";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const asAtDate = useMemo(() => asAt ? new Date(asAt + "T23:59:59") : new Date(), [asAt]);

  const toggle = (id: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(id) ? n.delete(id) : n.add(id);
    return n;
  });

  const data = useMemo(() => {
    const custMap: Record<string, { customer: any; projects: Record<string, { project: any; invoices: any[]; buckets: any }>; directInvoices: any[]; totals: any }> = {};

    for (const inv of invoices) {
      // As-at filter: invoice must have existed AND not yet been paid by that date
      if (asAt && inv.invoiceDate > asAt) continue;
      if (asAt) {
        // If paidAt is known and payment was on/before asAt → exclude (paid by then)
        if (inv.paidAt && inv.paidAt <= asAt) continue;
        // If paidAt is null but paymentStatus is Paid/Written Off → already paid, exclude
        // (fallback for invoices without a recorded paidAt — conservative: show as open)
      } else {
        if (inv.paymentStatus === "Paid") continue;
      }
      // For current view: skip zero-balance invoices; skip fully-applied CMs
      if (!asAt) {
        if (inv.txnType === "CreditMemo") {
          if ((inv.qboBalance ?? 0) >= 0) continue; // fully applied
        } else {
          const bal = inv.qboBalance != null ? Number(inv.qboBalance) : Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));
          if (bal <= 0) continue;
        }
      }

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

      const b = invBuckets(inv, asAtDate);
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

    return Object.values(custMap).filter(r => r.totals.total !== 0).sort((a, b) => b.totals.total - a.totals.total);
  }, [invoices, customers, projects, regionFilter, asAtDate]);

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
                {BUCKETS.map(b => <BucketCell key={b} value={totals[b]} highlight ccy={ccy} />)}
                <td className="px-4 py-2.5 text-right font-bold text-stone-900 tabular-nums">{fmt.money(totals.total, ccy)}</td>
              </tr>,

              // Expanded: projects
              ...(isOpen ? [
                // Direct invoices (no project)
                ...directInvoices.map(inv => {
                  const b = invBuckets(inv, asAtDate);
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
                      {BUCKETS.map(bk => <BucketCell key={bk} value={b[bk]} ccy={ccy} />)}
                      <td className="px-4 py-1.5 text-right tabular-nums text-[12px] text-stone-700">{fmt.money(b.total, ccy)}</td>
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
                    {BUCKETS.map(b => <BucketCell key={b} value={pb[b]} ccy={ccy} />)}
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-[12px] text-stone-800">{fmt.money(pb.total, ccy)}</td>
                  </tr>,

                  // Individual invoices under project
                  ...projInvs.sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).map((inv: any) => {
                    const ib = invBuckets(inv, asAtDate);
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
                        {BUCKETS.map(bk => <BucketCell key={bk} value={ib[bk]} ccy={ccy} />)}
                        <td className="px-4 py-1.5 text-right tabular-nums text-[11px] text-stone-600">{fmt.money(ib.total, ccy)}</td>
                      </tr>
                    );
                  }),
                ]).flat(),

                // Customer total row
                <tr key={`cust-total-${customer.id}`} className="border-b-2 border-stone-200 bg-stone-100/50">
                  <td className="px-4 py-2 pl-4">
                    <span className="text-[12px] font-bold text-stone-700">Total for {customer.name}</span>
                  </td>
                  {BUCKETS.map(b => <td key={b} className={`px-3 py-2 text-right text-[12px] font-bold tabular-nums ${totals[b] < 0 ? "text-rose-600" : "text-stone-800"}`}>{totals[b] !== 0 ? fmt.money(totals[b], ccy) : "—"}</td>)}
                  <td className="px-4 py-2 text-right text-[12px] font-bold tabular-nums text-stone-900">{fmt.money(totals.total, ccy)}</td>
                </tr>,
              ] : [])
            ];
          })}

          {/* Grand total */}
          <tr className="bg-stone-900 text-white">
            <td className="px-4 py-3 font-bold text-sm">TOTAL</td>
            {BUCKETS.map(b => (
              <td key={b} className={`px-3 py-3 text-right font-bold tabular-nums text-sm ${grandTotals[b] < 0 ? "text-rose-300" : ""}`}>
                {grandTotals[b] !== 0 ? fmt.money(grandTotals[b], ccy) : "—"}
              </td>
            ))}
            <td className="px-4 py-3 text-right font-bold tabular-nums text-sm">{fmt.money(grandTotals.total, ccy)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ============================================================
// BY PROJECT VIEW
// ============================================================
function AgingByProject({ invoices, customers, projects, regionFilter, asAt }: any) {
  const { orgSettings } = useData() as any;
  const ccy: string = orgSettings?.currency ?? "EUR";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const asAtDate = useMemo(() => asAt ? new Date(asAt + "T23:59:59") : new Date(), [asAt]);
  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const data = useMemo(() => {
    const projMap: Record<string, { project: any; customer: any; invoices: any[]; buckets: any }> = {};
    // Group invoices without a projectId by customer so the totals reconcile
    // with the other aging reports — otherwise these rows are silently dropped
    // and the by-project grand total is smaller than by-customer / by-region.
    const unassignedByCustomer: Record<string, { customer: any; invoices: any[]; buckets: any }> = {};

    for (const inv of invoices) {
      if (asAt && inv.invoiceDate > asAt) continue;
      if (asAt) {
        if (inv.paidAt && inv.paidAt <= asAt) continue;
      } else {
        if (inv.paymentStatus === "Paid") continue;
      }
      if (!asAt) {
        if (inv.txnType === "CreditMemo") {
          if ((inv.qboBalance ?? 0) >= 0) continue; // fully applied CM
        } else {
          const bal = inv.qboBalance != null ? Number(inv.qboBalance) : Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));
          if (bal <= 0) continue;
        }
      }

      const cust = customers.find((c: any) => c.id === inv.customerId);
      const proj = inv.projectId ? projects.find((p: any) => p.id === inv.projectId) : null;

      // Region filter applies to BOTH paths (project-assigned and unassigned).
      // Matches AgingByCustomer / RegionalReport / AgingByRep behaviour.
      if (regionFilter) {
        const inRegion = cust?.regionId === regionFilter || proj?.regionId === regionFilter;
        if (!inRegion) continue;
      }

      // Unassigned path: either no projectId at all OR projectId points to a
      // project that no longer exists in our ledger (deleted/orphaned). Either
      // way, bucket under a synthetic "— No project —" row keyed by customer so
      // the report's grand total reconciles with the other aging views.
      if (!proj) {
        const custId = inv.customerId || "_orphan";
        if (!unassignedByCustomer[custId]) {
          unassignedByCustomer[custId] = { customer: cust, invoices: [], buckets: emptyBuckets() };
        }
        const b = invBuckets(inv, asAtDate);
        unassignedByCustomer[custId].invoices.push(inv);
        unassignedByCustomer[custId].buckets = addBuckets(unassignedByCustomer[custId].buckets, b);
        continue;
      }

      if (!projMap[proj.id]) projMap[proj.id] = { project: proj, customer: cust, invoices: [], buckets: emptyBuckets() };
      const b = invBuckets(inv, asAtDate);
      projMap[proj.id].invoices.push(inv);
      projMap[proj.id].buckets = addBuckets(projMap[proj.id].buckets, b);
    }

    const projectRows = Object.values(projMap).filter(r => r.buckets.total !== 0);

    // Synthesise a pseudo-project row per customer for invoices without a project.
    // Use a stable synthetic id so React keys don't collide and expand state works.
    const unassignedRows = Object.entries(unassignedByCustomer)
      .filter(([, r]) => r.buckets.total !== 0)
      .map(([custId, r]) => ({
        project: { id: `__unassigned__${custId}`, name: "— No project —", code: r.customer?.code ?? "" },
        customer: r.customer,
        invoices: r.invoices,
        buckets: r.buckets,
      }));

    return [...projectRows, ...unassignedRows].sort((a, b) => b.buckets.total - a.buckets.total);
  }, [invoices, customers, projects, regionFilter, asAtDate]);

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
                {BUCKETS.map(b => <BucketCell key={b} value={buckets[b]} highlight ccy={ccy} />)}
                <td className="px-4 py-2.5 text-right font-bold text-stone-900 tabular-nums">{fmt.money(buckets.total, ccy)}</td>
              </tr>,

              ...(isOpen ? projInvs.sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).map((inv: any) => {
                const ib = invBuckets(inv, asAtDate);
                return (
                  <tr key={`inv-${inv.id}`} className="border-b border-stone-50 bg-stone-50/50 hover:bg-blue-50/30">
                    <td className="px-4 py-1.5">
                      <div className="flex items-center gap-2 pl-7">
                        <Link href={`/invoices/${inv.id}`} className="text-[11px] text-stone-500 hover:text-stone-900 hover:underline font-mono">{inv.invoiceNumber}</Link>
                        <span className="text-[10px] text-stone-400">· Due {inv.dueDate}</span>
                      </div>
                    </td>
                    {BUCKETS.map(bk => <BucketCell key={bk} value={ib[bk]} ccy={ccy} />)}
                    <td className="px-4 py-1.5 text-right tabular-nums text-[11px] text-stone-600">{fmt.money(ib.total, ccy)}</td>
                  </tr>
                );
              }) : [])
            ];
          })}

          <tr className="bg-stone-900 text-white">
            <td className="px-4 py-3 font-bold text-sm">TOTAL</td>
            {BUCKETS.map(b => <td key={b} className={`px-3 py-3 text-right font-bold tabular-nums text-sm ${grandTotals[b] < 0 ? "text-rose-300" : ""}`}>{grandTotals[b] !== 0 ? fmt.money(grandTotals[b], ccy) : "—"}</td>)}
            <td className="px-4 py-3 text-right font-bold tabular-nums text-sm">{fmt.money(grandTotals.total, ccy)}</td>
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
function RegionalReport({ invoices, customers, projects, regions, regionFilter, asAt }: any) {
  const { orgSettings } = useData() as any;
  const ccy: string = orgSettings?.currency ?? "EUR";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const asAtDate = useMemo(() => asAt ? new Date(asAt + "T23:59:59") : new Date(), [asAt]);
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
      if (asAt && inv.invoiceDate > asAt) continue;
      if (asAt) {
        if (inv.paidAt && inv.paidAt <= asAt) continue;
      } else {
        if (inv.paymentStatus === "Paid") continue;
      }
      const out = inv.qboBalance != null ? Number(inv.qboBalance) : Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));
      if (!asAt && out <= 0) continue;

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
      regionMap[regionLabel].buckets = addBuckets(regionMap[regionLabel].buckets, invBuckets(inv, asAtDate));
      regionMap[regionLabel].customers.add(inv.customerId);
      if (daysOverdueAt(inv.dueDate, asAtDate) > 0) regionMap[regionLabel].overdueCount++;
    }

    return Object.values(regionMap).filter(r => r.buckets.total !== 0).sort((a, b) => b.buckets.total - a.buckets.total);
  }, [invoices, projects, regionFilter, asAtDate]);

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
              <div className="text-xl font-bold text-stone-900 tabular-nums mb-1">{fmt.money(r.buckets.total, ccy)}</div>
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
            <div className="font-bold text-stone-900 tabular-nums">{fmt.money(r.buckets.total, ccy)}</div>
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
                const ib = invBuckets(inv, asAtDate);
                return (
                  <tr key={inv.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-2 text-[12px] text-stone-700">{cust?.name}</td>
                    <td className="px-3 py-2 text-[11px] text-stone-500 font-mono">{proj?.code || "—"}</td>
                    <td className="px-3 py-2"><Link href={`/invoices/${inv.id}`} className="text-[11px] font-mono text-blue-600 hover:underline">{inv.invoiceNumber}</Link></td>
                    <td className="px-3 py-2 text-[11px] text-stone-500">{inv.dueDate}</td>
                    {BUCKETS.map(bk => <BucketCell key={bk} value={ib[bk]} ccy={ccy} />)}
                    <td className="px-4 py-2 text-right font-semibold text-[12px] tabular-nums">{fmt.money(ib.total, ccy)}</td>
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
                {BUCKETS.map(b => <BucketCell key={b} value={r.buckets[b]} ccy={ccy} />)}
                <td className="px-4 py-2.5 text-right font-bold tabular-nums">{fmt.money(r.buckets.total, ccy)}</td>
                <td className="px-4 py-2.5 text-right text-stone-500 tabular-nums">{grandTotal.total > 0 ? (r.buckets.total / grandTotal.total * 100).toFixed(1) : 0}%</td>
              </tr>
            ))}
            <tr className="bg-stone-900 text-white">
              <td className="px-4 py-3 font-bold">TOTAL</td>
              <td className="px-3 py-3 text-right font-bold">{data.reduce((s, r) => s + r.customers.size, 0)}</td>
              <td className="px-3 py-3 text-right font-bold">{data.reduce((s, r) => s + r.invoices.length, 0)}</td>
              {BUCKETS.map(b => <td key={b} className="px-3 py-3 text-right font-bold tabular-nums">{grandTotal[b] > 0 ? fmt.money(grandTotal[b], ccy) : "—"}</td>)}
              <td className="px-4 py-3 text-right font-bold tabular-nums">{fmt.money(grandTotal.total, ccy)}</td>
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
function AgingByRep({ invoices, customers, projects, reps, regionFilter, asAt }: any) {
  const { orgSettings } = useData() as any;
  const ccy: string = orgSettings?.currency ?? "EUR";
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const asAtDate = useMemo(() => asAt ? new Date(asAt + "T23:59:59") : new Date(), [asAt]);
  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const data = useMemo(() => {
    const repMap: Record<string, { rep: any; invoices: any[]; buckets: any; custSet: Set<string>; overdueCount: number }> = {};

    for (const inv of invoices) {
      if (asAt && inv.invoiceDate > asAt) continue;
      if (asAt) {
        if (inv.paidAt && inv.paidAt <= asAt) continue;
      } else {
        if (inv.paymentStatus === "Paid") continue;
      }
      const out = inv.qboBalance != null ? Number(inv.qboBalance) : Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));
      if (!asAt && out <= 0) continue;

      const cust = customers.find((c: any) => c.id === inv.customerId);
      const proj = projects.find((p: any) => p.id === inv.projectId);

      if (regionFilter) {
        if (cust?.regionId !== regionFilter && proj?.regionId !== regionFilter) continue;
      }

      const repId = cust?.repId || proj?.repId || "unassigned";
      const rep = reps.find((r: any) => r.id === repId) || { id: "unassigned", name: "Unassigned" };

      if (!repMap[repId]) repMap[repId] = { rep, invoices: [], buckets: emptyBuckets(), custSet: new Set(), overdueCount: 0 };
      repMap[repId].invoices.push(inv);
      repMap[repId].buckets = addBuckets(repMap[repId].buckets, invBuckets(inv, asAtDate));
      repMap[repId].custSet.add(inv.customerId);
      if (daysOverdueAt(inv.dueDate, asAtDate) > 0) repMap[repId].overdueCount++;
    }

    return Object.values(repMap).filter(r => r.buckets.total !== 0).sort((a, b) => b.buckets.total - a.buckets.total);
  }, [invoices, customers, projects, reps, regionFilter, asAtDate]);

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
              <div className="text-xl font-bold text-stone-900 tabular-nums mb-1">{fmt.money(r.buckets.total, ccy)}</div>
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
            <div className="font-bold text-stone-900 tabular-nums">{fmt.money(r.buckets.total, ccy)}</div>
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
                const ib = invBuckets(inv, asAtDate);
                return (
                  <tr key={inv.id} className="border-b border-stone-100 hover:bg-stone-50">
                    <td className="px-4 py-2 text-[12px] text-stone-700">{cust?.name}</td>
                    <td className="px-3 py-2 text-[11px] text-stone-500 font-mono">{proj?.code || "—"}</td>
                    <td className="px-3 py-2"><Link href={`/invoices/${inv.id}`} className="text-[11px] font-mono text-blue-600 hover:underline">{inv.invoiceNumber}</Link></td>
                    <td className="px-3 py-2 text-[11px] text-stone-500">{inv.dueDate}</td>
                    {BUCKETS.map(bk => <BucketCell key={bk} value={ib[bk]} ccy={ccy} />)}
                    <td className="px-4 py-2 text-right font-semibold text-[12px] tabular-nums">{fmt.money(ib.total, ccy)}</td>
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
                {BUCKETS.map(b => <BucketCell key={b} value={r.buckets[b]} ccy={ccy} />)}
                <td className="px-4 py-2.5 text-right font-bold tabular-nums">{fmt.money(r.buckets.total, ccy)}</td>
                <td className="px-4 py-2.5 text-right text-stone-500 tabular-nums">{grandTotal.total > 0 ? (r.buckets.total / grandTotal.total * 100).toFixed(1) : 0}%</td>
              </tr>
            ))}
            <tr className="bg-stone-900 text-white">
              <td className="px-4 py-3 font-bold">TOTAL</td>
              <td className="px-3 py-3 text-right font-bold">{new Set(data.flatMap(r => [...r.custSet])).size}</td>
              <td className="px-3 py-3 text-right font-bold">{data.reduce((s, r) => s + r.invoices.length, 0)}</td>
              {BUCKETS.map(b => <td key={b} className="px-3 py-3 text-right font-bold tabular-nums">{grandTotal[b] > 0 ? fmt.money(grandTotal[b], ccy) : "—"}</td>)}
              <td className="px-4 py-3 text-right font-bold tabular-nums">{fmt.money(grandTotal.total, ccy)}</td>
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

// AR Health has been moved to the Dashboard page.
// ──────────────────────────────────────────────────────────────────────────
function ArHealthReport({ invoices, customers, projects, reps, communications, regionFilter }: any) {
  const { orgSettings } = useData() as any;
  const ccy: string = orgSettings?.currency ?? "EUR";
  const filteredInvoices = useMemo(() => {
    if (!regionFilter) return invoices;
    return invoices.filter((i: any) => {
      const c = customers.find((c: any) => c.id === i.customerId);
      if (c?.regionId === regionFilter) return true;
      const p = projects.find((p: any) => p.id === i.projectId);
      return p?.regionId === regionFilter;
    });
  }, [invoices, customers, projects, regionFilter]);

  const metrics = useMemo(() => {
    // "Open" = unpaid, not written off, not a credit memo.
    // collectionStage is NOT a payment status — never exclude on it.
    const open = filteredInvoices.filter((i: any) =>
      i.paymentStatus !== "Paid" &&
      i.paymentStatus !== "Written Off" &&
      i.txnType !== "CreditMemo"
    );
    // Outstanding balance — qboBalance is authoritative; fall back to total-paid
    const bal = (i: any) => i.qboBalance != null ? Number(i.qboBalance) : Math.max(0, Number(i.total || 0) - Number(i.paid || 0));
    const totalAR = open.reduce((s: number, i: any) => s + bal(i), 0);

    // ── Aging buckets — based purely on due date vs today ──────
    const current = open.filter((i: any) => daysOverdue(i.dueDate) <= 0).reduce((s: number, i: any) => s + bal(i), 0);
    const b1_30   = open.filter((i: any) => { const d = daysOverdue(i.dueDate); return d > 0 && d <= 30; }).reduce((s: number, i: any) => s + bal(i), 0);
    const b31_60  = open.filter((i: any) => { const d = daysOverdue(i.dueDate); return d > 30 && d <= 60; }).reduce((s: number, i: any) => s + bal(i), 0);
    const b61_90  = open.filter((i: any) => { const d = daysOverdue(i.dueDate); return d > 60 && d <= 90; }).reduce((s: number, i: any) => s + bal(i), 0);
    const b90plus = open.filter((i: any) => daysOverdue(i.dueDate) > 90).reduce((s: number, i: any) => s + bal(i), 0);

    const currentPct  = totalAR > 0 ? (current  / totalAR) * 100 : 0;
    const over90Pct   = totalAR > 0 ? (b90plus  / totalAR) * 100 : 0;
    const overdueRate = totalAR > 0 ? ((totalAR - current) / totalAR) * 100 : 0;

    // ── Dimension 2 — Risk ─────────────────────────────────────
    const disputedAR = open.filter((i: any) => i.collectionStage === "Disputed").reduce((s: number, i: any) => s + bal(i), 0);
    const disputeRate = totalAR > 0 ? (disputedAR / totalAR) * 100 : 0;
    const highRiskAR = open.filter((i: any) => {
      const c = customers.find((c: any) => c.id === i.customerId);
      return c?.riskRating === "High";
    }).reduce((s: number, i: any) => s + bal(i), 0);
    const highRiskPct = totalAR > 0 ? (highRiskAR / totalAR) * 100 : 0;

    // ── Dimension 3 — Quality (no payment-date metrics) ────────
    // Broken promises: promise stage set, promise date passed, still open
    const brokenPromises = open.filter((i: any) =>
      (i.collectionStage === "Promised" || i.collectionStage === "Promise to Pay") &&
      i.promiseDate && daysOverdue(i.promiseDate) > 0
    ).length;
    // Never contacted: overdue but no follow-up on record
    const neverContacted = open.filter((i: any) => daysOverdue(i.dueDate) > 0 && !i.lastFollowupDate).length;

    // ── Dimension 4 — Activity ─────────────────────────────────
    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const emails30d  = communications.filter((c: any) => c.direction === "Outbound" && c.channel === "Email" && new Date(c.sentAt).getTime() > thirtyDaysAgo).length;
    const replies30d = communications.filter((c: any) => c.direction === "Inbound"  && new Date(c.sentAt).getTime() > thirtyDaysAgo).length;
    const replyRate  = emails30d > 0 ? Math.round((replies30d / emails30d) * 100) : 0;

    // ── Dimension 5 — Concentration ────────────────────────────
    const byCust: Record<string, number> = {};
    open.forEach((i: any) => { byCust[i.customerId] = (byCust[i.customerId] || 0) + bal(i); });
    const concentrationRows = Object.entries(byCust)
      .map(([cid, amt]) => ({ customer: customers.find((c: any) => c.id === cid), amount: amt as number, pct: totalAR > 0 ? ((amt as number) / totalAR) * 100 : 0 }))
      .filter(x => x.customer)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);
    const top5Pct = concentrationRows.slice(0, 5).reduce((s, x) => s + x.pct, 0);

    // ── Rep portfolio ───────────────────────────────────────────
    const repPortfolio = (reps ?? []).map((rep: any) => {
      const repInvs = open.filter((i: any) => {
        const c = customers.find((c: any) => c.id === i.customerId);
        const p = projects.find((p: any) => p.id === i.projectId);
        return c?.repId === rep.id || p?.repId === rep.id;
      });
      const repOpen    = repInvs.reduce((s: number, i: any) => s + bal(i), 0);
      const repOverdue = repInvs.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + bal(i), 0);
      const custIds    = new Set(repInvs.map((i: any) => i.customerId));
      const repEmails  = communications.filter((c: any) => c.direction === "Outbound" && c.channel === "Email" && new Date(c.sentAt).getTime() > thirtyDaysAgo && custIds.has(c.customerId)).length;
      return { rep, openAR: repOpen, overdueAR: repOverdue, emails30d: repEmails, custCount: custIds.size };
    }).filter((r: any) => r.openAR > 0 || r.overdueAR > 0);

    return {
      totalAR, current, b1_30, b31_60, b61_90, b90plus,
      currentPct, over90Pct, overdueRate,
      disputeRate, highRiskPct,
      brokenPromises, neverContacted,
      concentrationRows, repPortfolio,
      openCount: open.length,
    };
  }, [filteredInvoices, customers, projects, reps, communications]);

  const {
    totalAR, current, b1_30, b31_60, b61_90, b90plus,
    currentPct, over90Pct, overdueRate,
    disputeRate, highRiskPct,
    brokenPromises, neverContacted,
    concentrationRows, repPortfolio,
    openCount,
  } = metrics;

  // ── Scores ─────────────────────────────────────────────────────────────────
  const overdueCount = filteredInvoices.filter((i: any) =>
    i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" &&
    i.txnType !== "CreditMemo" &&
    daysOverdue(i.dueDate) > 0
  ).length;

  // Aging: weighted average — each bucket has a "quality" value (100 = current, 5 = 90+d)
  // Avoids additive stacking; score degrades gracefully with AR age
  const agingScore = totalAR > 0
    ? Math.round(
        (current  * 100   // current = full marks
        + b1_30   * 70    // 1-30d overdue = still mostly healthy
        + b31_60  * 40    // 31-60d = moderate concern
        + b61_90  * 20    // 61-90d = significant concern
        + b90plus * 5)    // 90+ = worst, but not zero
        / totalAR
      )
    : 100;

  // Risk: disputes + high-risk customer exposure, each capped so one factor can't hit 0 alone
  const riskScore = Math.round(Math.max(10,
    100
    - Math.min(disputeRate * 3,  50)   // dispute rate — max 50pt deduction
    - Math.min(highRiskPct * 1, 40)    // high-risk AR — max 40pt deduction
  ));

  // Collection: % of overdue never contacted + broken promise rate, individually capped
  const brokenPromiseRate  = openCount    > 0 ? (brokenPromises / openCount)    * 100 : 0;
  const neverContactedRate = overdueCount > 0 ? (neverContacted / overdueCount) * 100 : 0;
  const collectionScore = Math.round(Math.max(10,
    100
    - Math.min(neverContactedRate * 0.5, 45)  // max 45pt — never contacting everyone is bad but not fatal
    - Math.min(brokenPromiseRate  * 1.5, 35)  // max 35pt for broken promises
    - Math.min(over90Pct          * 0.4, 20)  // max 20pt for very aged AR
  ));

  const scores = { aging: agingScore, risk: riskScore, collection: collectionScore };
  const overallScore = Math.round((scores.aging + scores.risk + scores.collection) / 3);

  const maxBucket = Math.max(current, b1_30, b31_60, b61_90, b90plus, 1);

  return (
    <div className="space-y-6 p-6">
      {/* Overall Health Score */}
      <div className="bg-gradient-to-r from-stone-900 to-stone-800 rounded-xl p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-stone-400 mb-1">AR Health Score</div>
            <div className="text-5xl font-bold tabular-nums">{overallScore}<span className="text-2xl text-stone-400">/100</span></div>
            <div className="text-sm text-stone-400 mt-2">
              {overallScore >= 80 ? "Excellent — AR management is best-in-class" :
               overallScore >= 60 ? "Good — room for improvement in a few areas" :
               overallScore >= 40 ? "Fair — significant collection issues present" :
               "Needs attention — multiple AR health risks identified"}
            </div>
          </div>
          <div className="flex gap-5">
            {([
              { label: "Aging",      score: scores.aging,      tip: "Weighted by bucket age — older overdue = heavier penalty" },
              { label: "Risk",       score: scores.risk,       tip: "Disputed AR + high-risk customer exposure" },
              { label: "Collection", score: scores.collection, tip: "Broken promises + uncontacted overdue + 90d+ AR" },
            ] as { label: string; score: number; tip: string }[]).map(({ label, score, tip }) => (
              <div key={label} className="text-center group relative">
                <div className="relative w-16 h-16 mx-auto mb-1">
                  <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#44403c" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.9" fill="none" strokeWidth="3"
                      stroke={score >= 70 ? "#34d399" : score >= 40 ? "#fbbf24" : "#f87171"}
                      strokeDasharray={`${score} 100`} strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">{score}</div>
                </div>
                <div className="text-[11px] text-stone-400">{label}</div>
                {/* Tooltip */}
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 bg-stone-700 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap">
                  {tip}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Aging overview + distribution + quality */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-4">AR Overdue Overview</div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-stone-50 rounded-lg p-3 text-center">
              <div className="text-2xl font-bold text-stone-900 tabular-nums">{fmt.money(totalAR, ccy)}</div>
              <div className="text-[10px] text-stone-500 mt-0.5">Total Open AR</div>
            </div>
            <div className={`rounded-lg p-3 text-center ${overdueRate > 50 ? "bg-rose-50" : overdueRate > 25 ? "bg-amber-50" : "bg-emerald-50"}`}>
              <div className={`text-2xl font-bold tabular-nums ${overdueRate > 50 ? "text-rose-700" : overdueRate > 25 ? "text-amber-700" : "text-emerald-700"}`}>
                {overdueRate.toFixed(0)}%
              </div>
              <div className="text-[10px] text-stone-500 mt-0.5">Overdue Rate</div>
            </div>
          </div>
          <div className="space-y-2">
            {[
              { label: "Current (not due)", value: current, pct: currentPct, color: "bg-emerald-500" },
              { label: "Overdue 1–30d",     value: b1_30,   pct: totalAR > 0 ? (b1_30  / totalAR) * 100 : 0, color: "bg-amber-400" },
              { label: "Overdue 31–90d",    value: b31_60 + b61_90, pct: totalAR > 0 ? ((b31_60 + b61_90) / totalAR) * 100 : 0, color: "bg-orange-500" },
              { label: "Overdue 90+ days",  value: b90plus, pct: over90Pct, color: "bg-rose-600" },
            ].map(({ label, value, pct, color }) => (
              <div key={label} className="flex items-center gap-2 text-[11px]">
                <div className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
                <div className="flex-1 text-stone-600">{label}</div>
                <div className="font-semibold text-stone-800 tabular-nums">{fmt.money(value, ccy)}</div>
                <div className="w-9 text-right text-stone-400">{pct.toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-3">Aging Distribution</div>
          <div className="space-y-2.5">
            {[
              { label: "Current",    value: current, color: "bg-emerald-500", pct: totalAR > 0 ? (current / totalAR) * 100 : 0 },
              { label: "1-30d",      value: b1_30,   color: "bg-amber-400",   pct: totalAR > 0 ? (b1_30 / totalAR) * 100 : 0 },
              { label: "31-60d",     value: b31_60,  color: "bg-orange-500",  pct: totalAR > 0 ? (b31_60 / totalAR) * 100 : 0 },
              { label: "61-90d",     value: b61_90,  color: "bg-rose-500",    pct: totalAR > 0 ? (b61_90 / totalAR) * 100 : 0 },
              { label: "90+ days",   value: b90plus, color: "bg-rose-800",    pct: totalAR > 0 ? (b90plus / totalAR) * 100 : 0 },
            ].map(({ label, value, color, pct }) => (
              <div key={label} className="flex items-center gap-2">
                <div className="w-14 text-[11px] text-stone-500 font-medium">{label}</div>
                <div className="flex-1 h-5 bg-stone-100 rounded overflow-hidden">
                  <div className={`h-full ${color}`} style={{ width: `${(value / maxBucket) * 100}%` }} />
                </div>
                <div className="w-10 text-right text-[11px] font-semibold text-stone-600 tabular-nums">{pct.toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-3">Health Indicators</div>
          <div className="space-y-3">
            {[
              { label: "Current AR", value: `${currentPct.toFixed(1)}%`, sub: "% of total AR not yet due", good: currentPct > 60, warn: currentPct < 40 },
              { label: "90+ days overdue", value: `${over90Pct.toFixed(1)}%`, sub: "% in oldest aging bucket", good: over90Pct < 5, warn: over90Pct > 15 },
              { label: "Dispute rate", value: `${disputeRate.toFixed(1)}%`, sub: "AR value in Disputed stage", good: disputeRate < 2, warn: disputeRate > 5 },
              { label: "High-risk customer AR", value: `${highRiskPct.toFixed(1)}%`, sub: "AR held by High risk customers", good: highRiskPct < 10, warn: highRiskPct > 25 },
              { label: "No contact (overdue)", value: String(neverContacted), sub: "Overdue invoices with zero follow-up", good: neverContacted === 0, warn: neverContacted > 5 },
              { label: "Broken promises", value: String(brokenPromises), sub: "Promise date passed, still open", good: brokenPromises === 0, warn: brokenPromises > 2 },
            ].map(({ label, value, sub, good, warn }) => (
              <div key={label} className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-medium text-stone-800">{label}</div>
                  <div className="text-[10px] text-stone-400">{sub}</div>
                </div>
                <div className={`text-sm font-bold tabular-nums px-2 py-0.5 rounded ${good ? "text-emerald-700 bg-emerald-50" : warn ? "text-rose-700 bg-rose-50" : "text-amber-700 bg-amber-50"}`}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Largest debtors + Rep breakdown */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-4">Largest Open Balances</div>
          <div className="space-y-2">
            {concentrationRows.length === 0 ? (
              <div className="py-6 text-center text-sm text-stone-500">No open AR</div>
            ) : concentrationRows.map(({ customer, amount, pct }, idx) => (
              <div key={customer.id} className="flex items-center gap-2">
                <span className="w-5 text-[11px] text-stone-400 font-mono text-right shrink-0">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[12px] font-medium text-stone-800 truncate">{customer.name}</span>
                    <div className="flex items-center gap-2 ml-2 shrink-0">
                      <span className="text-[11px] tabular-nums text-stone-700 font-semibold">{fmt.money(amount, ccy)}</span>
                      <span className="text-[11px] text-stone-400 w-9 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-stone-400" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {repPortfolio.length > 0 ? (
          <Card>
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-4">AR by Rep</div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-stone-100">
                  <th className="text-left py-1.5 font-semibold text-stone-500 pr-3">Rep</th>
                  <th className="text-right py-1.5 font-semibold text-stone-500 pr-3">Open AR</th>
                  <th className="text-right py-1.5 font-semibold text-stone-500 pr-3">Overdue</th>
                  <th className="text-right py-1.5 font-semibold text-stone-500">% Overdue</th>
                </tr>
              </thead>
              <tbody>
                {repPortfolio.map(({ rep, openAR, overdueAR }: any) => {
                  const overdPct = openAR > 0 ? (overdueAR / openAR) * 100 : 0;
                  return (
                    <tr key={rep.id} className="border-b border-stone-50 last:border-0">
                      <td className="py-2 font-medium text-stone-800 pr-3">{rep.name}</td>
                      <td className="py-2 text-right tabular-nums text-stone-700 pr-3">{fmt.money(openAR, ccy)}</td>
                      <td className={`py-2 text-right tabular-nums pr-3 font-semibold ${overdueAR > 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmt.money(overdueAR, ccy)}</td>
                      <td className={`py-2 text-right tabular-nums font-medium ${overdPct > 50 ? "text-rose-600" : overdPct > 25 ? "text-amber-600" : "text-stone-500"}`}>
                        {overdPct.toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ) : (
          <Card>
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">AR by Rep</div>
            <div className="py-6 text-center text-sm text-stone-400">No reps assigned</div>
          </Card>
        )}
      </div>
    </div>
  );
}

// ============================================================
// MAIN PAGE — QBO-style sidebar layout
// ============================================================

type ReportId = "aging-customer" | "aging-project" | "regional" | "by-rep" | "sales-overview" | "sales-customer" | "sales-project" | "sales-region" | "sales-rep";

interface ReportItem {
  id: ReportId;
  label: string;
  description: string;
}

interface ReportGroup {
  label: string;
  items: ReportItem[];
}

const REPORT_GROUPS: ReportGroup[] = [
  {
    label: "Receivables",
    items: [
      { id: "aging-customer", label: "Aging by Customer", description: "Outstanding balances grouped by customer" },
      { id: "aging-project",  label: "Aging by Project",  description: "Outstanding balances grouped by project" },
      { id: "regional",       label: "Aging by Region",   description: "AR split by region with concentration view" },
      { id: "by-rep",         label: "Aging by Rep",      description: "Portfolio view per sales representative" },
    ],
  },
  {
    label: "Sales",
    items: [
      { id: "sales-overview",  label: "Sales Overview",    description: "Revenue KPIs and period-over-period trends" },
      { id: "sales-customer",  label: "Sales by Customer", description: "Net revenue grouped by customer" },
      { id: "sales-project",   label: "Sales by Project",  description: "Net revenue grouped by project" },
      { id: "sales-region",    label: "Sales by Region",   description: "Net revenue grouped by region" },
      { id: "sales-rep",       label: "Sales by Rep",      description: "Net revenue grouped by sales rep" },
    ],
  },
];

const AR_REPORTS: ReportId[] = ["aging-customer", "aging-project", "regional", "by-rep"];
const SALES_REPORTS: ReportId[] = ["sales-overview", "sales-customer", "sales-project", "sales-region", "sales-rep"];

// Map sidebar report ID → SalesReport breakdown
const SALES_BREAKDOWN: Partial<Record<ReportId, "customer" | "project" | "rep" | "region">> = {
  "sales-customer": "customer",
  "sales-project":  "project",
  "sales-region":   "region",
  "sales-rep":      "rep",
};

export default function ReportsPage() {
  const { invoices, customers, projects, regions, reps, communications, orgSettings } = useData() as any;
  const ccy: string = orgSettings?.currency ?? "EUR";
  const [report, setReport] = useState<ReportId>("aging-customer");
  const [regionFilter, setRegionFilter] = useState("");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const todayIso = new Date().toISOString().slice(0, 10);
  const [asAtDate, setAsAtDate] = useState(todayIso);

  // AR snapshot — single source of truth for every aging tab. For historical
  // dates we hit QBO's AgedReceivableDetail directly via /api/reports/ar-snapshot;
  // for today we use the local engine that respects qboBalance. Either way, all
  // aging-by-X reports consume the same `effectiveInvoices` derived here so
  // numbers reconcile across tabs.
  const [snapshotInvoices, setSnapshotInvoices] = useState<any[] | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const isHistorical = asAtDate !== todayIso;

  useEffect(() => {
    setSnapshotLoading(true);
    fetch(`/api/reports/ar-snapshot?asOf=${asAtDate}`)
      .then(r => r.ok ? r.json() : [])
      .then(data => setSnapshotInvoices(Array.isArray(data) ? data : []))
      .catch(() => setSnapshotInvoices([]))
      .finally(() => setSnapshotLoading(false));
  }, [asAtDate]);

  // Always use the snapshot — keeps every aging tab on the same data source.
  const effectiveInvoices = snapshotInvoices ?? invoices;

  const isArReport    = AR_REPORTS.includes(report);
  const isSalesReport = SALES_REPORTS.includes(report);
  const currentItem   = REPORT_GROUPS.flatMap(g => g.items).find(i => i.id === report);

  const toggleGroup = (label: string) =>
    setCollapsedGroups(prev => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n; });

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden">
      {/* ── Sidebar ── */}
      <aside className="w-56 shrink-0 border-r border-stone-200 bg-stone-50 overflow-y-auto flex flex-col">
        <div className="px-4 pt-5 pb-3">
          <div className="text-[11px] uppercase tracking-widest font-semibold text-stone-400">Reports</div>
        </div>
        <nav className="flex-1 pb-6 pt-1">
          {REPORT_GROUPS.map(group => {
            const isCollapsed = collapsedGroups.has(group.label);
            return (
              <div key={group.label} className="mb-3">
                {/* Group header — small caps label, clearly distinct from items */}
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center justify-between px-4 pt-3 pb-1.5 text-left group"
                >
                  <span className="text-[10px] uppercase tracking-widest font-bold text-stone-400 group-hover:text-stone-600 transition-colors">
                    {group.label}
                  </span>
                  {isCollapsed
                    ? <ChevronRight size={10} className="text-stone-300" />
                    : <ChevronDown size={10} className="text-stone-300" />}
                </button>

                {/* Group items — indented, larger, normal case */}
                {!isCollapsed && (
                  <div>
                    {group.items.map(item => (
                      <button
                        key={item.id}
                        onClick={() => setReport(item.id)}
                        className={`w-full text-left pl-6 pr-4 py-2 text-[13px] transition-colors ${
                          report === item.id
                            ? "bg-stone-900 text-white font-semibold"
                            : "text-stone-700 hover:bg-stone-200 hover:text-stone-900"
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* ── Main content ── */}
      <div className="flex-1 overflow-y-auto">
        {/* Top toolbar */}
        <div className="sticky top-0 z-10 bg-white border-b border-stone-200 px-6 py-3 flex items-center justify-between gap-3">
          <div>
            <h1 className="text-base font-semibold text-stone-900">{currentItem?.label}</h1>
            <p className="text-[11px] text-stone-400 mt-0.5">{currentItem?.description}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isSalesReport && (
              <select
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                className="h-8 px-3 pr-8 text-xs rounded-md ring-1 ring-stone-200 bg-white appearance-none"
                style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundPosition: "right 0.5rem center", backgroundRepeat: "no-repeat", backgroundSize: "12px" }}
              >
                <option value="">All regions</option>
                {(regions ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
            {isArReport && (
              <div className="flex items-center gap-1.5 h-8 px-3 rounded-md ring-1 ring-stone-200 bg-white text-xs">
                <span className="text-stone-400 font-medium whitespace-nowrap">As at</span>
                <input
                  type="date"
                  value={asAtDate}
                  max={todayIso}
                  onChange={e => setAsAtDate(e.target.value || todayIso)}
                  className="text-stone-700 text-xs border-none outline-none bg-transparent cursor-pointer"
                />
                {asAtDate !== todayIso && (
                  <button onClick={() => setAsAtDate(todayIso)} className="text-[10px] text-stone-400 hover:text-stone-700 ml-1 font-medium">
                    Today
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Report body */}
        <div className="p-6">
          {isSalesReport && (
            <SalesReport
              invoices={invoices}
              customers={customers}
              projects={projects}
              regions={regions}
              reps={reps ?? []}
              fixedBreakdown={SALES_BREAKDOWN[report]}
            />
          )}

          {isArReport && (
            <Card padding="none">
              {/* Report header */}
              <div className="px-4 py-4 border-b border-stone-200 text-center">
                <div className="text-lg font-semibold text-stone-900">
                  {report === "aging-customer" ? "A/R Ageing Summary Report"
                    : report === "aging-project" ? "A/R Ageing by Project"
                    : report === "regional" ? "Regional AR Analysis"
                    : "AR by Sales Rep"}
                </div>
                <div className="text-sm text-stone-500 mt-0.5">{orgSettings?.displayName || orgSettings?.name || "Foodready Collection Manager"}</div>
                <div className="text-xs text-stone-400 mt-0.5">
                  As at {new Date(asAtDate + "T12:00:00").toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" })}
                  {asAtDate !== todayIso && <span className="ml-1.5 text-amber-500 font-semibold">(historical)</span>}
                </div>
              </div>

              {snapshotLoading && (
                <div className="px-4 py-8 text-center text-sm text-stone-400">
                  Computing AR snapshot as at {asAtDate}…
                </div>
              )}
              {!snapshotLoading && report === "aging-customer" && (
                <AgingByCustomer invoices={effectiveInvoices} customers={customers} projects={projects} regionFilter={regionFilter} asAt={asAtDate} />
              )}
              {!snapshotLoading && report === "aging-project" && (
                <AgingByProject invoices={effectiveInvoices} customers={customers} projects={projects} regionFilter={regionFilter} asAt={asAtDate} />
              )}
              {!snapshotLoading && report === "regional" && (
                <RegionalReport invoices={effectiveInvoices} customers={customers} projects={projects} regions={regions} regionFilter={regionFilter} asAt={asAtDate} />
              )}
              {!snapshotLoading && report === "by-rep" && (
                <AgingByRep invoices={effectiveInvoices} customers={customers} projects={projects} reps={reps ?? []} regionFilter={regionFilter} asAt={asAtDate} />
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
