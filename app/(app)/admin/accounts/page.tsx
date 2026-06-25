"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  Building2, Search, Users, Loader, Plus, Pencil, Trash2, CreditCard,
  Download, X, ArrowUp, ArrowDown, ChevronsUpDown, TrendingUp,
} from "lucide-react";
import { Badge, Card, Toast } from "@/components/ui";
import { fmt } from "@/lib/format";
import { SubStatusBadge, fmtPlan, CreateOrgModal, EditOrgModal, DeleteOrgModal, CopyId } from "../_org-management";

type Account = {
  id: string; name: string; lifecycleStage: string; billingEmail: string | null; domain: string | null;
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

type Segment = "all" | "leads" | "customers";
const LEAD_STAGES = ["lead", "prospect", "qualified"];

export default function AccountsPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const isSuperAdmin = (session?.user as any)?.role === "super_admin";

  const [seg, setSeg] = useState<Segment>("all");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [toast, setToast] = useState<any>(null);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editingOrg, setEditingOrg] = useState<any | null>(null);
  const [deletingOrg, setDeletingOrg] = useState<any | null>(null);

  // One component, two routes: /admin/customers lands on the Customers segment,
  // /admin/accounts on All. ?seg= overrides either.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("seg");
    if (p === "customers" || p === "leads" || p === "all") { setSeg(p); return; }
    if (window.location.pathname.includes("/admin/customers")) setSeg("customers");
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

  // One-click backfill: links existing orgs/leads/deals to accounts (idempotent).
  const sync = async () => {
    setSyncing(true); setMsg("");
    try {
      const r = await fetch("/api/admin/accounts/backfill", { method: "POST" });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setMsg(`Linked ${d.orgs} customers, ${d.leads} leads, ${d.opps} deals.`); load(); }
      else setMsg(d.error || "Backfill failed");
    } catch { setMsg("Backfill failed"); } finally { setSyncing(false); }
  };

  const open = (a: Account) => {
    if (a.leadId) router.push(`/admin/leads/${a.leadId}`);
    else if (a.organisationId) router.push(`/admin/customers/${a.organisationId}`);
  };

  const counts = useMemo(() => ({
    all: accounts.length,
    leads: accounts.filter(a => LEAD_STAGES.includes(a.lifecycleStage)).length,
    customers: accounts.filter(a => a.lifecycleStage === "customer").length,
  }), [accounts]);

  const accountRows = useMemo(() => accounts.filter(a => {
    if (seg === "leads" && !LEAD_STAGES.includes(a.lifecycleStage)) return false;
    if (stage && a.lifecycleStage !== stage) return false;
    if (q && !`${a.name} ${a.billingEmail ?? ""} ${a.domain ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [accounts, q, stage, seg]);

  const SEGMENTS: { key: Segment; label: string }[] = [
    { key: "all", label: "All" }, { key: "leads", label: "Leads" }, { key: "customers", label: "Customers" },
  ];

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-white">Accounts</h1>
          <p className="text-xs text-stone-500 mt-0.5">Every company in one place — prospects through customers. The single source of truth.</p>
        </div>
        <div className="flex items-center gap-3">
          {msg && <span className="text-[12px] text-emerald-400">{msg}</span>}
          <button onClick={sync} disabled={syncing}
            className="flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 disabled:opacity-60">
            {syncing ? <Loader size={13} className="animate-spin" /> : <Users size={13} />} {syncing ? "Linking…" : "Sync accounts"}
          </button>
          {isSuperAdmin && (
            <button onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">
              <Plus size={14} /> New organisation
            </button>
          )}
        </div>
      </div>

      {/* Segment switcher — one directory, three lenses. */}
      <div className="flex items-center gap-1 mb-4 p-1 rounded-lg bg-stone-900 border border-stone-800 w-fit">
        {SEGMENTS.map(sgm => (
          <button key={sgm.key} onClick={() => { setSeg(sgm.key); setStage(""); }}
            className={`px-3.5 h-8 text-xs font-medium rounded-md transition-colors ${seg === sgm.key ? "bg-stone-700 text-white" : "text-stone-400 hover:text-stone-200"}`}>
            {sgm.label} <span className="text-stone-500">{counts[sgm.key]}</span>
          </button>
        ))}
      </div>

      {needsSetup && (
        <div className="mb-4 rounded-lg ring-1 ring-amber-500/30 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-300">
          The <span className="font-mono">crm_accounts</span> table isn't set up yet, or the backfill hasn't run — companies will appear here once it has.
        </div>
      )}

      {loading ? (
        <div className="h-64 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" />
      ) : seg === "customers" ? (
        <CustomersSegment customers={customers} summary={summary} onRefresh={load} />
      ) : (
        <>
          <div className="flex items-center gap-2 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search company, email, domain…"
                className="w-full h-9 pl-8 pr-3 text-[13px] rounded-lg bg-stone-900 border border-stone-700 text-stone-200 placeholder-stone-600 focus:outline-none focus:border-emerald-500" />
            </div>
            {seg === "all" && (
              <select value={stage} onChange={e => setStage(e.target.value)} className="h-9 px-2.5 text-xs rounded-lg bg-stone-900 border border-stone-700 text-stone-300">
                <option value="">All stages</option>
                {Object.keys(STAGE).map(k => <option key={k} value={k}>{STAGE[k].label}</option>)}
              </select>
            )}
          </div>

          {accountRows.length === 0 ? (
            <div className="py-16 text-center border border-stone-800 rounded-xl"><Building2 size={24} className="text-stone-700 mx-auto mb-3" /><p className="text-sm text-stone-500">No companies here yet.</p></div>
          ) : (
            <div className="rounded-xl border border-stone-800 overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-stone-800 bg-stone-900/40">
                  {["Company", "Stage", "Subscription", "Plan", "Deals", "Country"].map(h => <th key={h} className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-stone-500 font-semibold">{h}</th>)}
                  <th className="px-4 py-2.5 w-24"></th>
                </tr></thead>
                <tbody>
                  {accountRows.map(a => {
                    const s = STAGE[a.lifecycleStage] ?? { label: a.lifecycleStage, cls: "bg-stone-700 text-stone-400" };
                    return (
                      <tr key={a.id} onClick={() => open(a)} className="border-b border-stone-800/50 hover:bg-stone-800/30 cursor-pointer">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2.5">
                            <div className="w-7 h-7 rounded-lg bg-stone-800 flex items-center justify-center text-[10px] text-stone-300">{(a.name || "?").slice(0, 2).toUpperCase()}</div>
                            <div className="min-w-0">
                              <span className="text-stone-100 font-medium block leading-tight">{a.name}</span>
                              {a.billingEmail && <span className="text-[11px] text-stone-500 truncate block max-w-[220px]">{a.billingEmail}</span>}
                              {a.org?.slug && (
                                <span className="text-[11px] text-stone-600 font-mono flex items-center leading-tight">/{a.org.slug}<CopyId id={a.organisationId!} /></span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3"><span className={`text-[11px] px-2 py-0.5 rounded ${s.cls}`}>{s.label}</span></td>
                        <td className="px-4 py-3">{a.org ? <SubStatusBadge org={a.org} /> : <span className="text-stone-600 text-[11px]">—</span>}</td>
                        <td className="px-4 py-3">{a.org && fmtPlan(a.org) ? <span className="text-xs text-stone-300">{fmtPlan(a.org)}</span> : <span className="text-stone-600 text-xs">—</span>}</td>
                        <td className="px-4 py-3 text-stone-400 tabular-nums">{a.deals || "—"}</td>
                        <td className="px-4 py-3 text-stone-500 text-xs">{a.country || "—"}</td>
                        <td className="px-4 py-3">
                          {a.organisationId && (
                            <div className="flex items-center gap-1 justify-end" onClick={e => e.stopPropagation()}>
                              <button onClick={() => router.push(`/admin/customers/${a.organisationId}`)} title="Billing & invoices"
                                className="p-1.5 hover:bg-stone-800 rounded text-stone-500 hover:text-stone-200 transition-colors"><CreditCard size={13} /></button>
                              {isSuperAdmin && a.org && (
                                <>
                                  <button onClick={() => setEditingOrg(a.org)} title="Edit organisation"
                                    className="p-1.5 hover:bg-stone-800 rounded text-stone-400 hover:text-stone-200 transition-colors"><Pencil size={13} /></button>
                                  <button onClick={() => setDeletingOrg(a.org)} title="Delete organisation"
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
        </>
      )}

      {showCreate && <CreateOrgModal onClose={() => setShowCreate(false)} onCreated={load} />}
      {editingOrg && <EditOrgModal org={editingOrg} onClose={() => setEditingOrg(null)} onSaved={() => { load(); setEditingOrg(null); }} />}
      {deletingOrg && <DeleteOrgModal org={deletingOrg} onClose={() => setDeletingOrg(null)} onDeleted={load} />}
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}

// ============================================================
// CUSTOMERS SEGMENT — the billing lens of the same directory.
// (Folded in from the former standalone Customers page: KPIs, sortable
//  columns, billing/source/status filters, CSV export.)
// ============================================================
type SortKey = "name" | "planName" | "billing" | "source" | "status" | "mrr" | "lastPayment" | "renewsAt";
const fmtDate = (t: number | null) => t ? new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) : "—";

function CustomersSegment({ customers, summary, onRefresh }: { customers: Customer[]; summary: any; onRefresh: () => void }) {
  const [q, setQ] = useState("");
  const [fName, setFName] = useState("");
  const [fPlan, setFPlan] = useState("");
  const [fBilling, setFBilling] = useState("");
  const [fSource, setFSource] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "name", dir: "asc" });

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
      {/* Toolbar */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-xs text-stone-500">{rows.length} of {customers.length} · billing &amp; subscription</p>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 h-8 px-2 rounded-md bg-stone-800/60 border border-stone-700">
            <Search size={13} className="text-stone-500" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search…" className="w-44 bg-transparent text-xs text-stone-200 placeholder-stone-600 focus:outline-none" />
          </div>
          {anyFilter && <button onClick={clearAll} className="flex items-center gap-1 text-xs text-stone-400 hover:text-stone-200"><X size={12} /> Clear</button>}
          <button onClick={exportCsv} className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-stone-700 bg-stone-800/50 text-stone-300 hover:bg-stone-700"><Download size={13} /> Export</button>
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
      </Card>
    </div>
  );
}
