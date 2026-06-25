"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import {
  Building2, Search, Users, Loader, Plus, Pencil, Trash2, CreditCard,
  Download, X, ArrowUp, ArrowDown, ChevronsUpDown, TrendingUp,
} from "lucide-react";
import { Badge, Toast } from "@/components/ui";
import { fmt } from "@/lib/format";
import { CreateOrgModal, EditOrgModal, DeleteOrgModal, CopyId } from "../_org-management";

type Account = {
  id: string; ref: string; name: string; lifecycleStage: string; billingEmail: string | null; domain: string | null;
  country: string | null; organisationId: string | null; orgStatus: string | null; leadId: string | null;
  deals: number; userCount: number; org: any | null;
};

type Customer = {
  orgId: string; name: string; email: string | null; hasSub: boolean;
  source: string | null; status: string; isActive: boolean;
  planName: string | null; planAmount: number | null; planCurrency: string; planInterval: string | null;
  billing: string; mrr: number;
  lastPayment: number | null; lastPaymentStatus: string | null; lastPaymentAmount: number | null;
  renewsAt: number | null;
};

// One flat row per company — CRM attributes + billing attributes joined together.
type Row = {
  accountId: string; ref: string; name: string; email: string | null; slug: string | null; orgId: string | null;
  leadId: string | null; stage: string; deals: number; country: string | null;
  // billing facet (null when not yet a customer)
  status: string; source: string | null; billing: string; planName: string | null;
  planAmount: number | null; planCurrency: string; planInterval: string | null;
  mrr: number; lastPayment: number | null; lastPaymentStatus: string | null; renewsAt: number | null;
  org: any | null;
};

const STAGE: Record<string, { label: string; cls: string }> = {
  lead:      { label: "Lead",      cls: "bg-sky-500/15 text-sky-300" },
  prospect:  { label: "Prospect",  cls: "bg-blue-500/15 text-blue-300" },
  qualified: { label: "Qualified", cls: "bg-violet-500/15 text-violet-300" },
  customer:  { label: "Customer",  cls: "bg-emerald-500/15 text-emerald-300" },
  churned:   { label: "Churned",   cls: "bg-rose-500/15 text-rose-300" },
  archived:  { label: "Archived",  cls: "bg-stone-700 text-stone-400" },
};

const STATUS_BADGE: Record<string, string> = {
  active: "green", trialing: "blue", past_due: "red", unpaid: "red",
  canceled: "neutral", cancelled: "neutral", incomplete: "yellow", none: "neutral",
};

type SortKey = "ref" | "name" | "email" | "stage" | "status" | "planName" | "billing" | "source" | "mrr" | "deals" | "renewsAt";
const fmtDate = (t: number | null) => t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : "—";

