"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import Link from "next/link";
import {
  Users, Loader, RefreshCw, Search, TrendingUp, Building2, Download,
  ArrowUp, ArrowDown, ChevronsUpDown, X,
} from "lucide-react";
import { Card, Badge, Toast } from "@/components/ui";
import { fmt } from "@/lib/format";

type Customer = {
  orgId: string; name: string; email: string | null; hasSub: boolean;
  source: string | null; status: string; isActive: boolean;
  planName: string | null; planAmount: number | null; planCurrency: string; planInterval: string | null;
  billing: string; mrr: number;
  lastPayment: number | null; lastPaymentStatus: string | null; lastPaymentAmount: number | null;
  renewsAt: number | null;
};

const STATUS_BADGE: Record<string, string> = {
  active: "green", trialing: "blue", past_due: "red", unpaid: "red",
  canceled: "neutral", cancelled: "neutral", incomplete: "yellow", none: "neutral",
};

type SortKey = "name" | "planName" | "billing" | "source" | "status" | "mrr" | "lastPayment" | "renewsAt";

const fmtDate = (t: number | null) => t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : "—";

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [summary, setSummary]     = useState<any>(null);
  const [loading, setLoading]     = useState(true);
  const [toast, setToast]         = useState<any>(null);

  // grid state
  const [q, setQ]                 = useState("");
  const [fName, setFName]         = useState("");
  const [fPlan, setFPlan]         = useState("");
  const [fBilling, setFBilling]   = useState("");
  const [fSource, setFSource]     = useState("");
  const [fStatus, setFStatus]     = useState("");
  const [sort, setSort]           = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/customers");
      const d = await r.json();
      if (r.ok) { setCustomers(d.customers ?? []); setSummary(d.summary ?? null); }
      else setToast({ type: "error", message: d.error ?? `Failed (${r.status})` });
    } catch (e: any) { setToast({ type: "error", message: e?.message ?? "Network error" }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleSort = (key: SortKey) =>
    setSort(s => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });

  const rows = useMemo(() => {
    let r = customers.filter(c => {
      if (q && !`${c.name} ${c.email ?? ""} ${c.planName ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (fName && !`${c.name} ${c.email ?? ""}`.toLowerCase().includes(fName.toLowerCase())) return false;
      if (fPlan && !(c.planName ?? "").toLowerCase().includes(fPlan.toLowerCase())) return false;
      if (fBilling && c.billing !== fBilling) return false;
      if (fSource && (c.source ?? "none") !== fSource) return false;
      if (fStatus && c.status !== fStatus) return false;
      return true;
    });
    const dir = sort.dir === "asc" ? 1 : -1;
    r = [...r].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
    return r;
  }, [customers, q, fName, fPlan, fBilling, fSource, fStatus, sort]);

  const ccy = summary?.currency ?? "GBP";
  const anyFilter = q || fName || fPlan || fBilling || fSource || fStatus;
  const clearAll = () => { setQ(""); setFName(""); setFPlan(""); setFBilling(""); setFSource(""); setFStatus(""); };

  const exportCsv = () => {
    const head = ["Customer", "Email", "Plan", "Billing", "Source", "Status", "MRR", "Last payment", "Renews/Expires"];
    const lines = rows.map(c => [
      c.name, c.email ?? "", c.planName ?? "", c.billing, c.source ?? "", c.status,
      c.mrr ? (c.mrr / 100).toFixed(2) : "0", c.lastPayment ? new Date(c.lastPayment).toISOString().slice(0, 10) : "",
      c.renewsAt ? new Date(c.renewsAt).toISOString().slice(0, 10) : "",
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const SortHead = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <th className={`px-3 py-2.5 text-[11px] text-stone-500 font-medium ${right ? "text-right" : "text-left"}`}>
      <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-stone-300 ${right ? "flex-row-reverse" : ""}`}>
        {label}
        {sort.key === k ? (sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ChevronsUpDown size={11} className="text-stone-700" />}
      </button>
    </th>
  );

  const selCls = "w-full h-7 px-1.5 text-[11px] rounded bg-stone-800/60 border border-stone-700 text-stone-300 focus:border-stone-500 focus:outline-none";
  const txtCls = "w-full h-7 px-2 text-[11px] rounded bg-stone-800/60 border border-stone-700 text-stone-300 placeholder-stone-600 focus:border-stone-500 focus:outline-none";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-base font-semibold text-white">Customers</h1>
          <p className="text-xs text-stone-500 mt-0.5">{rows.length} of {customers.length} · billing &amp; subscription across all organisations</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 h-8 px-2 rounded-md bg-stone-800/60 border border-stone-700">
            <Search size={13} className="text-stone-500" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className="w-44 bg-transparent text-xs text-stone-200 placeholder-stone-600 focus:outline-none" />
          </div>
          {anyFilter && <button onClick={clearAll} className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-200"><X size={12} /> Clear</button>}
          <button onClick={exportCsv} className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-stone-700 bg-stone-800/50 text-stone-300 hover:bg-stone-700"><Download size={13} /> Export</button>
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 h-8 px-2 text-xs text-stone-400 hover:text-stone-200 disabled:opacity-40"><RefreshCw size={12} className={loading ? "animate-spin" : ""} /></button>
        </div>
      </div>

      {/* Summary */}
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Customers", value: summary.total, icon: Users, accent: "text-stone-600" },
            { label: "Active", value: summary.active, icon: Building2, accent: "text-emerald-400" },
            { label: "MRR (approx)", value: fmt.money(summary.totalMrr / 100, ccy), icon: TrendingUp, accent: "text-emerald-400" },
          ].map(s => (
            <div key={s.label} className="p-3 rounded-xl border border-stone-800 bg-stone-900/50">
              <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-stone-500">{s.label}</span><s.icon size={13} className={s.accent} /></div>
              <p className="text-xl font-semibold text-white tabular-nums">{s.value}</p>
            </div>
          ))}
        </div>
      )}

      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-3">{[1,2,3,4,5,6].map(i => <div key={i} className="h-11 bg-stone-800 rounded animate-pulse" />)}</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[920px]">
              <thead>
                <tr className="border-b border-stone-800">
                  <SortHead k="name" label="Customer" />
                  <SortHead k="planName" label="Plan" />
                  <SortHead k="billing" label="Billing" />
                  <SortHead k="source" label="Source" />
                  <SortHead k="status" label="Status" />
                  <SortHead k="mrr" label="MRR" right />
                  <SortHead k="lastPayment" label="Last payment" />
                  <SortHead k="renewsAt" label="Renews / Expires" />
                  <th className="px-3 py-2.5" />
                </tr>
                {/* Filter row */}
                <tr className="border-b border-stone-800 bg-stone-900/40">
                  <td className="px-3 py-1.5"><input value={fName} onChange={e => setFName(e.target.value)} placeholder="name / email" className={txtCls} /></td>
                  <td className="px-3 py-1.5"><input value={fPlan} onChange={e => setFPlan(e.target.value)} placeholder="plan" className={txtCls} /></td>
                  <td className="px-3 py-1.5">
                    <select value={fBilling} onChange={e => setFBilling(e.target.value)} className={selCls}>
                      <option value="">All</option><option>Monthly</option><option>Annual</option><option>Custom</option><option value="—">None</option>
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <select value={fSource} onChange={e => setFSource(e.target.value)} className={selCls}>
                      <option value="">All</option><option value="stripe">Stripe</option><option value="manual">Manual</option><option value="none">No sub</option>
                    </select>
                  </td>
                  <td className="px-3 py-1.5">
                    <select value={fStatus} onChange={e => setFStatus(e.target.value)} className={selCls}>
                      <option value="">All</option><option value="active">Active</option><option value="trialing">Trialing</option>
                      <option value="past_due">Past due</option><option value="canceled">Canceled</option><option value="incomplete">Incomplete</option><option value="none">No sub</option>
                    </select>
                  </td>
                  <td /><td /><td /><td />
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <tr><td colSpan={9} className="py-14 text-center text-sm text-stone-500">No customers match these filters</td></tr>
                ) : rows.map(c => (
                  <tr key={c.orgId} className="border-b border-stone-800/50 hover:bg-stone-800/25">
                    <td className="px-3 py-2.5">
                      <Link href={`/admin/customers/${c.orgId}`} className="text-white text-xs font-medium hover:text-emerald-400">{c.name}</Link>
                      {c.email && <p className="text-[11px] text-stone-500 truncate max-w-[210px]">{c.email}</p>}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-stone-300">
                      {c.planName ?? <span className="text-stone-600">—</span>}
                      {c.planAmount ? <div className="text-[11px] text-stone-500">{fmt.money(c.planAmount / 100, c.planCurrency)}{c.planInterval ? `/${c.planInterval}` : ""}</div> : null}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-stone-400">{c.billing}</td>
                    <td className="px-3 py-2.5 text-xs text-stone-400 capitalize">{c.source ?? "—"}</td>
                    <td className="px-3 py-2.5"><Badge variant={(STATUS_BADGE[c.status] ?? "neutral") as any}>{c.status === "none" ? "no sub" : c.status}</Badge></td>
                    <td className="px-3 py-2.5 text-xs text-stone-200 tabular-nums text-right">{c.mrr ? fmt.money(c.mrr / 100, c.planCurrency) : "—"}</td>
                    <td className="px-3 py-2.5 text-[11px]">
                      {c.lastPayment ? (
                        <span className={c.lastPaymentStatus === "failed" ? "text-rose-400" : "text-stone-400"}>{fmtDate(c.lastPayment)}</span>
                      ) : <span className="text-stone-600">—</span>}
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-stone-400">{fmtDate(c.renewsAt)}</td>
                    <td className="px-3 py-2.5 text-right"><Link href={`/admin/customers/${c.orgId}`} className="text-[11px] text-sky-400 hover:text-sky-300">View →</Link></td>
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
