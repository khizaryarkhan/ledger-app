"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Building2, Search, Loader, AlertTriangle } from "lucide-react";
import { fmt } from "@/lib/format";

type Customer = {
  orgId: string;
  name: string;
  email: string | null;
  status: string;
  isActive: boolean;
  planName: string | null;
  planAmount: number | null;
  planCurrency: string;
  planInterval: string | null;
  billing: string;
  mrr: number;
  lastPayment: number | null;
  lastPaymentStatus: string | null;
  renewsAt: number | null;
};

const STATUS_CLS: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-300",
  trialing: "bg-sky-500/15 text-sky-300",
  past_due: "bg-rose-500/15 text-rose-300",
  canceled: "bg-stone-700 text-stone-400",
  cancelled: "bg-stone-700 text-stone-400",
  none: "bg-stone-700 text-stone-500",
};

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [summary, setSummary] = useState<{ total: number; active: number; totalMrr: number; currency: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch("/api/admin/customers")
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Failed to load customers");
        return r.json();
      })
      .then(d => {
        setCustomers(d.customers ?? []);
        setSummary(d.summary ?? null);
      })
      .catch(e => setError(e.message ?? "Failed to load"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter(c =>
      c.name.toLowerCase().includes(term) ||
      (c.email ?? "").toLowerCase().includes(term) ||
      (c.planName ?? "").toLowerCase().includes(term),
    );
  }, [customers, q]);

  const money = (v: number, ccy?: string) => fmt.money(v ?? 0, (ccy || summary?.currency || "GBP").toUpperCase());

  return (
    <div className="max-w-[1100px] mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">Customers</h1>
        <p className="text-xs text-stone-500 mt-0.5">Provisioned organisations with subscriptions and billing. For billing actions (won deals, failed payments), see <button onClick={() => router.push("/admin/accounts")} className="text-sky-400 hover:text-sky-300">Billing actions</button>.</p>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {summary && !loading && (
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="rounded-xl border border-stone-800 bg-stone-900/50 p-3">
            <p className="text-[11px] text-stone-500">Total customers</p>
            <p className="text-2xl font-bold text-white tabular-nums">{summary.total}</p>
          </div>
          <div className="rounded-xl border border-stone-800 bg-stone-900/50 p-3">
            <p className="text-[11px] text-stone-500">Active subscriptions</p>
            <p className="text-2xl font-bold text-emerald-400 tabular-nums">{summary.active}</p>
          </div>
          <div className="rounded-xl border border-stone-800 bg-stone-900/50 p-3">
            <p className="text-[11px] text-stone-500">Total MRR</p>
            <p className="text-2xl font-bold text-white tabular-nums">{money(summary.totalMrr)}</p>
          </div>
        </div>
      )}

      <div className="relative mb-4 max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, email or plan…"
          className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-stone-700 bg-stone-900 text-stone-200 placeholder-stone-600 focus:outline-none focus:border-emerald-500" />
      </div>

      {loading ? (
        <div className="h-48 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse flex items-center justify-center">
          <Loader size={18} className="animate-spin text-stone-600" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center border border-stone-800 rounded-xl">
          <Building2 size={26} className="text-stone-700 mx-auto mb-3" />
          <p className="text-sm text-stone-400">{q ? "No customers match your search." : "No customers yet."}</p>
        </div>
      ) : (
        <div className="rounded-xl border border-stone-800 overflow-x-auto">
          <table className="w-full text-sm min-w-[720px]">
            <thead>
              <tr className="border-b border-stone-800 bg-stone-900/40">
                {["Customer", "Plan", "Status", "MRR", "Renews"].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-stone-500 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(c => (
                <tr key={c.orgId} onClick={() => router.push(`/admin/customers/${c.orgId}`)}
                  className="border-b border-stone-800/50 hover:bg-stone-800/20 cursor-pointer">
                  <td className="px-4 py-3">
                    <div className="text-stone-100 font-medium">{c.name}</div>
                    <div className="text-[11px] text-stone-500 truncate">{c.email ?? "—"}</div>
                  </td>
                  <td className="px-4 py-3 text-stone-300">{c.planName ?? "—"}<span className="text-stone-600 text-[11px] ml-1">{c.billing !== "—" ? `· ${c.billing}` : ""}</span></td>
                  <td className="px-4 py-3">
                    <span className={`text-[11px] px-2 py-0.5 rounded capitalize ${STATUS_CLS[c.status] ?? STATUS_CLS.none}`}>{c.status.replace(/_/g, " ")}</span>
                  </td>
                  <td className="px-4 py-3 text-stone-300 tabular-nums">{c.mrr > 0 ? money(c.mrr, c.planCurrency) : "—"}</td>
                  <td className="px-4 py-3 text-[11px] text-stone-500 whitespace-nowrap">
                    {c.renewsAt ? new Date(c.renewsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
