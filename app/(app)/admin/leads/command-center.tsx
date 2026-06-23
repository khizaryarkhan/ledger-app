"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Flame, Clock, AlertTriangle, TrendingUp, Phone, ChevronDown, ChevronUp, Trophy, Users,
} from "lucide-react";

type Dash = {
  pipeline: Record<string, number>;
  openCount: number; winRate: number;
  thisWeek: { newLeads: number; emailsSent: number; won: number };
  todayQueue: { taskId: string; title: string; dueDate: number; overdue: boolean; leadId: string; leadName: string; company: string | null; status: string }[];
  hotLeads: { id: string; fullName: string; companyName: string | null; email: string; status: string; ageDays: number; hasTask: boolean; score: number }[];
  staleCount: number;
  team: { adminId: string; name: string; open: number; converted: number }[];
  unassignedOpen: number;
};

const STAGES = [
  { key: "new", label: "New", color: "bg-sky-500" },
  { key: "contacted", label: "Contacted", color: "bg-blue-500" },
  { key: "qualified", label: "Qualified", color: "bg-violet-500" },
  { key: "converted", label: "Won", color: "bg-emerald-500" },
  { key: "rejected", label: "Lost", color: "bg-rose-500" },
];

/**
 * Sales command-center shown atop the Leads page: this-week metrics, today's
 * action queue (what to call now), pipeline funnel + win rate, prioritised hot
 * leads and a team leaderboard.  `onOpenLead` opens the existing lead drawer.
 */
