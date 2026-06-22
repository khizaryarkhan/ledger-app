"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Users, Loader, RefreshCw, Search, TrendingUp, Building2 } from "lucide-react";
import { Card, Badge, Toast } from "@/components/ui";
import { fmt } from "@/lib/format";

type Customer = {
  orgId: string; name: string; email: string | null; hasSub: boolean;
  source: string | null; status: string; isActive: boolean;
  planName: string | null; planAmount: number | null; planCurrency: string; planInterval: string | null; mrr: number;
};

const STATUS_BADGE: Record<string, string> = {
  active: "green", trialing: "blue", past_due: "red", unpaid: "red",
  canceled: "neutral", cancelled: "neutral", incomplete: "yellow", none: "neutral",
};

type Tab = "all" | "active" | "inactive" | "none";

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [summary, setSummary]     = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [q, setQ]                 = useState("");
  const [tab, setTab]             = useState<Tab>("all");
  const [toast, setToast]         = useState<any>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/customers");
      const d = await r.json();
      if (r.ok) { setCustomers(d.customers ?? []); setSummary(d.summary ?? null); }
      else setToast({ type: "error", message: d.error ?? `Failed (${r.status})` });
    } catch (e: any) {
      setToast({ type: "error", message: e?.message ?? "Network error" });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const counts = {
    all: customers.length,
    active: customers.filter(c => c.isActive).length,
    inactive: customers.filter(c => c.hasSub && !c.isActive).length,
    none: customers.filter(c => !c.hasSub).length,
  };
  const filtered = customers.filter(c => {
    if (tab === "active" && !c.isActive) return false;
    if (tab === "inactive" && !(c.hasSub && !c.isActive)) return false;
    if (tab === "none" && c.hasSub) return false;
    if (q && !(`${c.name} ${c.email ?? ""}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  const ccy = summary?.currency ?? "GBP";
  const tabs: { key: Tab; label: string }[] = [
    { key: "all", label: "All" }, { key: "active", label: "Active" },
    { key: "inactive", label: "Inactive" }, { key: "none", label: "No subscription" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Customers</h1>
          <p className="text-xs text-stone-500 mt-0.5">Every organisation, with billing &amp; subscription state</p>
        </div>
        <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200 disabled:opacity-40">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <div className="p-3 rounded-xl border border-stone-800 bg-stone-900/50">
            <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-stone-500">Customers</span><Users size={13} className="text-stone-600" /></div>
            <p className="text-xl font-semibold text-white tabular-nums">{summary.total}</p>
          </div>
          <div className="p-3 rounded-xl border border-stone-800 bg-stone-900/50">
            <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-stone-500">Active</span><Building2 size={13} className="text-emerald-400" /></div>
            <p className="text-xl font-semibold text-white tabular-nums">{summary.active}</p>
          </div>
          <div className="p-3 rounded-xl border border-stone-800 bg-stone-900/50">
            <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-stone-500">MRR</span><TrendingUp size={13} className="text-emerald-400" /></div>
            <p className="text-xl font-semibold text-white tabular-nums">{fmt.money(summary.totalMrr / 100, ccy)}</p>
          </div>
        </div>
      )}

      {/* Tabs + search */}
      <div className="flex items-center gap-3 border-b border-stone-800">
        <div className="flex gap-1">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px ${
                tab === t.key ? "border-emerald-500 text-white" : "border-transparent text-stone-500 hover:text-stone-300"
              }`}>
              {t.label}<span className="px-1.5 py-0.5 rounded-full text-[10px] bg-stone-800 text-stone-400">{counts[t.key]}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 mb-1.5">
          <Search size={13} className="text-stone-500" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search customers…"
            className="h-7 w-48 px-2 text-xs rounded-md bg-stone-800/60 border border-stone-700 text-stone-200 placeholder-stone-600 focus:border-stone-500 focus:outline-none" />
        </div>
      </div>

      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-3">{[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-stone-800 rounded animate-pulse" />)}</div>
        ) : !filtered.length ? (
          <div className="py-16 text-center"><Users size={28} className="text-stone-600 mx-auto mb-3" /><p className="text-sm text-stone-500">No customers in this view</p></div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead><tr className="border-b border-stone-800 text-[11px] text-stone-500">
                {["Customer", "Plan", "Status", "MRR", ""].map(h => <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>)}
              </tr></thead>
              <tbody>
                {filtered.map(c => (
                  <tr key={c.orgId} className="border-b border-stone-800/50 hover:bg-stone-800/25">
                    <td className="px-4 py-3">
                      <Link href={`/admin/customers/${c.orgId}`} className="text-white text-xs font-medium hover:text-emerald-400">{c.name}</Link>
                      {c.email && <p className="text-[11px] text-stone-500 truncate max-w-[200px]">{c.email}</p>}
                    </td>
                    <td className="px-4 py-3 text-xs text-stone-300">
                      {c.planName ?? <span className="text-stone-600">—</span>}
                      {c.planAmount ? <div className="text-[11px] text-stone-500">{fmt.money(c.planAmount / 100, c.planCurrency)}{c.planInterval ? `/${c.planInterval}` : ""}</div> : null}
                    </td>
                    <td className="px-4 py-3"><Badge variant={(STATUS_BADGE[c.status] ?? "neutral") as any}>{c.status === "none" ? "no sub" : c.status}</Badge></td>
                    <td className="px-4 py-3 text-xs text-stone-200 tabular-nums">{c.mrr ? fmt.money(c.mrr / 100, c.planCurrency) : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <Link href={`/admin/customers/${c.orgId}`} className="text-[11px] text-sky-400 hover:text-sky-300">View →</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
