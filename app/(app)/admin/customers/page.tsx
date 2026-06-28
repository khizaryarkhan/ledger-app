"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Building2, Search, AlertTriangle, RefreshCw, Users, TrendingUp,
  Clock, AlertCircle, Zap, Activity, Mail, CheckCircle2, XCircle,
  ChevronRight, ExternalLink,
} from "lucide-react";
import { fmt } from "@/lib/format";

// ─── Types ───────────────────────────────────────────────────────────────────

type Customer = {
  orgId: string; accountId: string | null; name: string; email: string | null;
  hasSub: boolean; source: string | null; status: string; isActive: boolean;
  planName: string | null; planAmount: number | null; planCurrency: string;
  planInterval: string | null; billing: string; mrr: number;
  lastPayment: number | null; lastPaymentStatus: string | null; renewsAt: number | null;
};

type Health = {
  orgId: string; lastLogin: number | null; daysSinceLogin: number | null;
  totalInvoices: number; overdueInvoices: number; paidInvoices: number; arValue: number;
  emails30d: number; emailsTotal: number;
  integrationConnected: boolean; integrationType: string | null;
  integrationStatus: string | null; integrationSyncedAt: number | null;
  lastCronRun: number | null; emailsSentByCron: number;
};

type Row = Customer & { health: Health | null };

// ─── Health scoring ───────────────────────────────────────────────────────────

