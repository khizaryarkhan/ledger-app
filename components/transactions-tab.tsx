"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, Badge } from "@/components/ui";
import { fmt } from "@/lib/format";
import { Receipt, CreditCard, FileMinus, FileX, ArrowDownLeft, ArrowUpRight, BookOpen } from "lucide-react";

type Txn = {
  id: string;
  refId: string;
  txnDate: string;
  type: "Invoice" | "Credit Memo" | "Payment" | "Refund Receipt" | "Journal Entry";
  number: string | null;
  amount: number;
  balance: number;
  currency: string;
  status: string;
  memo: string | null;
  meta?: Record<string, any>;
};

const TYPE_FILTERS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All transactions" },
  { id: "Invoice", label: "Invoices" },
  { id: "Credit Memo", label: "Credit Memos" },
  { id: "Payment", label: "Payments" },
  { id: "Refund Receipt", label: "Refund Receipts" },
  { id: "Journal Entry", label: "Journal Entries" },
];

const DATE_FILTERS: Array<{ id: string; label: string }> = [
  { id: "all", label: "All time" },
  { id: "this-year", label: "This year" },
  { id: "last-12", label: "Last 12 months" },
  { id: "last-90", label: "Last 90 days" },
  { id: "last-30", label: "Last 30 days" },
];

function typeIcon(type: string) {
  switch (type) {
    case "Invoice":         return <Receipt size={13} className="text-stone-600" />;
    case "Credit Memo":     return <FileMinus size={13} className="text-amber-600" />;
    case "Payment":         return <ArrowDownLeft size={13} className="text-emerald-600" />;
    case "Refund Receipt":  return <ArrowUpRight size={13} className="text-rose-600" />;
    case "Journal Entry":   return <BookOpen size={13} className="text-stone-500" />;
    default:                return <FileX size={13} className="text-stone-400" />;
  }
}

function statusBadge(status: string) {
  const map: Record<string, { variant: any; label: string }> = {
    "Paid":              { variant: "green",  label: "Paid" },
    "Partially Paid":    { variant: "amber",  label: "Partially Paid" },
    "Unpaid":            { variant: "neutral",label: "Unpaid" },
    "Voided":            { variant: "neutral",label: "Voided" },
    "Closed":            { variant: "green",  label: "Closed" },
    "Applied":           { variant: "green",  label: "Applied" },
    "Partially Applied": { variant: "amber",  label: "Partially Applied" },
    "Posted":            { variant: "neutral",label: "Posted" },
  };
  const cfg = map[status] || { variant: "neutral", label: status };
  return <Badge variant={cfg.variant} size="sm">{cfg.label}</Badge>;
}

function withinDateRange(dateStr: string, range: string): boolean {
  if (range === "all") return true;
  const d = new Date(dateStr + "T00:00:00Z").getTime();
  const now = Date.now();
  if (range === "this-year") {
    const y = new Date(now).getUTCFullYear();
    return new Date(dateStr).getUTCFullYear() === y;
  }
  const ms = range === "last-12" ? 365*86400000
           : range === "last-90" ? 90*86400000
           : range === "last-30" ? 30*86400000 : 0;
  return d >= now - ms;
}

