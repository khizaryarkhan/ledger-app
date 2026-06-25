"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { ChevronLeft, Loader, GitMerge, CheckCircle2, Building2 } from "lucide-react";

type Acc = {
  id: string; ref: string; name: string; domain: string | null; billingEmail: string | null;
  lifecycleStage: string; organisationId: string | null; orgStatus: string | null; deals: number; leads: number;
};
type Group = { accounts: Acc[] };

export default function DuplicatesPage() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [primary, setPrimary] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/accounts/duplicates").then(r => r.ok ? r.json() : { groups: [] })
      .then(d => {
        setGroups(d.groups ?? []);
        // Default primary = first (richest) in each group.
        const p: Record<number, string> = {};
        (d.groups ?? []).forEach((g: Group, i: number) => { p[i] = g.accounts[0]?.id; });
        setPrimary(p);
      }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const merge = async (gi: number) => {
    const g = groups[gi]; const primaryId = primary[gi];
    if (!primaryId) return;
    const mergeIds = g.accounts.map(a => a.id).filter(id => id !== primaryId);
    if (!confirm(`Merge ${mergeIds.length} account(s) into "${g.accounts.find(a => a.id === primaryId)?.name}"? Their contacts, deals, emails and activity move to it; the duplicates are removed. Billing is untouched.`)) return;
    setBusy(gi); setMsg("");
    try {
      const r = await fetch("/api/admin/accounts/merge", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ primaryId, mergeIds }) });
      if (r.ok) { setMsg(`Merged ${mergeIds.length} account(s).`); load(); }
      else { const d = await r.json().catch(() => ({})); setMsg(d.error || "Merge failed"); }
    } catch { setMsg("Merge failed"); } finally { setBusy(null); }
  };

  return (
    <div className="max-w-[1000px] mx-auto">
      <Link href="/admin/accounts" className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-300 mb-3"><ChevronLeft size={14} /> Accounts</Link>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Duplicate accounts</h1>
          <p className="text-xs text-stone-500 mt-0.5">Companies that share a name, domain or email. Pick the one to keep, then merge.</p>
        </div>
        {msg && <span className="text-[12px] text-emerald-400">{msg}</span>}
      </div>

      {loading ? (
        <div className="h-48 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" />
      ) : groups.length === 0 ? (
        <div className="py-20 text-center border border-stone-800 rounded-xl">
          <CheckCircle2 size={26} className="text-emerald-500/70 mx-auto mb-3" />
          <p className="text-sm text-stone-400">No duplicates found — your book is clean.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((g, gi) => (
            <div key={gi} className="rounded-xl border border-stone-800 bg-stone-900/40">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800">
                <span className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">{g.accounts.length} possible duplicates</span>
                <button onClick={() => merge(gi)} disabled={busy === gi}
                  className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60">
                  {busy === gi ? <Loader size={13} className="animate-spin" /> : <GitMerge size={13} />} Merge
                </button>
              </div>
              <div className="divide-y divide-stone-800/50">
                {g.accounts.map(a => (
                  <label key={a.id} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-stone-800/20">
                    <input type="radio" name={`primary-${gi}`} checked={primary[gi] === a.id} onChange={() => setPrimary(p => ({ ...p, [gi]: a.id }))} className="accent-emerald-500" />
                    <div className="w-7 h-7 rounded-lg bg-stone-800 flex items-center justify-center text-[10px] text-stone-300 shrink-0">{(a.name || "?").slice(0, 2).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-stone-100 font-medium truncate">{a.name}</span>
                        <span className="font-mono text-[11px] text-stone-600">{a.ref}</span>
                        {primary[gi] === a.id && <span className="text-[10px] uppercase text-emerald-400">keep</span>}
                      </div>
                      <div className="text-[11px] text-stone-500 truncate">
                        {a.billingEmail || a.domain || "—"} · {a.lifecycleStage}
                        {a.organisationId ? ` · ${a.orgStatus ?? "org"}` : ""}
                        {a.deals ? ` · ${a.deals} deal${a.deals !== 1 ? "s" : ""}` : ""}
                        {a.leads ? ` · ${a.leads} lead${a.leads !== 1 ? "s" : ""}` : ""}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
