"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Building2, Search, Users, Loader } from "lucide-react";

type Account = {
  id: string; name: string; lifecycleStage: string; billingEmail: string | null; domain: string | null;
  country: string | null; organisationId: string | null; orgStatus: string | null; leadId: string | null; deals: number;
};

const STAGE: Record<string, { label: string; cls: string }> = {
  lead:      { label: "Lead",      cls: "bg-sky-500/15 text-sky-300" },
  prospect:  { label: "Prospect",  cls: "bg-blue-500/15 text-blue-300" },
  qualified: { label: "Qualified", cls: "bg-violet-500/15 text-violet-300" },
  customer:  { label: "Customer",  cls: "bg-emerald-500/15 text-emerald-300" },
  churned:   { label: "Churned",   cls: "bg-rose-500/15 text-rose-300" },
  archived:  { label: "Archived",  cls: "bg-stone-700 text-stone-400" },
};

export default function AccountsPage() {
  const router = useRouter();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/accounts").then(r => r.ok ? r.json() : { accounts: [] })
      .then(d => { setAccounts(d.accounts ?? []); setNeedsSetup(!!d.needsSetup); }).finally(() => setLoading(false));
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

  // Route to the best available 360 for this company.
  const open = (a: Account) => {
    if (a.leadId) router.push(`/admin/leads/${a.leadId}`);
    else if (a.organisationId) router.push(`/admin/customers/${a.organisationId}`);
  };

  const rows = useMemo(() => accounts.filter(a => {
    if (stage && a.lifecycleStage !== stage) return false;
    if (q && !`${a.name} ${a.billingEmail ?? ""} ${a.domain ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  }), [accounts, q, stage]);

  return (
    <div className="max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Accounts</h1>
          <p className="text-xs text-stone-500 mt-0.5">Every company in one place — prospects through customers. The single source of truth.</p>
        </div>
        <div className="flex items-center gap-3">
          {msg && <span className="text-[12px] text-emerald-400">{msg}</span>}
          <span className="text-[12px] text-stone-500">{accounts.length} companies</span>
          <button onClick={sync} disabled={syncing}
            className="flex items-center gap-1.5 h-9 px-3.5 text-xs font-medium rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 disabled:opacity-60">
            {syncing ? <Loader size={13} className="animate-spin" /> : <Users size={13} />} {syncing ? "Linking…" : "Sync accounts"}
          </button>
        </div>
      </div>

      {needsSetup && (
        <div className="mb-4 rounded-lg ring-1 ring-amber-500/30 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-300">
          The <span className="font-mono">crm_accounts</span> table isn't set up yet, or the backfill hasn't run — companies will appear here once it has.
        </div>
      )}

      <div className="flex items-center gap-2 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search company, email, domain…"
            className="w-full h-9 pl-8 pr-3 text-[13px] rounded-lg bg-stone-900 border border-stone-700 text-stone-200 placeholder-stone-600 focus:outline-none focus:border-emerald-500" />
        </div>
        <select value={stage} onChange={e => setStage(e.target.value)} className="h-9 px-2.5 text-xs rounded-lg bg-stone-900 border border-stone-700 text-stone-300">
          <option value="">All stages</option>
          {Object.keys(STAGE).map(k => <option key={k} value={k}>{STAGE[k].label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="h-64 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" />
      ) : rows.length === 0 ? (
        <div className="py-16 text-center border border-stone-800 rounded-xl"><Building2 size={24} className="text-stone-700 mx-auto mb-3" /><p className="text-sm text-stone-500">No companies yet.</p></div>
      ) : (
        <div className="rounded-xl border border-stone-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-stone-800 bg-stone-900/40">
              {["Company", "Stage", "Customer", "Deals", "Email", "Country"].map(h => <th key={h} className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-stone-500 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {rows.map(a => {
                const s = STAGE[a.lifecycleStage] ?? { label: a.lifecycleStage, cls: "bg-stone-700 text-stone-400" };
                return (
                  <tr key={a.id} onClick={() => open(a)} className="border-b border-stone-800/50 hover:bg-stone-800/30 cursor-pointer">
                    <td className="px-4 py-3"><div className="flex items-center gap-2.5"><div className="w-7 h-7 rounded-lg bg-stone-800 flex items-center justify-center text-[10px] text-stone-300">{(a.name || "?").slice(0, 2).toUpperCase()}</div><span className="text-stone-100 font-medium">{a.name}</span></div></td>
                    <td className="px-4 py-3"><span className={`text-[11px] px-2 py-0.5 rounded ${s.cls}`}>{s.label}</span></td>
                    <td className="px-4 py-3">{a.organisationId ? <span className={`text-[11px] ${a.orgStatus === "Active" ? "text-emerald-400" : "text-amber-400"}`}>{a.orgStatus === "Active" ? "Active" : "Pending"}</span> : <span className="text-stone-600 text-[11px]">—</span>}</td>
                    <td className="px-4 py-3 text-stone-400 tabular-nums">{a.deals || "—"}</td>
                    <td className="px-4 py-3 text-stone-400 text-xs truncate max-w-[220px]">{a.billingEmail || "—"}</td>
                    <td className="px-4 py-3 text-stone-500 text-xs">{a.country || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