export function TransactionsTab({
  fetchUrl,
  scope, // "customer" | "project" — controls available filters
}: {
  fetchUrl: string;
  scope: "customer" | "project";
}) {
  const [rows, setRows] = useState<Txn[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");

  useEffect(() => {
    setLoading(true);
    fetch(fetchUrl)
      .then(r => r.ok ? r.json() : { rows: [], counts: {} })
      .then(data => {
        setRows(data.rows || []);
        setCounts(data.counts || {});
      })
      .finally(() => setLoading(false));
  }, [fetchUrl]);

  const filtered = useMemo(() => rows.filter(r => {
    if (typeFilter !== "all" && r.type !== typeFilter) return false;
    if (!withinDateRange(r.txnDate, dateFilter)) return false;
    return true;
  }), [rows, typeFilter, dateFilter]);

  // Running totals for the visible set
  const totals = useMemo(() => {
    let arIncrease = 0, arDecrease = 0, openBalance = 0;
    for (const r of filtered) {
      if (r.type === "Invoice" || r.type === "Refund Receipt") arIncrease += r.amount;
      if (r.type === "Credit Memo" || r.type === "Payment") arDecrease += Math.abs(r.amount);
      // Open balance only counts invoices (CM unapplied is negative AR, not open AR)
      if (r.type === "Invoice") openBalance += r.balance;
    }
    return { arIncrease, arDecrease, net: arIncrease - arDecrease, openBalance };
  }, [filtered]);

  return (
    <div className="space-y-3">
      {/* Filter bar */}
      <Card padding="sm">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Type</label>
            <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
              className="h-8 px-2 text-sm rounded-md ring-1 ring-stone-200 focus:ring-stone-400 focus:outline-none bg-white">
              {TYPE_FILTERS.map(f => {
                const n = f.id === "all" ? (counts.total ?? 0) : (counts[f.id] ?? 0);
                if (scope === "project" && f.id === "Refund Receipt") return null;
                return <option key={f.id} value={f.id}>{f.label} {n > 0 ? `(${n})` : ""}</option>;
              })}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Date</label>
            <select value={dateFilter} onChange={(e) => setDateFilter(e.target.value)}
              className="h-8 px-2 text-sm rounded-md ring-1 ring-stone-200 focus:ring-stone-400 focus:outline-none bg-white">
              {DATE_FILTERS.map(f => <option key={f.id} value={f.id}>{f.label}</option>)}
            </select>
          </div>

          {/* Net change in visible set */}
          {filtered.length > 0 && (
            <div className="ml-auto flex items-center gap-4 text-[11px]">
              <div>
                <div className="text-stone-400 uppercase tracking-wider mb-0.5">Billed</div>
                <div className="text-stone-700 tabular-nums">{fmt.money(totals.arIncrease, filtered[0]?.currency || "EUR")}</div>
              </div>
              <div>
                <div className="text-stone-400 uppercase tracking-wider mb-0.5">Received</div>
                <div className="text-stone-700 tabular-nums">{fmt.money(totals.arDecrease, filtered[0]?.currency || "EUR")}</div>
              </div>
              <div>
                <div className="text-stone-400 uppercase tracking-wider mb-0.5">Open AR</div>
                <div className="font-semibold tabular-nums text-rose-700">{fmt.money(totals.openBalance, filtered[0]?.currency || "EUR")}</div>
              </div>
              <div>
                <div className="text-stone-400 uppercase tracking-wider mb-0.5">Net</div>
                <div className="font-semibold tabular-nums text-stone-900">{fmt.money(totals.net, filtered[0]?.currency || "EUR")}</div>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Table */}
      <Card padding="none">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
              <th className="text-left font-semibold px-4 py-3 w-28">Date</th>
              <th className="text-left font-semibold px-4 py-3 w-40">Type</th>
              <th className="text-left font-semibold px-4 py-3 w-28">Number</th>
              <th className="text-left font-semibold px-4 py-3">Memo</th>
              <th className="text-right font-semibold px-4 py-3 w-28">Total</th>
              <th className="text-right font-semibold px-4 py-3 w-28">Balance</th>
              <th className="text-left font-semibold px-4 py-3 w-28">Status</th>
              <th className="text-right font-semibold px-4 py-3 w-16"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-400 text-sm">Loading…</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-8 text-center text-stone-400 text-sm">No transactions found for this filter.</td></tr>
            )}
            {filtered.map(r => {
              const showBalance = r.balance > 0.005;
              return (
                <tr key={r.id} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-4 py-3 text-stone-700 tabular-nums text-[12px]">
                    {new Date(r.txnDate + "T00:00:00Z").toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" })}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {typeIcon(r.type)}
                      <span className="text-stone-800">{r.type}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-stone-600 tabular-nums text-[12px]">{r.number || "—"}</td>
                  <td className="px-4 py-3 text-stone-500 text-[12px] truncate max-w-[300px]">{r.memo || ""}</td>
                  <td className={`px-4 py-3 text-right tabular-nums font-medium ${r.amount < 0 ? "text-stone-500" : "text-stone-900"}`}>
                    {fmt.money(Math.abs(r.amount), r.currency)}
                  </td>
                  <td className={`px-4 py-3 text-right tabular-nums font-semibold ${
                    showBalance
                      ? (r.type === "Invoice" ? "text-rose-700" : "text-amber-700")
                      : "text-stone-300"
                  }`}>
                    {showBalance ? fmt.money(r.balance, r.currency) : "—"}
                  </td>
                  <td className="px-4 py-3">{statusBadge(r.status)}</td>
                  <td className="px-4 py-3 text-right">
                    {(r.type === "Invoice" || r.type === "Credit Memo") && (
                      <Link href={`/invoices/${r.refId}`} className="text-[12px] text-brand-orange hover:text-brand-orange-dark font-medium">
                        View
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!loading && filtered.length > 0 && (
          <div className="px-4 py-2 border-t border-stone-100 text-[11px] text-stone-500 flex items-center justify-between">
            <span>Showing {filtered.length} of {rows.length} transactions</span>
            <span className="text-stone-400">Balance shown for unpaid invoices and partially-applied credits/payments only</span>
          </div>
        )}
      </Card>
    </div>
  );
}