export default function AccountsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const isSuperAdmin = (session?.user as any)?.role === "super_admin";

  const [accounts, setAccounts] = useState<Account[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [toast, setToast] = useState<any>(null);

  // Column filters — views are just filters over the one table, not separate tabs.
  const [q, setQ] = useState("");
  const [fStage, setFStage] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fSource, setFSource] = useState("");
  const [fBilling, setFBilling] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });

  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingOrg, setEditingOrg] = useState<any | null>(null);
  const [deletingOrg, setDeletingOrg] = useState<any | null>(null);

  // The Customers nav lands here pre-filtered to stage=customer; ?stage= overrides.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("stage");
    if (p && STAGE[p]) { setFStage(p); return; }
    if (window.location.pathname.includes("/admin/customers")) setFStage("customer");
  }, []);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch("/api/admin/accounts").then(r => r.ok ? r.json() : { accounts: [] }),
      fetch("/api/admin/customers").then(r => r.ok ? r.json() : { customers: [], summary: null }),
    ]).then(([a, c]) => {
      setAccounts(a.accounts ?? []); setNeedsSetup(!!a.needsSetup);
      setCustomers(c.customers ?? []); setSummary(c.summary ?? null);
    }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const sync = async () => {
    setSyncing(true); setMsg("");
    try {
      const r = await fetch("/api/admin/accounts/backfill", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setMsg(`Linked ${d.orgs} customers, ${d.leads} leads, ${d.opps} deals.`); load(); }
      else setMsg(d.error || "Backfill failed");
    } catch { setMsg("Backfill failed"); } finally { setSyncing(false); }
  };

  // Join: one row per account, billing facet attached by organisation id.
  const allRows = useMemo<Row[]>(() => {
    const custByOrg = new Map(customers.map(c => [c.orgId, c]));
    return accounts.map(a => {
      const c = a.organisationId ? custByOrg.get(a.organisationId) : undefined;
      return {
        accountId: a.id, ref: a.ref, name: a.name, email: a.billingEmail ?? c?.email ?? null,
        slug: a.org?.slug ?? null, orgId: a.organisationId, leadId: a.leadId,
        stage: a.lifecycleStage, deals: a.deals, country: a.country,
        status: c?.status ?? "none", source: c?.source ?? null, billing: c?.billing ?? "—",
        planName: c?.planName ?? null, planAmount: c?.planAmount ?? null,
        planCurrency: c?.planCurrency ?? "USD", planInterval: c?.planInterval ?? null,
        mrr: c?.mrr ?? 0, lastPayment: c?.lastPayment ?? null, lastPaymentStatus: c?.lastPaymentStatus ?? null,
        renewsAt: c?.renewsAt ?? null, org: a.org,
      };
    });
  }, [accounts, customers]);

  const rows = useMemo(() => {
    let r = allRows.filter(c => {
      if (q && !`${c.ref} ${c.name} ${c.email ?? ""} ${c.planName ?? ""} ${c.slug ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (fStage && c.stage !== fStage) return false;
      if (fStatus && c.status !== fStatus) return false;
      if (fSource && (c.source ?? "none") !== fSource) return false;
      if (fBilling && c.billing !== fBilling) return false;
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
  }, [allRows, q, fStage, fStatus, fSource, fBilling, sort]);

  const ccy = summary?.currency ?? "GBP";
  const anyFilter = q || fStage || fStatus || fSource || fBilling;
  const clearAll = () => { setQ(""); setFStage(""); setFStatus(""); setFSource(""); setFBilling(""); };

  const open = (r: Row) => {
    if (r.leadId) router.push(`/admin/leads/${r.leadId}`);
    else if (r.orgId) router.push(`/admin/customers/${r.orgId}`);
  };

  const exportCsv = () => {
    const head = ["Account ID", "Company", "Email", "Slug", "Stage", "Status", "Plan", "Billing", "Source", "MRR", "Deals", "Country", "Last payment", "Renews/Expires"];
    const lines = rows.map(c => [
      c.ref, c.name, c.email ?? "", c.slug ?? "", c.stage, c.status, c.planName ?? "", c.billing, c.source ?? "",
      c.mrr ? (c.mrr / 100).toFixed(2) : "0", String(c.deals), c.country ?? "",
      c.lastPayment ? new Date(c.lastPayment).toISOString().slice(0, 10) : "",
      c.renewsAt ? new Date(c.renewsAt).toISOString().slice(0, 10) : "",
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(","));
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `accounts-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSort = (key: SortKey) =>
    setSort(s => s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });

  const SortHead = ({ k, label, right }: { k: SortKey; label: string; right?: boolean }) => (
    <th className={`px-3 py-2.5 text-[10px] uppercase tracking-wider text-stone-500 font-semibold ${right ? "text-right" : "text-left"}`}>
      <button onClick={() => toggleSort(k)} className={`inline-flex items-center gap-1 hover:text-stone-300 ${right ? "flex-row-reverse" : ""}`}>
        {label}
        {sort.key === k ? (sort.dir === "asc" ? <ArrowUp size={11} /> : <ArrowDown size={11} />) : <ChevronsUpDown size={11} className="text-stone-700" />}
      </button>
    </th>
  );

  const selCls = "w-full h-7 px-1.5 text-[11px] rounded bg-stone-800/60 border border-stone-700 text-stone-300 focus:border-stone-500 focus:outline-none";

  return (
    <div className="max-w-[1500px] mx-auto">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-white">Accounts</h1>
          <p className="text-xs text-stone-500 mt-0.5">One table for every company — leads through customers. The single source of truth.</p>
        </div>
        <div className="flex items-center gap-3">
          {msg && <span className="text-[12px] text-emerald-400">{msg}</span>}
          <button onClick={exportCsv} className="flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border border-stone-700 bg-stone-800/50 text-stone-300 hover:bg-stone-700"><Download size={13} /> Export</button>
          <button onClick={sync} disabled={syncing}
            className="flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 disabled:opacity-60">
            {syncing ? <Loader size={13} className="animate-spin" /> : <Users size={13} />} {syncing ? "Linking…" : "Sync"}
          </button>
          {isSuperAdmin && (
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">
              <Plus size={14} /> New organisation
            </button>
          )}
        </div>
      </div>

      {/* Aggregates over the table (not a second list). */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          {[
            { label: "Companies", value: allRows.length, icon: Building2, accent: "text-stone-500" },
            { label: "Customers", value: summary.total, icon: Users, accent: "text-stone-500" },
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

      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search company, email, org id, plan…"
            className="w-full h-9 pl-8 pr-3 text-[13px] rounded-lg bg-stone-900 border border-stone-700 text-stone-200 placeholder-stone-600 focus:outline-none focus:border-emerald-500" />
        </div>
        {anyFilter && <button onClick={clearAll} className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-200 h-9 px-2"><X size={12} /> Clear filters</button>}
        <span className="ml-auto text-[12px] text-stone-500">{rows.length} of {allRows.length}</span>
      </div>

      {needsSetup && (
        <div className="mb-4 rounded-lg ring-1 ring-amber-500/30 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-300">
          The <span className="font-mono">crm_accounts</span> table isn't set up yet, or the backfill hasn't run — companies will appear here once it has.
        </div>
      )}

      {loading ? (
        <div className="h-64 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" />
      ) : (
        <div className="rounded-xl border border-stone-800 overflow-x-auto">
          <table className="w-full text-sm min-w-[1320px]">
            <thead>
              <tr className="border-b border-stone-800 bg-stone-900/40">
                <SortHead k="ref" label="Account ID" />
                <SortHead k="name" label="Company" />
                <SortHead k="email" label="Email" />
                <SortHead k="stage" label="Stage" />
                <SortHead k="status" label="Status" />
                <SortHead k="planName" label="Plan" />
                <SortHead k="billing" label="Billing" />
                <SortHead k="source" label="Source" />
                <SortHead k="mrr" label="MRR" right />
                <SortHead k="deals" label="Deals" right />
                <SortHead k="renewsAt" label="Renews / Expires" />
                <th className="px-3 py-2.5 w-24" />
              </tr>
              {/* Column filters */}
              <tr className="border-b border-stone-800 bg-stone-900/30">
                <td /><td /><td />
                <td className="px-3 py-1.5">
                  <select value={fStage} onChange={e => setFStage(e.target.value)} className={selCls}>
                    <option value="">All stages</option>
                    {Object.keys(STAGE).map(k => <option key={k} value={k}>{STAGE[k].label}</option>)}
                  </select>
                </td>
                <td className="px-3 py-1.5">
                  <select value={fStatus} onChange={e => setFStatus(e.target.value)} className={selCls}>
                    <option value="">All</option><option value="active">Active</option><option value="trialing">Trialing</option>
                    <option value="past_due">Past due</option><option value="canceled">Canceled</option><option value="incomplete">Incomplete</option><option value="none">No sub</option>
                  </select>
                </td>
                <td />
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
                <td /><td /><td /><td />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={12} className="py-14 text-center text-sm text-stone-500">No companies match these filters.</td></tr>
              ) : rows.map(c => {
                const s = STAGE[c.stage] ?? { label: c.stage, cls: "bg-stone-700 text-stone-400" };
                return (
                  <tr key={c.accountId} onClick={() => open(c)} className="border-b border-stone-800/50 hover:bg-stone-800/30 cursor-pointer">
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      <span className="font-mono text-[12px] text-stone-300 inline-flex items-center" onClick={e => e.stopPropagation()}>{c.ref || "—"}{c.ref && <CopyId id={c.ref} />}</span>
                    </td>
                    <td className="px-3 py-2.5 text-stone-100 font-medium whitespace-nowrap">{c.name}</td>
                    <td className="px-3 py-2.5 text-[12px] text-stone-400 whitespace-nowrap">{c.email || "—"}</td>
                    <td className="px-3 py-2.5"><span className={`text-[11px] px-2 py-0.5 rounded ${s.cls}`}>{s.label}</span></td>
                    <td className="px-3 py-2.5">{c.orgId ? <Badge variant={(STATUS_BADGE[c.status] ?? "neutral") as any}>{c.status === "none" ? "no sub" : c.status}</Badge> : <span className="text-stone-600 text-[11px]">—</span>}</td>
                    <td className="px-3 py-2.5 text-xs text-stone-300 whitespace-nowrap">{c.planName ? `${c.planName}${c.planAmount ? ` · ${fmt.money(c.planAmount / 100, c.planCurrency)}${c.planInterval ? `/${c.planInterval}` : ""}` : ""}` : <span className="text-stone-600">—</span>}</td>
                    <td className="px-3 py-2.5 text-xs text-stone-400">{c.billing}</td>
                    <td className="px-3 py-2.5 text-xs text-stone-400 capitalize">{c.source ?? "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-stone-200 tabular-nums text-right">{c.mrr ? fmt.money(c.mrr / 100, c.planCurrency) : "—"}</td>
                    <td className="px-3 py-2.5 text-xs text-stone-400 tabular-nums text-right">{c.deals || "—"}</td>
                    <td className="px-3 py-2.5 text-[11px] text-stone-400 whitespace-nowrap">{fmtDate(c.renewsAt)}</td>
                    <td className="px-3 py-2.5">
                      {c.orgId && (
                        <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                          <button onClick={() => router.push(`/admin/customers/${c.orgId}`)} title="Billing & invoices"
                            className="p-1.5 hover:bg-stone-800 rounded text-stone-500 hover:text-stone-200 transition-colors"><CreditCard size={13} /></button>
                          {isSuperAdmin && c.org && (
                            <>
                              <button onClick={() => setEditingOrg(c.org)} title="Edit organisation"
                                className="p-1.5 hover:bg-stone-800 rounded text-stone-400 hover:text-stone-200 transition-colors"><Pencil size={13} /></button>
                              <button onClick={() => setDeletingOrg(c.org)} title="Delete organisation"
                                className="p-1.5 hover:bg-rose-500/15 rounded text-stone-500 hover:text-rose-400 transition-colors"><Trash2 size={13} /></button>
                            </>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <CreateOrgModal onClose={() => setShowCreate(false)} onCreated={load} />}
      {editingOrg && <EditOrgModal org={editingOrg} onClose={() => setEditingOrg(null)} onSaved={() => { load(); setEditingOrg(null); }} />}
      {deletingOrg && <DeleteOrgModal org={deletingOrg} onClose={() => setDeletingOrg(null)} onDeleted={load} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