export function LeadsCommandCenter({ onOpenLead, refreshKey }: { onOpenLead: (leadId: string) => void; refreshKey?: number }) {
  const [data, setData]       = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen]       = useState(true);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/admin/leads/dashboard");
      if (r.ok) setData(await r.json());
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load, refreshKey]);

  if (loading && !data) return <div className="h-28 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse mb-4" />;
  if (!data) return null;

  const maxStage = Math.max(...STAGES.map(s => data.pipeline[s.key] ?? 0), 1);
  const dueToday = data.todayQueue.length;

  return (
    <div className="mb-5 rounded-xl border border-stone-800 bg-gradient-to-b from-stone-900/70 to-stone-900/30">
      {/* Header strip */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
        <div className="flex items-center gap-2">
          <Flame size={15} className="text-amber-400" />
          <span className="text-sm font-semibold text-white">Sales command center</span>
          {dueToday > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 font-medium">{dueToday} to action today</span>}
          {data.staleCount > 0 && <span className="text-[11px] px-2 py-0.5 rounded-full bg-rose-500/15 text-rose-300 font-medium">{data.staleCount} going cold</span>}
        </div>
        <button onClick={() => setOpen(o => !o)} className="text-stone-500 hover:text-stone-300">{open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</button>
      </div>

      {open && (
        <div className="p-4 space-y-4">
          {/* Top metrics */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { label: "New this week", value: data.thisWeek.newLeads, icon: TrendingUp, accent: "text-sky-400" },
              { label: "In pipeline", value: data.openCount, icon: Users, accent: "text-stone-300" },
              { label: "Won this week", value: data.thisWeek.won, icon: Trophy, accent: "text-emerald-400" },
              { label: "Win rate", value: `${data.winRate}%`, icon: TrendingUp, accent: "text-emerald-400" },
              { label: "Emails sent (7d)", value: data.thisWeek.emailsSent, icon: Phone, accent: "text-stone-300" },
            ].map(m => (
              <div key={m.label} className="rounded-lg border border-stone-800 bg-stone-900/60 p-3">
                <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-stone-500">{m.label}</span><m.icon size={12} className={m.accent} /></div>
                <p className="text-xl font-semibold text-white tabular-nums">{m.value}</p>
              </div>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Today's action queue */}
            <div className="rounded-lg border border-stone-800 bg-stone-900/40">
              <div className="px-3 py-2 border-b border-stone-800 flex items-center gap-2">
                <Clock size={13} className="text-amber-400" />
                <span className="text-xs font-semibold text-white">Action queue — today &amp; overdue</span>
              </div>
              {dueToday === 0 ? (
                <p className="text-[12px] text-stone-500 px-3 py-6 text-center">Nothing due. Set follow-ups on your hot leads → they'll appear here.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto divide-y divide-stone-800/50">
                  {data.todayQueue.slice(0, 30).map(t => (
                    <button key={t.taskId} onClick={() => onOpenLead(t.leadId)} className="w-full text-left px-3 py-2 hover:bg-stone-800/40 flex items-center gap-2">
                      {t.overdue ? <AlertTriangle size={12} className="text-rose-400 shrink-0" /> : <Clock size={12} className="text-amber-400 shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-stone-200 truncate">{t.title}</p>
                        <p className="text-[11px] text-stone-500 truncate">{t.leadName}{t.company ? ` · ${t.company}` : ""}</p>
                      </div>
                      <span className={`text-[10px] shrink-0 ${t.overdue ? "text-rose-400" : "text-stone-500"}`}>
                        {t.overdue ? "overdue" : "today"}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Hot leads */}
            <div className="rounded-lg border border-stone-800 bg-stone-900/40">
              <div className="px-3 py-2 border-b border-stone-800 flex items-center gap-2">
                <Flame size={13} className="text-amber-400" />
                <span className="text-xs font-semibold text-white">Hot leads — work these first</span>
              </div>
              {data.hotLeads.length === 0 ? (
                <p className="text-[12px] text-stone-500 px-3 py-6 text-center">No open leads.</p>
              ) : (
                <div className="max-h-64 overflow-y-auto divide-y divide-stone-800/50">
                  {data.hotLeads.map(l => (
                    <button key={l.id} onClick={() => onOpenLead(l.id)} className="w-full text-left px-3 py-2 hover:bg-stone-800/40 flex items-center gap-2">
                      <div className="w-7 h-7 rounded-md bg-stone-800 flex items-center justify-center text-[10px] font-semibold text-amber-300 shrink-0">{l.score}</div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-stone-200 truncate">{l.fullName}{l.companyName ? ` · ${l.companyName}` : ""}</p>
                        <p className="text-[11px] text-stone-500 truncate">{l.status} · {l.ageDays}d old{l.hasTask ? " · has follow-up" : " · no follow-up"}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Pipeline funnel */}
          <div className="rounded-lg border border-stone-800 bg-stone-900/40 p-3">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-semibold text-white">Pipeline</span>
              {data.unassignedOpen > 0 && <span className="text-[11px] text-amber-400">{data.unassignedOpen} unassigned</span>}
            </div>
            <div className="space-y-2">
              {STAGES.map(s => {
                const n = data.pipeline[s.key] ?? 0;
                return (
                  <div key={s.key} className="flex items-center gap-3">
                    <span className="w-20 text-[11px] text-stone-400">{s.label}</span>
                    <div className="flex-1 h-5 bg-stone-800/60 rounded overflow-hidden">
                      <div className={`h-full ${s.color}`} style={{ width: `${(n / maxStage) * 100}%` }} />
                    </div>
                    <span className="w-8 text-right text-xs text-stone-300 tabular-nums">{n}</span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Team leaderboard */}
          {data.team.length > 0 && (
            <div className="rounded-lg border border-stone-800 bg-stone-900/40 p-3">
              <div className="flex items-center gap-2 mb-2"><Trophy size={13} className="text-amber-400" /><span className="text-xs font-semibold text-white">Team leaderboard</span></div>
              <div className="space-y-1">
                {data.team.map((t, i) => (
                  <div key={t.adminId} className="flex items-center gap-3 text-xs py-1">
                    <span className="w-5 text-stone-500">{i + 1}</span>
                    <span className="flex-1 text-stone-200 truncate">{t.name}</span>
                    <span className="text-stone-500">{t.open} open</span>
                    <span className="text-emerald-400 font-medium w-16 text-right">{t.converted} won</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
