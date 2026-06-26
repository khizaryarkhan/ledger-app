"use client";

import { useEffect, useState, useCallback } from "react";
import { Megaphone, Plus, X, Loader, TrendingUp } from "lucide-react";
import { fmt } from "@/lib/format";

type Campaign = {
  id: string; name: string; channel: string; utmKey: string | null; status: string;
  startDate: string | null; endDate: string | null; budget: number | null; notes: string | null;
  leads: number; converted: number; openValue: number; wonValue: number;
};

const CHANNELS = ["email", "ads", "social", "event", "referral", "content", "other"];
const CHANNEL_CLS: Record<string, string> = {
  email: "bg-sky-500/15 text-sky-300", ads: "bg-violet-500/15 text-violet-300", social: "bg-blue-500/15 text-blue-300",
  event: "bg-amber-500/15 text-amber-300", referral: "bg-emerald-500/15 text-emerald-300", content: "bg-rose-500/15 text-rose-300",
  other: "bg-stone-700 text-stone-400",
};
const money = (v: number) => fmt.money(v ?? 0, "USD");

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ name: "", channel: "ads", utmKey: "", budget: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/campaigns").then(r => r.ok ? r.json() : { campaigns: [] }).then(d => setCampaigns(d.campaigns ?? [])).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const r = await fetch("/api/admin/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (r.ok) { setShowNew(false); setForm({ name: "", channel: "ads", utmKey: "", budget: "" }); load(); }
    } finally { setSaving(false); }
  };

  const toggle = async (c: Campaign) => {
    const prev = c.status;
    const next = prev === "active" ? "ended" : "active";
    setCampaigns(p => p.map(x => x.id === c.id ? { ...x, status: next } : x));
    try {
      const r = await fetch("/api/admin/campaigns", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: c.id, status: next }) });
      if (!r.ok) setCampaigns(p => p.map(x => x.id === c.id ? { ...x, status: prev } : x));
    } catch {
      setCampaigns(p => p.map(x => x.id === c.id ? { ...x, status: prev } : x));
    }
  };

  const inp = "w-full px-3 py-2 text-sm rounded-lg bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";

  return (
    <div className="max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Campaigns</h1>
          <p className="text-xs text-stone-500 mt-0.5">Marketing campaigns with attribution — leads auto-link by UTM / source. Track source ROI.</p>
        </div>
        <button onClick={() => setShowNew(true)} className="flex items-center gap-1.5 h-9 px-3.5 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white"><Plus size={14} /> New campaign</button>
      </div>

      {loading ? (
        <div className="h-48 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" />
      ) : campaigns.length === 0 ? (
        <div className="py-20 text-center border border-stone-800 rounded-xl">
          <Megaphone size={26} className="text-stone-700 mx-auto mb-3" />
          <p className="text-sm text-stone-400">No campaigns yet.</p>
          <p className="text-xs text-stone-600 mt-1">Create one with a UTM key (e.g. <span className="font-mono">spring_ads</span>) and inbound leads carrying that <span className="font-mono">utm_campaign</span> auto-attribute to it.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-stone-800 overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead><tr className="border-b border-stone-800 bg-stone-900/40">
              {["Campaign", "Channel", "UTM key", "Status", "Leads", "Converted", "Open pipeline", "Won"].map(h => <th key={h} className="text-left px-4 py-2.5 text-[10px] uppercase tracking-wider text-stone-500 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>
              {campaigns.map(c => {
                const conv = c.leads > 0 ? Math.round((c.converted / c.leads) * 100) : 0;
                return (
                  <tr key={c.id} className="border-b border-stone-800/50 hover:bg-stone-800/20">
                    <td className="px-4 py-3 text-stone-100 font-medium">{c.name}</td>
                    <td className="px-4 py-3"><span className={`text-[11px] px-2 py-0.5 rounded ${CHANNEL_CLS[c.channel] ?? CHANNEL_CLS.other}`}>{c.channel}</span></td>
                    <td className="px-4 py-3 font-mono text-[11px] text-stone-500">{c.utmKey || "—"}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => toggle(c)} className={`text-[11px] px-2 py-0.5 rounded ${c.status === "active" ? "bg-emerald-500/15 text-emerald-300" : "bg-stone-700 text-stone-400"}`}>{c.status}</button>
                    </td>
                    <td className="px-4 py-3 text-stone-300 tabular-nums">{c.leads || "—"}</td>
                    <td className="px-4 py-3 text-stone-300 tabular-nums">{c.converted || "—"}{c.leads ? <span className="text-stone-600 text-[11px] ml-1">{conv}%</span> : null}</td>
                    <td className="px-4 py-3 text-sky-400 tabular-nums">{c.openValue ? money(c.openValue) : "—"}</td>
                    <td className="px-4 py-3 text-emerald-400 tabular-nums">{c.wonValue ? money(c.wonValue) : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {showNew && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-stone-900 rounded-xl w-full max-w-md ring-1 ring-stone-800">
            <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
              <h2 className="font-semibold text-white">New campaign</h2>
              <button onClick={() => setShowNew(false)} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div><label className="text-xs text-stone-400 block mb-1.5">Name</label><input className={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Spring Google Ads" /></div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-stone-400 block mb-1.5">Channel</label>
                  <select className={inp} value={form.channel} onChange={e => setForm(f => ({ ...f, channel: e.target.value }))}>
                    {CHANNELS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div><label className="text-xs text-stone-400 block mb-1.5">Budget (optional)</label><input className={inp} inputMode="decimal" value={form.budget} onChange={e => setForm(f => ({ ...f, budget: e.target.value }))} placeholder="5000" /></div>
              </div>
              <div><label className="text-xs text-stone-400 block mb-1.5">UTM key (matches utm_campaign / utm_source)</label><input className={`${inp} font-mono`} value={form.utmKey} onChange={e => setForm(f => ({ ...f, utmKey: e.target.value }))} placeholder="spring_ads" /></div>
            </div>
            <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
              <button onClick={() => setShowNew(false)} className="h-9 px-4 text-sm rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800">Cancel</button>
              <button onClick={create} disabled={saving || !form.name.trim()} className="h-9 px-4 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60 flex items-center gap-1.5">{saving ? <Loader size={13} className="animate-spin" /> : <TrendingUp size={13} />} Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