function scoreHealth(c: Customer, h: Health | null) {
  if (!h) return { score: 0, label: "unknown", tier: "unknown" as const };
  let score = 100;

  if (!c.isActive && c.hasSub) score -= 30;
  if (!c.hasSub) score -= 15;
  if (c.lastPaymentStatus === "failed") score -= 25;

  const dsl = h.daysSinceLogin;
  if (dsl === null) score -= 35;
  else if (dsl > 60) score -= 30;
  else if (dsl > 30) score -= 20;
  else if (dsl > 14) score -= 8;

  if (!h.integrationConnected) score -= 15;
  else if (h.integrationStatus === "error") score -= 8;

  if (h.totalInvoices > 0) {
    const ratio = h.overdueInvoices / h.totalInvoices;
    if (ratio > 0.5) score -= 20;
    else if (ratio > 0.2) score -= 10;
  }

  score = Math.max(0, Math.min(100, score));
  if (score >= 75) return { score, label: "Healthy", tier: "healthy" as const };
  if (score >= 50) return { score, label: "Fair",    tier: "fair"    as const };
  if (score >= 25) return { score, label: "At risk", tier: "at_risk" as const };
  return               { score, label: "Dormant",    tier: "dormant" as const };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TIER_DOT: Record<string, string> = {
  healthy: "bg-emerald-400",
  fair:    "bg-amber-400",
  at_risk: "bg-orange-400",
  dormant: "bg-rose-400",
  unknown: "bg-stone-600",
};
const TIER_TEXT: Record<string, string> = {
  healthy: "text-emerald-300",
  fair:    "text-amber-300",
  at_risk: "text-orange-300",
  dormant: "text-rose-300",
  unknown: "text-stone-500",
};
const TIER_BAR: Record<string, string> = {
  healthy: "bg-emerald-500",
  fair:    "bg-amber-500",
  at_risk: "bg-orange-500",
  dormant: "bg-rose-600",
  unknown: "bg-stone-700",
};
const STATUS_CLS: Record<string, string> = {
  active:    "bg-emerald-500/15 text-emerald-300",
  trialing:  "bg-sky-500/15 text-sky-300",
  past_due:  "bg-rose-500/15 text-rose-300",
  canceled:  "bg-stone-700/60 text-stone-400",
  cancelled: "bg-stone-700/60 text-stone-400",
  none:      "bg-stone-700/40 text-stone-500",
};
const INT_CLS: Record<string, string> = {
  QBO:  "bg-green-500/15 text-green-300 border-green-500/20",
  Xero: "bg-blue-500/15 text-blue-300 border-blue-500/20",
  Sage: "bg-violet-500/15 text-violet-300 border-violet-500/20",
};

function relTime(ms: number | null): { text: string; urgent: boolean } {
  if (!ms) return { text: "Never", urgent: true };
  const days = Math.floor((Date.now() - ms) / 86_400_000);
  if (days === 0) return { text: "Today", urgent: false };
  if (days === 1) return { text: "Yesterday", urgent: false };
  if (days < 7)  return { text: `${days}d ago`, urgent: false };
  if (days < 30) return { text: `${Math.floor(days / 7)}w ago`, urgent: days > 21 };
  if (days < 365) return { text: `${Math.floor(days / 30)}mo ago`, urgent: true };
  return { text: `${Math.floor(days / 365)}y ago`, urgent: true };
}

function money(v: number, ccy = "GBP") {
  return fmt.money(v, ccy.toUpperCase());
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({
  label, value, sub, color = "text-white", icon: Icon, accent,
}: {
  label: string; value: string | number; sub?: string; color?: string;
  icon: React.ElementType; accent?: string;
}) {
  return (
    <div className={`relative rounded-2xl border bg-stone-900/50 p-4 overflow-hidden ${accent ? `border-${accent}-500/20` : "border-stone-800"}`}>
      {accent && <div className={`absolute inset-0 bg-${accent}-500/3 pointer-events-none`} />}
      <div className="flex items-start justify-between mb-2">
        <p className="text-[11px] uppercase tracking-wider font-semibold text-stone-500">{label}</p>
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${accent ? `bg-${accent}-500/10` : "bg-stone-800"}`}>
          <Icon size={13} className={accent ? `text-${accent}-400` : "text-stone-500"} />
        </div>
      </div>
      <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
      {sub && <p className="text-[11px] text-stone-600 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type TabKey = "all" | "healthy" | "fair" | "at_risk" | "dormant" | "no_integration";

export default function CustomersPage() {
  const router = useRouter();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [healthMap, setHealthMap] = useState<Map<string, Health>>(new Map());
  const [summary, setSummary] = useState<{ total: number; active: number; totalMrr: number; currency: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<TabKey>("all");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [billingRes, healthRes] = await Promise.all([
        fetch("/api/admin/customers"),
        fetch("/api/admin/customers/health"),
      ]);
      if (!billingRes.ok) throw new Error("Failed to load customers");
      const billing = await billingRes.json();
      const healthArr: Health[] = healthRes.ok ? await healthRes.json() : [];
      setCustomers(billing.customers ?? []);
      setSummary(billing.summary ?? null);
      setHealthMap(new Map(healthArr.map(h => [h.orgId, h])));
    } catch (e: any) {
      setError(e.message ?? "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Merge + score
  const rows: Row[] = useMemo(() => customers.map(c => ({ ...c, health: healthMap.get(c.orgId) ?? null })), [customers, healthMap]);

  // KPI aggregates
  const kpi = useMemo(() => {
    const healthy   = rows.filter(r => scoreHealth(r, r.health).tier === "healthy").length;
    const atRisk    = rows.filter(r => ["at_risk", "dormant"].includes(scoreHealth(r, r.health).tier)).length;
    const dormant   = rows.filter(r => (r.health?.daysSinceLogin ?? 999) > 30 || r.health?.daysSinceLogin === null).length;
    const noInt     = rows.filter(r => !r.health?.integrationConnected).length;
    const emails30d = rows.reduce((s, r) => s + (r.health?.emails30d ?? 0), 0);
    return { healthy, atRisk, dormant, noInt, emails30d };
  }, [rows]);

  // Search + tab filter
  const filtered = useMemo(() => {
    let list = rows;
    const term = q.trim().toLowerCase();
    if (term) list = list.filter(r =>
      r.name.toLowerCase().includes(term) ||
      (r.email ?? "").toLowerCase().includes(term) ||
      (r.planName ?? "").toLowerCase().includes(term),
    );
    if (tab === "healthy")        list = list.filter(r => scoreHealth(r, r.health).tier === "healthy");
    if (tab === "fair")           list = list.filter(r => scoreHealth(r, r.health).tier === "fair");
    if (tab === "at_risk")        list = list.filter(r => ["at_risk", "dormant"].includes(scoreHealth(r, r.health).tier));
    if (tab === "dormant")        list = list.filter(r => (r.health?.daysSinceLogin ?? 999) > 30 || r.health?.daysSinceLogin === null);
    if (tab === "no_integration") list = list.filter(r => !r.health?.integrationConnected);
    return list;
  }, [rows, q, tab]);

  const tabs: { key: TabKey; label: string; count: number }[] = [
    { key: "all",            label: "All",            count: rows.length },
    { key: "healthy",        label: "Healthy",        count: rows.filter(r => scoreHealth(r, r.health).tier === "healthy").length },
    { key: "fair",           label: "Fair",           count: rows.filter(r => scoreHealth(r, r.health).tier === "fair").length },
    { key: "at_risk",        label: "At risk",        count: rows.filter(r => ["at_risk","dormant"].includes(scoreHealth(r, r.health).tier)).length },
    { key: "dormant",        label: "Dormant 30d+",   count: kpi.dormant },
    { key: "no_integration", label: "No integration", count: kpi.noInt },
  ];

  return (
    <div className="max-w-[1200px] mx-auto space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Customers</h1>
          <p className="text-xs text-stone-500 mt-0.5">
            Product health, subscription state, and engagement for every provisioned organisation.{" "}
            <button onClick={() => router.push("/admin/accounts")} className="text-sky-400 hover:text-sky-300">Billing actions →</button>
          </p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 h-8 px-3 text-xs text-stone-400 hover:text-stone-200 border border-stone-700 hover:border-stone-600 rounded-lg">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2">
          <AlertTriangle size={13} /> {error}
        </div>
      )}

      {/* KPI grid */}
      {!loading && summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard label="Total customers"     value={summary.total}       icon={Users}         sub="organisations provisioned" />
          <KpiCard label="Active subs"         value={summary.active}      icon={CheckCircle2}  color="text-emerald-400" accent="emerald" sub={`${summary.total - summary.active} inactive`} />
          <KpiCard label="At risk / dormant"   value={kpi.atRisk}          icon={AlertCircle}   color={kpi.atRisk > 0 ? "text-orange-400" : "text-stone-400"} accent={kpi.atRisk > 0 ? "orange" : undefined} sub="need attention" />
          <KpiCard label="Emails sent (30d)"   value={kpi.emails30d.toLocaleString()} icon={Mail} color="text-sky-400" accent="sky" sub="automated reminders" />
          <KpiCard label="Total MRR"           value={money(summary.totalMrr, summary.currency)} icon={TrendingUp} color="text-white" sub="monthly recurring" />
        </div>
      )}

      {loading && (
        <div className="grid grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-24 rounded-2xl bg-stone-900/50 border border-stone-800 animate-pulse" />
          ))}
        </div>
      )}

      {/* Tabs + search */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="flex items-center gap-1 p-1 rounded-xl bg-stone-900 border border-stone-800 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-3 h-7 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors ${tab === t.key ? "bg-stone-700 text-white" : "text-stone-500 hover:text-stone-300"}`}>
              {t.label}
              <span className={`text-[10px] px-1 rounded ${tab === t.key ? "text-stone-400" : "text-stone-600"}`}>{t.count}</span>
            </button>
          ))}
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search by name, email, plan…"
            className="w-full h-9 pl-8 pr-3 text-sm rounded-xl border border-stone-700 bg-stone-900 text-stone-200 placeholder-stone-600 focus:outline-none focus:border-emerald-500" />
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-20 text-center border border-stone-800 rounded-2xl">
          <Building2 size={26} className="text-stone-700 mx-auto mb-3" />
          <p className="text-sm text-stone-400">{q ? "No matches found." : "No customers in this view."}</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-stone-800 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[960px]">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  {["Customer", "Org ID", "Plan / Status", "Health", "Last Active", "Emails (30d)", "Integration", "MRR"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[10px] uppercase tracking-wider text-stone-500 font-semibold">{h}</th>
                  ))}
                  <th className="w-8" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const { score, label, tier } = scoreHealth(r, r.health);
                  const login = relTime(r.health?.lastLogin ?? null);
                  const intType = r.health?.integrationType;
                  const intOk = r.health?.integrationStatus === "success";

                  return (
                    <tr key={r.orgId}
                      onClick={() => router.push(r.accountId ? `/admin/accounts/${r.accountId}` : `/admin/customers/${r.orgId}`)}
                      className="border-b border-stone-800/50 hover:bg-stone-800/20 cursor-pointer group">

                      {/* Customer */}
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-stone-100 group-hover:text-white">{r.name}</div>
                        <div className="text-[11px] text-stone-500 truncate max-w-[180px]">{r.email ?? "—"}</div>
                      </td>

                      {/* Org ID */}
                      <td className="px-4 py-3.5">
                        <span className="font-mono text-[10px] text-stone-500 select-all">{r.orgId.slice(0, 8)}…</span>
                      </td>

                      {/* Plan / Status */}
                      <td className="px-4 py-3.5">
                        <div className="text-stone-300 text-[13px]">{r.planName ?? "—"}</div>
                        <span className={`inline-flex mt-1 text-[10px] px-1.5 py-0.5 rounded capitalize font-medium ${STATUS_CLS[r.status] ?? STATUS_CLS.none}`}>
                          {r.status.replace(/_/g, " ")}
                        </span>
                      </td>

                      {/* Health */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full shrink-0 ${TIER_DOT[tier]}`} />
                          <span className={`text-[12px] font-medium ${TIER_TEXT[tier]}`}>{label}</span>
                        </div>
                        {/* Score bar */}
                        <div className="mt-1.5 h-1 w-20 bg-stone-800 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${TIER_BAR[tier]}`} style={{ width: `${score}%` }} />
                        </div>
                      </td>

                      {/* Last Active */}
                      <td className="px-4 py-3.5">
                        <div className={`text-[12px] font-medium ${login.urgent ? "text-rose-300" : "text-stone-300"}`}>{login.text}</div>
                        <div className="text-[10px] text-stone-600 mt-0.5">Last login</div>
                      </td>

                      {/* Emails 30d */}
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5">
                          <Activity size={12} className={r.health?.emails30d ? "text-sky-400" : "text-stone-600"} />
                          <span className={`text-[13px] font-semibold tabular-nums ${r.health?.emails30d ? "text-sky-300" : "text-stone-600"}`}>
                            {r.health?.emails30d ?? 0}
                          </span>
                        </div>
                        <div className="text-[10px] text-stone-600 mt-0.5">{r.health?.emailsTotal ?? 0} total</div>
                      </td>

                      {/* Integration */}
                      <td className="px-4 py-3.5">
                        {intType ? (
                          <div className="flex items-center gap-1.5">
                            <span className={`text-[10px] px-1.5 py-0.5 rounded border font-semibold ${INT_CLS[intType] ?? "bg-stone-700 text-stone-300 border-stone-600"}`}>{intType}</span>
                            {intOk
                              ? <CheckCircle2 size={11} className="text-emerald-400" />
                              : <XCircle size={11} className="text-rose-400" />}
                          </div>
                        ) : (
                          <span className="text-[11px] text-stone-600">Not connected</span>
                        )}
                        {r.health?.integrationSyncedAt && (
                          <div className="text-[10px] text-stone-600 mt-0.5">{relTime(r.health.integrationSyncedAt).text}</div>
                        )}
                      </td>

                      {/* MRR */}
                      <td className="px-4 py-3.5">
                        <div className={`text-[13px] font-semibold tabular-nums ${r.mrr > 0 ? "text-white" : "text-stone-600"}`}>
                          {r.mrr > 0 ? money(r.mrr, r.planCurrency) : "—"}
                        </div>
                        {r.renewsAt && (
                          <div className="text-[10px] text-stone-600 mt-0.5">
                            renews {new Date(r.renewsAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </div>
                        )}
                      </td>

                      {/* Arrow */}
                      <td className="px-3 py-3.5">
                        <ChevronRight size={14} className="text-stone-700 group-hover:text-stone-400 transition-colors" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Footer bar */}
          <div className="px-4 py-2.5 bg-stone-900/40 border-t border-stone-800 flex items-center justify-between">
            <span className="text-[11px] text-stone-600">{filtered.length} of {rows.length} customers</span>
            <span className="text-[11px] text-stone-600">
              {rows.filter(r => r.isActive).length} active · {rows.filter(r => r.health?.integrationConnected).length} integrated
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
