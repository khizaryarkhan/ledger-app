"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Button } from "@/components/ui";
import { fmt, daysOverdue, daysFromNow } from "@/lib/format";
import { CurrencyPills } from "@/components/currency-pills";
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, Minus, Download, FileSpreadsheet, FileText } from "lucide-react";
import { exportArReport, exportSalesReport } from "@/lib/export-report";

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

function SalesKPI({ label, value, sub, highlight }: { label: string; value: React.ReactNode; sub?: React.ReactNode; highlight?: "green" | "red" | "neutral" }) {
  const colour = highlight === "green" ? "text-emerald-400" : highlight === "red" ? "text-rose-400" : "text-white";
  return (
    <div className="bg-stone-900 rounded-xl ring-1 ring-stone-800 px-5 py-4">
      <div className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mb-1">{label}</div>
      <div className={`text-2xl font-bold tabular-nums ${colour}`}>{value}</div>
      {sub && <div className="text-[11px] text-stone-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function MiniBar({ pct, color = "bg-stone-500" }: { pct: number; color?: string }) {
  return (
    <div className="w-full h-1.5 bg-stone-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
    </div>
  );
}

function SalesReport({ invoices, customers, projects, regions, reps, fixedBreakdown }: any) {
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

  // Collection Rate: invoices whose DUE date fell in this period and have since been paid.
  // Using dueDate (not invoiceDate) answers "how well did we collect on what was owed in this period?"
  const dueInPeriod = useMemo(() =>
    invoices.filter((i: any) => {
      if (isCreditMemo(i) || i.paymentStatus === "Written Off") return false;
      const d = new Date(i.dueDate);
      return d >= from && d <= to;
    }), [invoices, from, to]);
  const paidFromDue = useMemo(() => dueInPeriod.filter((i: any) => i.paymentStatus === "Paid").length, [dueInPeriod]);
  const collRate = dueInPeriod.length > 0 ? Math.round(paidFromDue / dueInPeriod.length * 100) : 0;

  // Per-currency breakdowns for aggregate KPI cells
  const grossByCcy = useMemo(() => {
    const m: Record<string, number> = {};
    periodInvoices.forEach((i: any) => { const c = i.currency || "EUR"; m[c] = (m[c] || 0) + netAmount(i); });
    return m;
  }, [periodInvoices]);

  const cnByCcy = useMemo(() => {
    const m: Record<string, number> = {};
    periodCNs.forEach((i: any) => { const c = i.currency || "EUR"; m[c] = (m[c] || 0) + Math.abs(netAmount(i)); });
    return m;
  }, [periodCNs]);

  const netByCcy = useMemo(() => {
    const m: Record<string, number> = {};
    periodItems.forEach((i: any) => { const c = i.currency || "EUR"; m[c] = (m[c] || 0) + netAmount(i); });
    // Keep only positive net entries for display
    return Object.fromEntries(Object.entries(m).filter(([, v]) => v > 0));
  }, [periodItems]);

  const priorByCcy = useMemo(() => {
    const m: Record<string, number> = {};
    priorItems.forEach((i: any) => { const c = i.currency || "EUR"; m[c] = (m[c] || 0) + netAmount(i); });
    return Object.fromEntries(Object.entries(m).filter(([, v]) => v > 0));
  }, [priorItems]);

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
    type Row = {
      label: string;
      gross: number; cnAdj: number; net: number;
      invCount: number; cnCount: number;
      projectIds: Set<string>;
      grossByCcy: Record<string, number>;
      cnByCcyRow: Record<string, number>;
      netByCcyRow: Record<string, number>;
      invCountByCcy: Record<string, number>;
    };
    const map = new Map<string, Row>();

    // Iterate all period items (invoices + credit memos)
    for (const inv of periodItems) {
      let key = "", label = "";
      const invCcy: string = inv.currency || "EUR";

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

      if (!map.has(key)) map.set(key, {
        label, gross: 0, cnAdj: 0, net: 0, invCount: 0, cnCount: 0, projectIds: new Set(),
        grossByCcy: {}, cnByCcyRow: {}, netByCcyRow: {}, invCountByCcy: {},
      });
      const e = map.get(key)!;
      const amt = netAmount(inv);
      e.net += amt;
      e.netByCcyRow[invCcy] = (e.netByCcyRow[invCcy] || 0) + amt;
      if (isCreditMemo(inv)) {
        e.cnAdj += amt; // negative
        e.cnCount += 1;
        e.cnByCcyRow[invCcy] = (e.cnByCcyRow[invCcy] || 0) + Math.abs(amt);
      } else {
        e.gross += amt;
        e.invCount += 1;
        e.grossByCcy[invCcy] = (e.grossByCcy[invCcy] || 0) + amt;
        e.invCountByCcy[invCcy] = (e.invCountByCcy[invCcy] || 0) + 1;
        if (inv.projectId) e.projectIds.add(inv.projectId);
      }
    }

    // Compute avgByCcy per row: track invCount per currency separately
    return Array.from(map.values()).sort((a, b) => b.net - a.net);
  }, [periodItems, periodInvoices, activeBreakdown, customers, projects, reps, regions]);

  const growthColor = growth === null ? "neutral" : growth >= 0 ? "green" : "red";
  const GrowthIcon  = growth === null ? Minus : growth >= 0 ? TrendingUp : TrendingDown;

  return (
    <div className="p-6 space-y-6">
      {/* Net label */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs text-stone-400 bg-stone-800/60 px-3 py-1.5 rounded-full">
          <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
          All values shown <strong>Net (Ex VAT)</strong> — using invoice subtotal ex tax
        </div>

        {/* Period selector */}
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex items-center gap-1 bg-stone-800 p-1 rounded-xl">
            {PERIODS.map(p => (
              <button key={p.id} onClick={() => setPeriod(p.id)}
                className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors ${period === p.id ? "bg-stone-700 text-white shadow-sm" : "text-stone-400 hover:text-stone-200"}`}>
                {p.label}
              </button>
            ))}
          </div>
          {isCustom && (
            <div className="flex items-center gap-1.5 bg-stone-800 ring-1 ring-stone-700 rounded-xl px-3 py-1.5">
              <span className="text-[11px] text-stone-400 font-medium">From</span>
              <input type="date" value={customFrom} max={customTo}
                onChange={e => setCustomFrom(e.target.value)}
                className="text-xs text-stone-300 border-none outline-none bg-transparent cursor-pointer" />
              <span className="text-[11px] text-stone-400 font-medium ml-1">To</span>
              <input type="date" value={customTo} min={customFrom} max={todayStr}
                onChange={e => setCustomTo(e.target.value)}
                className="text-xs text-stone-300 border-none outline-none bg-transparent cursor-pointer" />
            </div>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-6 gap-3">
        <SalesKPI
          label="Gross Invoiced"
          value={<CurrencyPills breakdown={grossByCcy} />}
          sub={`${periodInvoices.length} invoice${periodInvoices.length !== 1 ? "s" : ""}`}
        />
        <SalesKPI
          label="Credit Note Adj."
          value={Object.keys(cnByCcy).length > 0 ? <span className="text-rose-400">−<CurrencyPills breakdown={cnByCcy} /></span> : "—"}
          sub={periodCNs.length > 0 ? `${periodCNs.length} credit note${periodCNs.length !== 1 ? "s" : ""}` : "None issued"}
          highlight={cnAdjustment < 0 ? "red" : "neutral"}
        />
        <SalesKPI
          label="Net Revenue"
          value={<CurrencyPills breakdown={netByCcy} />}
          sub="Gross minus credit notes"
          highlight={netRevenue >= grossRevenue * 0.95 ? "green" : "neutral"}
        />
        <SalesKPI
          label="vs Prior Period"
          value={growth !== null ? `${growth >= 0 ? "+" : ""}${growth.toFixed(1)}%` : "—"}
          sub={period !== "all" ? <CurrencyPills breakdown={priorByCcy} /> : "No comparison"}
          highlight={growthColor}
        />
        <SalesKPI
          label="Collection Rate"
          value={`${collRate}%`}
          sub={dueInPeriod.length > 0 ? `${paidFromDue} of ${dueInPeriod.length} due & paid` : "No invoices due"}
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
      <div className="bg-stone-900 rounded-xl ring-1 ring-stone-800 p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="text-sm font-semibold text-white">Monthly Net Revenue</div>
            <div className="text-[11px] text-stone-400 mt-0.5">Last 12 months vs prior year — always full view regardless of period filter</div>
          </div>
          <div className="flex items-center gap-4 text-[11px] text-stone-400">
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-emerald-500" /> This year</div>
            <div className="flex items-center gap-1.5"><div className="w-3 h-3 rounded-sm bg-stone-600" /> Prior year</div>
          </div>
        </div>
        {/* Grid lines */}
        <div className="relative" style={{ height: "180px" }}>
          {[0, 25, 50, 75, 100].map(pct => (
            <div key={pct} className="absolute w-full border-t border-stone-800/60" style={{ bottom: `${pct * 1.4}px` }} />
          ))}
          <div className="flex items-end gap-1 h-full pt-2">
            {monthlyTrend.map((m, idx) => {
              const barAreaH = 140; // px available for bars (leaves 20px for label + 20px top padding)
              const priorH = m.prior > 0 ? Math.max(Math.round((m.prior / maxBar) * barAreaH), 3) : 2;
              const netH   = m.net   > 0 ? Math.max(Math.round((m.net   / maxBar) * barAreaH), 3) : 2;
              const dominantCcy = netByCcy ? Object.keys(netByCcy)[0] || "EUR" : "EUR";
              return (
                <div key={idx} className="flex-1 flex flex-col items-center group relative" style={{ height: "100%" }}>
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:flex flex-col z-10 bg-stone-800 text-white text-[10px] rounded px-2 py-1.5 whitespace-nowrap border border-stone-700 shadow-lg gap-0.5 pointer-events-none">
                    <div className="font-semibold text-stone-200">{m.label}</div>
                    <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-emerald-500 shrink-0" />This yr: {fmt.money(m.net, dominantCcy)}</div>
                    <div className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm bg-stone-500 shrink-0" />Prior yr: {fmt.money(m.prior, dominantCcy)}</div>
                  </div>
                  {/* Bars — pixel heights fix percentage-in-flex-1 bug */}
                  <div className="flex items-end gap-0.5 w-full justify-center" style={{ height: `${barAreaH + 20}px` }}>
                    <div className="bg-stone-600 rounded-t w-2 transition-all duration-300" style={{ height: `${priorH}px` }} />
                    <div className={`rounded-t w-2 transition-all duration-300 ${m.net >= m.prior ? "bg-emerald-500" : "bg-rose-400"}`} style={{ height: `${netH}px` }} />
                  </div>
                  <div className="text-[9px] text-stone-500 font-medium mt-0.5">{m.label}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Breakdown table */}
      <div className="bg-stone-900 rounded-xl ring-1 ring-stone-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div className="text-sm font-semibold text-white">
            Revenue by {activeBreakdown === "customer" ? "Customer" : activeBreakdown === "project" ? "Project" : activeBreakdown === "rep" ? "Rep" : "Region"}
          </div>
          {!fixedBreakdown && (
            <div className="flex items-center gap-1 bg-stone-800 p-0.5 rounded-lg">
              {(["customer", "project", "rep", "region"] as const).map(b => (
                <button key={b} onClick={() => setBreakdown(b)}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-colors capitalize ${activeBreakdown === b ? "bg-stone-700 text-white shadow-sm" : "text-stone-400 hover:text-stone-200"}`}>
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
              <tr className="text-[10px] uppercase tracking-wider text-stone-400 border-b border-stone-800">
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
                const avgByCcy = Object.fromEntries(
                  Object.entries(r.grossByCcy).map(([c, v]) => [c, r.invCountByCcy[c] > 0 ? v / r.invCountByCcy[c] : 0])
                );
                const netByCcyFiltered = Object.fromEntries(Object.entries(r.netByCcyRow).filter(([, v]) => v > 0));
                return (
                  <tr key={i} className="border-b border-stone-800 hover:bg-stone-800/50">
                    <td className="px-5 py-3 text-stone-600 text-[11px] font-mono">{String(i + 1).padStart(2, "0")}</td>
                    <td className="px-3 py-3 font-medium text-white max-w-[200px] truncate">{r.label}</td>
                    <td className="px-3 py-3 text-right tabular-nums text-stone-400"><CurrencyPills breakdown={r.grossByCcy} /></td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {r.cnAdj < 0
                        ? <span className="text-rose-400 font-medium">−<CurrencyPills breakdown={r.cnByCcyRow} /></span>
                        : <span className="text-stone-600">—</span>}
                    </td>
                    <td className="px-3 py-3 text-right font-bold tabular-nums text-white"><CurrencyPills breakdown={netByCcyFiltered} /></td>
                    {activeBreakdown !== "project" && <td className="px-3 py-3 text-right tabular-nums text-stone-400">{r.projectIds.size > 0 ? r.projectIds.size : <span className="text-stone-600">—</span>}</td>}
                    <td className="px-3 py-3 text-right tabular-nums text-stone-400">
                      {r.invCount}
                      {r.cnCount > 0 && <span className="text-[10px] text-rose-400 ml-1">−{r.cnCount}CN</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-stone-400"><CurrencyPills breakdown={avgByCcy} /></td>
                    <td className="px-3 py-3 text-right tabular-nums text-stone-400">{pct.toFixed(1)}%</td>
                    <td className="px-5 py-3">
                      <MiniBar pct={pct} color={i === 0 ? "bg-emerald-500" : i < 3 ? "bg-stone-500" : "bg-stone-600"} />
                    </td>
                  </tr>
                );
              })}
              {/* Total row */}
              <tr className="bg-stone-900 text-white">
                <td className="px-5 py-3 text-stone-400 text-[11px] font-mono">—</td>
                <td className="px-3 py-3 font-bold text-sm">TOTAL</td>
                <td className="px-3 py-3 text-right font-bold tabular-nums text-sm"><CurrencyPills breakdown={grossByCcy} /></td>
                <td className="px-3 py-3 text-right font-bold tabular-nums text-sm text-rose-300">
                  {Object.keys(cnByCcy).length > 0 ? <span>−<CurrencyPills breakdown={cnByCcy} /></span> : "—"}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums text-sm"><CurrencyPills breakdown={netByCcy} /></td>
                {activeBreakdown !== "project" && (
                  <td className="px-3 py-3 text-right font-bold tabular-nums text-sm">
                    {breakdownData.reduce((s, r) => s + r.projectIds.size, 0)}
                  </td>
                )}
                <td className="px-3 py-3 text-right font-bold tabular-nums text-sm">
                  {periodInvoices.length}
                  {periodCNs.length > 0 && <span className="text-rose-300 ml-1 text-[10px]">−{periodCNs.length}CN</span>}
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums text-sm">
                  <CurrencyPills breakdown={Object.fromEntries(
                    Object.entries(grossByCcy).map(([c, v]) => [c, periodInvoices.filter((i: any) => (i.currency || "EUR") === c).length > 0
                      ? v / periodInvoices.filter((i: any) => (i.currency || "EUR") === c).length : 0])
                  )} />
                </td>
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
    if (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off") return b;
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

function BucketCell({ value, highlight, currency }: { value: number; highlight?: boolean; currency: string }) {
  if (!value || value === 0) return <td className="px-3 py-2 text-right text-stone-600">—</td>;
  const isCredit = value < 0;
  return (
    <td className={`px-3 py-2 text-right tabular-nums text-sm ${
      isCredit ? "text-rose-400 font-medium" : highlight ? "font-semibold text-white" : "text-stone-300"
    }`}>
      {fmt.money(value, currency)}
    </td>
  );
}

/** For aggregate rows where the bucket value spans multiple currencies, render CurrencyPills. */
function AggregateBucketCell({ invoices, bucket, asAtDate, highlight }: { invoices: any[]; bucket: string; asAtDate: Date; highlight?: boolean }) {
  const breakdown: Record<string, number> = {};
  for (const inv of invoices) {
    const b = invBuckets(inv, asAtDate);
    const v = b[bucket];
    if (!v) continue;
    const c = inv.currency || "EUR";
    breakdown[c] = (breakdown[c] || 0) + v;
  }
  const hasValue = Object.values(breakdown).some(v => v !== 0);
  if (!hasValue) return <td className="px-3 py-2 text-right text-stone-600">—</td>;
  const hasCredit = Object.values(breakdown).some(v => v < 0);
  return (
    <td className={`px-3 py-2 text-right tabular-nums text-sm ${
      hasCredit ? "text-rose-400 font-medium" : highlight ? "font-semibold text-white" : "text-stone-300"
    }`}>
      <CurrencyPills breakdown={Object.fromEntries(Object.entries(breakdown).map(([c, v]) => [c, Math.abs(v)]))} />
    </td>
  );
}

// ============================================================
// BY CUSTOMER VIEW — matches QBO AR Aging Summary
// ============================================================
function AgingByCustomer({ invoices, customers, projects, regionFilter, asAt }: any) {
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
        if (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off") continue;
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
          <tr className="border-b-2 border-stone-800">
            <th className="text-left font-semibold px-4 py-3 text-stone-400 uppercase text-[11px] tracking-wider w-1/3">Customer / Project</th>
            {BUCKETS.map(b => <th key={b} className="text-right font-semibold px-3 py-3 text-stone-400 uppercase text-[11px] tracking-wider">{BUCKET_LABELS[b]}</th>)}
            <th className="text-right font-semibold px-4 py-3 text-stone-400 uppercase text-[11px] tracking-wider">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.map(({ customer, projects: projMap, directInvoices, totals }) => {
            const isOpen = expanded.has(customer.id);
            const hasProjects = Object.keys(projMap).length > 0 || directInvoices.length > 0;

            return [
              // Customer row
              <tr key={`cust-${customer.id}`}
                className="border-b border-stone-800 hover:bg-stone-800/50 cursor-pointer"
                onClick={() => hasProjects && toggle(customer.id)}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    {hasProjects
                      ? isOpen ? <ChevronDown size={14} className="text-stone-400 flex-shrink-0" /> : <ChevronRight size={14} className="text-stone-400 flex-shrink-0" />
                      : <span className="w-3.5" />}
                    <span className="font-semibold text-white">{customer.name}</span>
                  </div>
                </td>
                {BUCKETS.map(b => <AggregateBucketCell key={b} invoices={[...directInvoices, ...Object.values(projMap).flatMap((p: any) => p.invoices)]} bucket={b} asAtDate={asAtDate} highlight />)}
                <td className="px-4 py-2.5 text-right font-bold text-white tabular-nums">
                  <CurrencyPills breakdown={(() => { const m: Record<string,number> = {}; [...directInvoices, ...Object.values(projMap).flatMap((p: any) => p.invoices)].forEach((inv: any) => { const ib = invBuckets(inv, asAtDate); if (ib.total) { const c = inv.currency || "EUR"; m[c] = (m[c]||0) + ib.total; } }); return m; })()} />
                </td>
              </tr>,

              // Expanded: projects
              ...(isOpen ? [
                // Direct invoices (no project)
                ...directInvoices.map((inv: any) => {
                  const b = invBuckets(inv, asAtDate);
                  const invCcy: string = inv.currency || "EUR";
                  return (
                    <tr key={`inv-${inv.id}`} className="border-b border-stone-800 bg-stone-800/30 hover:bg-stone-800/50">
                      <td className="px-4 py-1.5">
                        <div className="flex items-center gap-2 pl-6">
                          <Link href={`/invoices/${inv.id}`} className="text-[12px] text-stone-400 hover:text-white hover:underline font-mono">
                            {inv.invoiceNumber}
                          </Link>
                          <span className="text-[11px] text-stone-500">· Due {inv.dueDate}</span>
                        </div>
                      </td>
                      {BUCKETS.map(bk => <BucketCell key={bk} value={b[bk]} currency={invCcy} />)}
                      <td className="px-4 py-1.5 text-right tabular-nums text-[12px] text-stone-300">{fmt.money(b.total, invCcy)}</td>
                    </tr>
                  );
                }),

                // Projects
                ...Object.values(projMap).sort((a: any, b: any) => b.buckets.total - a.buckets.total).map(({ project, invoices: projInvs, buckets: pb }: any) => [
                  // Project subtotal row
                  <tr key={`proj-${project?.id}`} className="border-b border-stone-800 bg-stone-800/30">
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2 pl-6">
                        <span className="text-[12px] font-medium text-stone-300">{project?.name || "Unknown Project"}</span>
                        {project?.code && !project.code.startsWith("QBO-") && (
                          <span className="text-[10px] text-stone-400 font-mono">{project.code}</span>
                        )}
                      </div>
                    </td>
                    {BUCKETS.map(b => <AggregateBucketCell key={b} invoices={projInvs} bucket={b} asAtDate={asAtDate} />)}
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-[12px] text-stone-200">
                      <CurrencyPills breakdown={(() => { const m: Record<string,number> = {}; projInvs.forEach((inv: any) => { const ib = invBuckets(inv, asAtDate); if (ib.total) { const c = inv.currency || "EUR"; m[c] = (m[c]||0) + ib.total; } }); return m; })()} />
                    </td>
                  </tr>,

                  // Individual invoices under project
                  ...projInvs.sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).map((inv: any) => {
                    const ib = invBuckets(inv, asAtDate);
                    const invCcy: string = inv.currency || "EUR";
                    return (
                      <tr key={`inv-${inv.id}`} className="border-b border-stone-800 hover:bg-stone-800/40">
                        <td className="px-4 py-1.5">
                          <div className="flex items-center gap-2 pl-12">
                            <Link href={`/invoices/${inv.id}`} className="text-[11px] text-stone-500 hover:text-white hover:underline font-mono">
                              {inv.invoiceNumber}
                            </Link>
                            <span className="text-[10px] text-stone-500">· Due {inv.dueDate}</span>
                          </div>
                        </td>
                        {BUCKETS.map(bk => <BucketCell key={bk} value={ib[bk]} currency={invCcy} />)}
                        <td className="px-4 py-1.5 text-right tabular-nums text-[11px] text-stone-400">{fmt.money(ib.total, invCcy)}</td>
                      </tr>
                    );
                  }),
                ]).flat(),

                // Customer total row
                <tr key={`cust-total-${customer.id}`} className="border-b-2 border-stone-800 bg-stone-800/40">
                  <td className="px-4 py-2 pl-4">
                    <span className="text-[12px] font-bold text-stone-300">Total for {customer.name}</span>
                  </td>
                  {BUCKETS.map(b => <AggregateBucketCell key={b} invoices={[...directInvoices, ...Object.values(projMap).flatMap((p: any) => p.invoices)]} bucket={b} asAtDate={asAtDate} highlight />)}
                  <td className="px-4 py-2 text-right text-[12px] font-bold tabular-nums text-white">
                    <CurrencyPills breakdown={(() => { const m: Record<string,number> = {}; [...directInvoices, ...Object.values(projMap).flatMap((p: any) => p.invoices)].forEach((inv: any) => { const ib = invBuckets(inv, asAtDate); if (ib.total) { const c = inv.currency || "EUR"; m[c] = (m[c]||0) + ib.total; } }); return m; })()} />
                  </td>
                </tr>,
              ] : [])
            ];
          })}

          {/* Grand total */}
          <tr className="bg-stone-900 text-white">
            <td className="px-4 py-3 font-bold text-sm">TOTAL</td>
            {BUCKETS.map(b => <AggregateBucketCell key={b} invoices={invoices} bucket={b} asAtDate={asAtDate} highlight />)}
            <td className="px-4 py-3 text-right font-bold tabular-nums text-sm">
              <CurrencyPills breakdown={(() => { const m: Record<string,number> = {}; invoices.forEach((inv: any) => { const ib = invBuckets(inv, asAtDate); if (ib.total) { const c = inv.currency || "EUR"; m[c] = (m[c]||0) + ib.total; } }); return m; })()} />
            </td>
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
        if (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off") continue;
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
          <tr className="border-b-2 border-stone-800">
            <th className="text-left font-semibold px-4 py-3 text-stone-400 uppercase text-[11px] tracking-wider w-1/3">Project / Invoice</th>
            {BUCKETS.map(b => <th key={b} className="text-right font-semibold px-3 py-3 text-stone-400 uppercase text-[11px] tracking-wider">{BUCKET_LABELS[b]}</th>)}
            <th className="text-right font-semibold px-4 py-3 text-stone-400 uppercase text-[11px] tracking-wider">Total</th>
          </tr>
        </thead>
        <tbody>
          {data.map(({ project, customer, invoices: projInvs, buckets }) => {
            const isOpen = expanded.has(project.id);
            return [
              <tr key={`proj-${project.id}`} className="border-b border-stone-800 hover:bg-stone-800/50 cursor-pointer" onClick={() => toggle(project.id)}>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    {isOpen ? <ChevronDown size={14} className="text-stone-400" /> : <ChevronRight size={14} className="text-stone-400" />}
                    <div>
                      <div className="font-semibold text-white">{project.name}</div>
                      <div className="text-[10px] text-stone-400 font-mono mt-0.5">
                        {project.code && !project.code.startsWith("QBO-") ? `${project.code} · ` : ""}{customer?.name}
                      </div>
                    </div>
                  </div>
                </td>
                {BUCKETS.map(b => <AggregateBucketCell key={b} invoices={projInvs} bucket={b} asAtDate={asAtDate} highlight />)}
                <td className="px-4 py-2.5 text-right font-bold text-white tabular-nums">
                  <CurrencyPills breakdown={(() => { const m: Record<string,number> = {}; projInvs.forEach((inv: any) => { const ib = invBuckets(inv, asAtDate); if (ib.total) { const c = inv.currency || "EUR"; m[c] = (m[c]||0) + ib.total; } }); return m; })()} />
                </td>
              </tr>,

              ...(isOpen ? projInvs.sort((a: any, b: any) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).map((inv: any) => {
                const ib = invBuckets(inv, asAtDate);
                const invCcy: string = inv.currency || "EUR";
                return (
                  <tr key={`inv-${inv.id}`} className="border-b border-stone-800 bg-stone-800/30 hover:bg-stone-800/40">
                    <td className="px-4 py-1.5">
                      <div className="flex items-center gap-2 pl-7">
                        <Link href={`/invoices/${inv.id}`} className="text-[11px] text-stone-400 hover:text-white hover:underline font-mono">{inv.invoiceNumber}</Link>
                        <span className="text-[10px] text-stone-500">· Due {inv.dueDate}</span>
                      </div>
                    </td>
                    {BUCKETS.map(bk => <BucketCell key={bk} value={ib[bk]} currency={invCcy} />)}
                    <td className="px-4 py-1.5 text-right tabular-nums text-[11px] text-stone-400">{fmt.money(ib.total, invCcy)}</td>
                  </tr>
                );
              }) : [])
            ];
          })}

          <tr className="bg-stone-900 text-white">
            <td className="px-4 py-3 font-bold text-sm">TOTAL</td>
            {BUCKETS.map(b => <AggregateBucketCell key={b} invoices={invoices} bucket={b} asAtDate={asAtDate} highlight />)}
            <td className="px-4 py-3 text-right font-bold tabular-nums text-sm">
              <CurrencyPills breakdown={(() => { const m: Record<string,number> = {}; invoices.forEach((inv: any) => { const ib = invBuckets(inv, asAtDate); if (ib.total) { const c = inv.currency || "EUR"; m[c] = (m[c]||0) + ib.total; } }); return m; })()} />
            </td>
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
  const actBarH = 160; // px — same fix as Monthly Net Revenue chart

  return (
    <Card>
      <h3 className="text-sm font-semibold text-white mb-4">Email activity (last 14 days)</h3>
      <div className="relative mb-3" style={{ height: "192px" }}>
        <div className="flex items-end gap-1 h-full">
          {activity.map((d, i) => {
            const sentH = d.sent > 0 ? Math.max(Math.round((d.sent / maxActivity) * actBarH), 2) : 1;
            const recvH = d.received > 0 ? Math.max(Math.round((d.received / maxActivity) * actBarH), 2) : 1;
            return (
              <div key={i} className="flex-1 flex flex-col items-center group relative">
                <div className="flex items-end gap-0.5 w-full justify-center" style={{ height: `${actBarH + 16}px` }}>
                  <div className="bg-stone-400 rounded-t w-2.5 transition-all duration-300" style={{ height: `${sentH}px` }} title={`${d.sent} sent`} />
                  <div className="bg-emerald-500 rounded-t w-2.5 transition-all duration-300" style={{ height: `${recvH}px` }} title={`${d.received} received`} />
                </div>
                <div className="text-[9px] text-stone-500 mt-0.5">{new Date(d.date).getDate()}</div>
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex items-center gap-4 text-xs text-stone-400 pt-3 border-t border-stone-800">
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-stone-400" /> Sent ({activity.reduce((s, d) => s + d.sent, 0)})</div>
        <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-emerald-500" /> Received ({activity.reduce((s, d) => s + d.received, 0)})</div>
      </div>
    </Card>
  );
}


// ============================================================
// REGIONAL AR REPORT — Management view
// ============================================================
function RegionalReport({ invoices, customers, projects, regions, regionFilter, asAt }: any) {
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
        if (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off") continue;
      }
      // Use invBuckets as the single source of truth for open balance — it
      // handles CreditMemos (negative balance) correctly. The old Math.max(0,…)
      // guard silently dropped CMs because their balance is negative.
      const ib = invBuckets(inv, asAtDate);
      if (!asAt && ib.total === 0) continue;

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
      regionMap[regionLabel].buckets = addBuckets(regionMap[regionLabel].buckets, ib);
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
            <div key={r.region} className="bg-stone-900 rounded-lg ring-1 ring-stone-800 p-4 cursor-pointer hover:ring-stone-700"
              onClick={() => toggle(r.region)}>
              <div className="flex items-start justify-between mb-2">
                <div className="text-sm font-semibold text-white">{r.region}</div>
                {overduePct > 50 && <span className="text-[10px] px-1.5 py-0.5 bg-rose-500/15 text-rose-400 rounded font-medium">High risk</span>}
                {overduePct > 20 && overduePct <= 50 && <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/15 text-amber-400 rounded font-medium">Watch</span>}
              </div>
              <div className="text-xl font-bold text-white tabular-nums mb-1">
                <CurrencyPills breakdown={(() => { const m: Record<string,number> = {}; r.invoices.forEach((inv: any) => { const ib = invBuckets(inv, asAtDate); if (ib.total) { const c = inv.currency || "EUR"; m[c] = (m[c]||0) + ib.total; } }); return m; })()} />
              </div>
              <div className="text-[11px] text-stone-400 mb-3">{r.customers.size} customers · {r.invoices.length} invoices</div>

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
              <div className="mt-2 h-1 bg-stone-800 rounded-full">
                <div className="h-full bg-stone-500 rounded-full" style={{ width: `${r.buckets.total / maxTotal * 100}%` }} />
              </div>
              <div className="text-[10px] text-stone-400 mt-1">{(r.buckets.total / grandTotal.total * 100).toFixed(1)}% of total AR</div>
            </div>
          );
        })}
      </div>

      {/* Detailed breakdown when expanded */}
      {data.map(r => expanded.has(r.region) && (
        <div key={r.region} className="ring-1 ring-stone-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-stone-800/60 border-b border-stone-800 flex items-center justify-between">
            <div className="font-semibold text-white">{r.region} — Detailed Aging</div>
            <div className="font-bold text-white tabular-nums">
              <CurrencyPills breakdown={(() => { const m: Record<string,number> = {}; r.invoices.forEach((inv: any) => { const ib = invBuckets(inv, asAtDate); if (ib.total) { const c = inv.currency || "EUR"; m[c] = (m[c]||0) + ib.total; } }); return m; })()} />
            </div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-stone-800">
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
                const invCcy: string = inv.currency || "EUR";
                return (
                  <tr key={inv.id} className="border-b border-stone-800 hover:bg-stone-800/50">
                    <td className="px-4 py-2 text-[12px] text-stone-300">{cust?.name}</td>
                    <td className="px-3 py-2 text-[11px] text-stone-400">{proj?.name || "—"}</td>
                    <td className="px-3 py-2"><Link href={`/invoices/${inv.id}`} className="text-[11px] font-mono text-emerald-400 hover:underline">{inv.invoiceNumber}</Link></td>
                    <td className="px-3 py-2 text-[11px] text-stone-400">{inv.dueDate}</td>
                    {BUCKETS.map(bk => <BucketCell key={bk} value={ib[bk]} currency={invCcy} />)}
                    <td className="px-4 py-2 text-right font-semibold text-[12px] tabular-nums">{fmt.money(ib.total, invCcy)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* Grand total table */}
      <div className="ring-1 ring-stone-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-stone-800/60 border-b border-stone-800 font-semibold text-white">Regional Summary</div>
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-stone-800">
            <th className="text-left font-semibold px-4 py-2.5">Region</th>
            <th className="text-right font-semibold px-3 py-2.5">Customers</th>
            <th className="text-right font-semibold px-3 py-2.5">Invoices</th>
            {BUCKETS.map(b => <th key={b} className="text-right font-semibold px-3 py-2.5">{BUCKET_LABELS[b]}</th>)}
            <th className="text-right font-semibold px-4 py-2.5">Total</th>
            <th className="text-right font-semibold px-4 py-2.5">% of AR</th>
          </tr></thead>
          <tbody>
            {data.map(r => (
              <tr key={r.region} className="border-b border-stone-800 hover:bg-stone-800/50">
                <td className="px-4 py-2.5 font-medium text-white">{r.region}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.customers.size}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.invoices.length}</td>
                {BUCKETS.map(b => <AggregateBucketCell key={b} invoices={r.invoices} bucket={b} asAtDate={asAtDate} />)}
                <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                  <CurrencyPills breakdown={(() => { const m: Record<string,number> = {}; r.invoices.forEach((inv: any) => { const ib = invBuckets(inv, asAtDate); if (ib.total) { const c = inv.currency || "EUR"; m[c] = (m[c]||0) + ib.total; } }); return m; })()} />
                </td>
                <td className="px-4 py-2.5 text-right text-stone-500 tabular-nums">{grandTotal.total > 0 ? (r.buckets.total / grandTotal.total * 100).toFixed(1) : 0}%</td>
              </tr>
            ))}
            <tr className="bg-stone-900 text-white">
              <td className="px-4 py-3 font-bold">TOTAL</td>
              <td className="px-3 py-3 text-right font-bold">{data.reduce((s, r) => s + r.customers.size, 0)}</td>
              <td className="px-3 py-3 text-right font-bold">{data.reduce((s, r) => s + r.invoices.length, 0)}</td>
              {BUCKETS.map(b => <AggregateBucketCell key={b} invoices={data.flatMap(r => r.invoices)} bucket={b} asAtDate={asAtDate} />)}
              <td className="px-4 py-3 text-right font-bold tabular-nums">
                <CurrencyPills breakdown={(() => { const m: Record<string,number> = {}; data.flatMap(r => r.invoices).forEach((inv: any) => { const ib = invBuckets(inv, asAtDate); if (ib.total) { const c = inv.currency || "EUR"; m[c] = (m[c]||0) + ib.total; } }); return m; })()} />
              </td>
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
        if (inv.paymentStatus === "Paid" || inv.paymentStatus === "Written Off") continue;
      }
      // Use invBuckets as the single source of truth — handles CMs (negative
      // balance) correctly. The old Math.max(0,…) guard silently dropped CMs.
      const ib = invBuckets(inv, asAtDate);
      if (!asAt && ib.total === 0) continue;

      const cust = customers.find((c: any) => c.id === inv.customerId);
      const proj = projects.find((p: any) => p.id === inv.projectId);

      if (regionFilter) {
        if (cust?.regionId !== regionFilter && proj?.regionId !== regionFilter) continue;
      }

      const repId = cust?.repId || proj?.repId || "unassigned";
      const rep = reps.find((r: any) => r.id === repId) || { id: "unassigned", name: "Unassigned" };

      if (!repMap[repId]) repMap[repId] = { rep, invoices: [], buckets: emptyBuckets(), custSet: new Set(), overdueCount: 0 };
      repMap[repId].invoices.push(inv);
      repMap[repId].buckets = addBuckets(repMap[repId].buckets, ib);
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
            <div key={r.rep.id} className="bg-stone-900 rounded-lg ring-1 ring-stone-800 p-4 cursor-pointer hover:ring-stone-700"
              onClick={() => toggle(r.rep.id)}>
              <div className="flex items-start justify-between mb-2">
                <div className="text-sm font-semibold text-white">{r.rep.name}</div>
                {overduePct > 50 && <span className="text-[10px] px-1.5 py-0.5 bg-rose-500/15 text-rose-400 border border-rose-500/20 rounded font-medium">High risk</span>}
                {overduePct > 20 && overduePct <= 50 && <span className="text-[10px] px-1.5 py-0.5 bg-amber-500/15 text-amber-400 border border-amber-500/20 rounded font-medium">Watch</span>}
              </div>
              <div className="text-xl font-bold text-white tabular-nums mb-1">
                <CurrencyPills breakdown={(() => { const m: Record<string,number> = {}; r.invoices.forEach((inv: any) => { const ib = invBuckets(inv, asAtDate); if (ib.total) { const c = inv.currency || "EUR"; m[c] = (m[c]||0) + ib.total; } }); return m; })()} />
              </div>
              <div className="text-[11px] text-stone-400 mb-3">{r.custSet.size} customers · {r.invoices.length} invoices</div>
              <div className="h-1.5 rounded-full overflow-hidden flex gap-px mb-2">
                {AGING_COLORS_REG.map(({ key, color }) => {
                  const pct = r.buckets.total > 0 ? (r.buckets[key] || 0) / r.buckets.total * 100 : 0;
                  if (pct === 0) return null;
                  return <div key={key} className={`${color} h-full`} style={{ width: `${pct}%` }} />;
                })}
              </div>
              <div className="text-[10px] text-stone-500">{overduePct.toFixed(0)}% overdue · {r.overdueCount} invoices</div>
              <div className="mt-2 h-1 bg-stone-800 rounded-full">
                <div className="h-full bg-stone-500 rounded-full" style={{ width: `${r.buckets.total / maxTotal * 100}%` }} />
              </div>
              <div className="text-[10px] text-stone-400 mt-1">{(r.buckets.total / grandTotal.total * 100).toFixed(1)}% of total AR</div>
            </div>
          );
        })}
      </div>

      {/* Expanded detail per rep */}
      {data.map(r => expanded.has(r.rep.id) && (
        <div key={r.rep.id} className="ring-1 ring-stone-800 rounded-lg overflow-hidden">
          <div className="px-4 py-3 bg-stone-800/60 border-b border-stone-800 flex items-center justify-between">
            <div className="font-semibold text-white">{r.rep.name} — Detailed Aging</div>
            <div className="font-bold text-white tabular-nums">
            <CurrencyPills breakdown={(() => { const m: Record<string,number> = {}; r.invoices.forEach((inv: any) => { const ib = invBuckets(inv, asAtDate); if (ib.total) { const c = inv.currency || "EUR"; m[c] = (m[c]||0) + ib.total; } }); return m; })()} />
          </div>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-stone-800">
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
                const invCcy: string = inv.currency || "EUR";
                return (
                  <tr key={inv.id} className="border-b border-stone-800 hover:bg-stone-800/50">
                    <td className="px-4 py-2 text-[12px] text-stone-300">{cust?.name}</td>
                    <td className="px-3 py-2 text-[11px] text-stone-400">{proj?.name || "—"}</td>
                    <td className="px-3 py-2"><Link href={`/invoices/${inv.id}`} className="text-[11px] font-mono text-emerald-400 hover:underline">{inv.invoiceNumber}</Link></td>
                    <td className="px-3 py-2 text-[11px] text-stone-400">{inv.dueDate}</td>
                    {BUCKETS.map(bk => <BucketCell key={bk} value={ib[bk]} currency={invCcy} />)}
                    <td className="px-4 py-2 text-right font-semibold text-[12px] tabular-nums">{fmt.money(ib.total, invCcy)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}

      {/* Rep Summary table */}
      <div className="ring-1 ring-stone-800 rounded-lg overflow-hidden">
        <div className="px-4 py-3 bg-stone-800/60 border-b border-stone-800 font-semibold text-white">Rep Summary</div>
        <table className="w-full text-sm">
          <thead><tr className="text-[11px] uppercase tracking-wider text-stone-400 border-b border-stone-800">
            <th className="text-left font-semibold px-4 py-2.5">Rep</th>
            <th className="text-right font-semibold px-3 py-2.5">Customers</th>
            <th className="text-right font-semibold px-3 py-2.5">Invoices</th>
            {BUCKETS.map(b => <th key={b} className="text-right font-semibold px-3 py-2.5">{BUCKET_LABELS[b]}</th>)}
            <th className="text-right font-semibold px-4 py-2.5">Total</th>
            <th className="text-right font-semibold px-4 py-2.5">% of AR</th>
          </tr></thead>
          <tbody>
            {data.map(r => (
              <tr key={r.rep.id} className="border-b border-stone-800 hover:bg-stone-800/50">
                <td className="px-4 py-2.5 font-medium text-white">{r.rep.name}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.custSet.size}</td>
                <td className="px-3 py-2.5 text-right tabular-nums">{r.invoices.length}</td>
                {BUCKETS.map(b => <AggregateBucketCell key={b} invoices={r.invoices} bucket={b} asAtDate={asAtDate} />)}
                <td className="px-4 py-2.5 text-right font-bold tabular-nums">
                  <CurrencyPills breakdown={(() => { const m: Record<string,number> = {}; r.invoices.forEach((inv: any) => { const ib = invBuckets(inv, asAtDate); if (ib.total) { const c = inv.currency || "EUR"; m[c] = (m[c]||0) + ib.total; } }); return m; })()} />
                </td>
                <td className="px-4 py-2.5 text-right text-stone-500 tabular-nums">{grandTotal.total > 0 ? (r.buckets.total / grandTotal.total * 100).toFixed(1) : 0}%</td>
              </tr>
            ))}
            <tr className="bg-stone-900 text-white">
              <td className="px-4 py-3 font-bold">TOTAL</td>
              <td className="px-3 py-3 text-right font-bold">{new Set(data.flatMap(r => [...r.custSet])).size}</td>
              <td className="px-3 py-3 text-right font-bold">{data.reduce((s, r) => s + r.invoices.length, 0)}</td>
              {BUCKETS.map(b => <AggregateBucketCell key={b} invoices={data.flatMap(r => r.invoices)} bucket={b} asAtDate={asAtDate} highlight />)}
              <td className="px-4 py-3 text-right font-bold tabular-nums">
                <CurrencyPills breakdown={(() => { const m: Record<string,number> = {}; data.flatMap(r => r.invoices).forEach((inv: any) => { const ib = invBuckets(inv, asAtDate); if (ib.total) { const c = inv.currency || "EUR"; m[c] = (m[c]||0) + ib.total; } }); return m; })()} />
              </td>
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
  const [snapshotError, setSnapshotError] = useState(false);
  const isHistorical = asAtDate !== todayIso;

  useEffect(() => {
    setSnapshotLoading(true);
    setSnapshotError(false);
    fetch(`/api/reports/ar-snapshot?asOf=${asAtDate}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(data => setSnapshotInvoices(Array.isArray(data) ? data : []))
      .catch(() => { setSnapshotError(true); setSnapshotInvoices(null); })
      .finally(() => setSnapshotLoading(false));
  }, [asAtDate]);

  // Always use the snapshot — keeps every aging tab on the same data source.
  // Falls back to live invoices only if the snapshot request itself failed.
  const effectiveInvoices = snapshotError ? invoices : (snapshotInvoices ?? invoices);

  // Detect multi-currency data so we can warn users that totals are approximate.
  // Summing EUR + GBP without FX conversion produces a meaningless single number.
  const invoiceCurrencies = useMemo(() => {
    const seen = new Set<string>();
    for (const inv of effectiveInvoices) {
      if (inv.currency && inv.txnType !== "CreditMemo") seen.add(inv.currency);
    }
    return seen;
  }, [effectiveInvoices]);
  const hasMixedCurrencies = invoiceCurrencies.size > 1;

  const isArReport    = AR_REPORTS.includes(report);
  const isSalesReport = SALES_REPORTS.includes(report);
  const currentItem   = REPORT_GROUPS.flatMap(g => g.items).find(i => i.id === report);

  const toggleGroup = (label: string) =>
    setCollapsedGroups(prev => { const n = new Set(prev); n.has(label) ? n.delete(label) : n.add(label); return n; });

  // ── Export ─────────────────────────────────────────────────────────────
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) setExportOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function handleExportPdf() {
    setExportOpen(false);
    setTimeout(() => window.print(), 50); // tiny delay so dropdown closes first
  }

  function handleExportExcel() {
    setExportOpen(false);
    const orgName = orgSettings?.displayName || orgSettings?.name || "Organisation";

    if (isArReport) {
      exportArReport({
        reportId: report as any,
        reportLabel: currentItem?.label ?? report,
        orgName,
        asAtDate,
        invoices: effectiveInvoices,
        customers,
        projects,
        regions: regions ?? [],
        reps: reps ?? [],
        regionFilter,
      });
    } else {
      // Derive the active period dates from what SalesReport would use
      // Default to "last-12m" range (same as SalesReport default period)
      const now = new Date();
      const from = new Date(now.getFullYear() - 1, now.getMonth(), 1);
      const to   = new Date();
      const breakdown = (SALES_BREAKDOWN[report] ?? "customer") as "customer" | "project" | "rep" | "region";
      exportSalesReport({
        reportId: report,
        reportLabel: currentItem?.label ?? report,
        orgName,
        periodLabel: "Last 12 months",
        periodFrom: from.toISOString().slice(0, 10),
        periodTo: to.toISOString().slice(0, 10),
        invoices,
        customers,
        projects,
        regions: regions ?? [],
        reps: reps ?? [],
        breakdown,
      });
    }
  }

  return (
    <div className="flex h-[calc(100vh-56px)] overflow-hidden report-print-root">
      {/* ── Sidebar ── */}
      <aside className="w-56 shrink-0 border-r border-stone-800 bg-stone-950 overflow-y-auto flex flex-col report-print-sidebar">
        <div className="px-4 pt-5 pb-3">
          <div className="text-[11px] uppercase tracking-widest font-semibold text-stone-500">Reports</div>
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
                  <span className="text-[10px] uppercase tracking-widest font-bold text-stone-500 group-hover:text-stone-300 transition-colors">
                    {group.label}
                  </span>
                  {isCollapsed
                    ? <ChevronRight size={10} className="text-stone-600" />
                    : <ChevronDown size={10} className="text-stone-600" />}
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
                            ? "bg-emerald-500/15 text-emerald-400 font-semibold border-r-2 border-emerald-500"
                            : "text-stone-400 hover:bg-stone-800/50 hover:text-stone-200"
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
      <div className="flex-1 overflow-y-auto report-print-content">
        {/* Top toolbar */}
        <div className="sticky top-0 z-10 bg-stone-950 border-b border-stone-800 px-6 py-3 flex items-center justify-between gap-3 report-print-toolbar">
          <div>
            <h1 className="text-base font-semibold text-white">{currentItem?.label}</h1>
            <p className="text-[11px] text-stone-400 mt-0.5">{currentItem?.description}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {!isSalesReport && (
              <select
                value={regionFilter}
                onChange={(e) => setRegionFilter(e.target.value)}
                className="h-8 px-3 pr-8 text-xs rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 appearance-none report-no-print"
                style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%239ca3af' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundPosition: "right 0.5rem center", backgroundRepeat: "no-repeat", backgroundSize: "12px" }}
              >
                <option value="">All regions</option>
                {(regions ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            )}
            {isArReport && (
              <div className="flex items-center gap-1.5 h-8 px-3 rounded-md ring-1 ring-stone-700 bg-stone-800 text-xs report-no-print">
                <span className="text-stone-400 font-medium whitespace-nowrap">As at</span>
                <input
                  type="date"
                  value={asAtDate}
                  max={todayIso}
                  onChange={e => setAsAtDate(e.target.value || todayIso)}
                  className="text-stone-300 text-xs border-none outline-none bg-transparent cursor-pointer"
                />
                {asAtDate !== todayIso && (
                  <button onClick={() => setAsAtDate(todayIso)} className="text-[10px] text-stone-400 hover:text-stone-200 ml-1 font-medium">
                    Today
                  </button>
                )}
              </div>
            )}

            {/* ── Export dropdown ── */}
            <div className="relative report-no-print" ref={exportRef}>
              <button
                onClick={() => setExportOpen(v => !v)}
                className="h-8 flex items-center gap-1.5 px-3 rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 hover:bg-stone-700 hover:text-white text-xs font-medium transition-colors"
              >
                <Download size={13} />
                Export
                <ChevronDown size={11} className={`transition-transform ${exportOpen ? "rotate-180" : ""}`} />
              </button>
              {exportOpen && (
                <div className="absolute right-0 top-full mt-1.5 w-48 bg-stone-800 border border-stone-700 rounded-lg shadow-xl z-20 overflow-hidden">
                  <button
                    onClick={handleExportExcel}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-stone-300 hover:bg-stone-700 hover:text-white transition-colors text-left"
                  >
                    <FileSpreadsheet size={15} className="text-emerald-400 shrink-0" />
                    <div>
                      <div className="font-medium">Export to Excel</div>
                      <div className="text-[10px] text-stone-500">Summary + invoice detail</div>
                    </div>
                  </button>
                  <div className="border-t border-stone-700" />
                  <button
                    onClick={handleExportPdf}
                    className="w-full flex items-center gap-2.5 px-4 py-2.5 text-sm text-stone-300 hover:bg-stone-700 hover:text-white transition-colors text-left"
                  >
                    <FileText size={15} className="text-rose-400 shrink-0" />
                    <div>
                      <div className="font-medium">Export to PDF</div>
                      <div className="text-[10px] text-stone-500">Print-ready view (A4 landscape)</div>
                    </div>
                  </button>
                </div>
              )}
            </div>
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
              <div className="px-4 py-4 border-b border-stone-800 text-center">
                <div className="text-lg font-semibold text-white">
                  {report === "aging-customer" ? "A/R Ageing Summary Report"
                    : report === "aging-project" ? "A/R Ageing by Project"
                    : report === "regional" ? "Regional AR Analysis"
                    : "AR by Sales Rep"}
                </div>
                <div className="text-sm text-stone-500 mt-0.5">{orgSettings?.displayName || orgSettings?.name || "AR Collection Manager"}</div>
                <div className="text-xs text-stone-400 mt-0.5">
                  As at {new Date(asAtDate + "T12:00:00").toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" })}
                  {asAtDate !== todayIso && <span className="ml-1.5 text-amber-500 font-semibold">(historical)</span>}
                </div>
              </div>

              {/* Multi-currency warning — shown when the snapshot contains invoices
                  in more than one currency. Totals are the arithmetic sum of
                  mixed currencies (e.g. EUR + GBP) with no FX conversion applied,
                  which overstates or understates the true net AR in the org's home
                  currency. Users should filter by currency or use QBO's native
                  multi-currency reports for precise home-currency totals. */}
              {!snapshotLoading && hasMixedCurrencies && (
                <div className="mx-4 mt-3 mb-1 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
                  <span className="text-amber-400 mt-0.5 shrink-0">⚠</span>
                  <div className="text-[12px] text-amber-300 leading-relaxed">
                    <span className="font-semibold">Multi-currency data detected</span>
                    {" "}({[...invoiceCurrencies].sort().join(", ")}).{" "}
                    Totals shown are the arithmetic sum across currencies without FX conversion — they
                    are directionally correct but not financially precise. For exact home-currency
                    totals, use QBO's native Aged Receivables report or filter this view to a single
                    currency using the region/rep filters.
                  </div>
                </div>
              )}

              {snapshotLoading && (
                <div className="px-4 py-8 text-center text-sm text-stone-400">
                  Computing AR snapshot as at {asAtDate}…
                </div>
              )}
              {!snapshotLoading && snapshotError && (
                <div className="mx-4 mt-3 mb-1 flex items-start gap-2.5 rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3">
                  <span className="text-rose-400 mt-0.5 shrink-0">⚠</span>
                  <div className="text-[12px] text-rose-300 leading-relaxed">
                    <span className="font-semibold">Failed to load AR snapshot for {asAtDate}.</span>
                    {" "}Showing live invoice data instead — figures may differ from a point-in-time view.
                    <button onClick={() => setAsAtDate(asAtDate)} className="ml-2 underline hover:text-rose-100">Retry</button>
                  </div>
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
