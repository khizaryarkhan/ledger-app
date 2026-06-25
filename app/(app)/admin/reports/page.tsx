"use client";

import { useEffect, useState } from "react";
import { TrendingUp, Users, Trophy, Target, BarChart3, Activity } from "lucide-react";
import { fmt } from "@/lib/format";

const STAGE_ORDER = ["lead", "prospect", "qualified", "customer"];
const STAGE_LABEL: Record<string, string> = { lead: "Leads", prospect: "Prospects", qualified: "Qualified", customer: "Customers", churned: "Churned", archived: "Archived" };
const PIPE_LABEL: Record<string, string> = { discovery: "Discovery", proposal: "Proposal", negotiation: "Negotiation", contract: "Contract" };

const money = (v: number) => fmt.money(v ?? 0, "USD");

function Card({ title, icon: Icon, children }: any) {
  return (
    <div className="rounded-xl border border-stone-800 bg-stone-900/40">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-stone-800">
        <Icon size={14} className="text-stone-500" />
        <span className="text-[11px] uppercase tracking-wider text-stone-400 font-semibold">{title}</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

// Horizontal bar row.
function Bar({ label, value, max, sub, tone = "bg-emerald-500" }: { label: string; value: number; max: number; sub?: string; tone?: string }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="py-1.5">
      <div className="flex items-center justify-between text-[12px] mb-1">
        <span className="text-stone-300">{label}</span>
        <span className="text-stone-400 tabular-nums">{value}{sub ? <span className="text-stone-600 ml-1">{sub}</span> : ""}</span>
      </div>
      <div className="h-1.5 rounded-full bg-stone-800 overflow-hidden"><div className={`h-full ${tone}`} style={{ width: `${pct}%` }} /></div>
    </div>
  );
}

export default function ReportsPage() {
  const [d, setD] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/reports").then(r => r.ok ? r.json() : null).then(setD).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="max-w-[1200px] mx-auto"><div className="h-64 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" /></div>;
  if (!d) return <div className="max-w-[1200px] mx-auto py-16 text-center text-stone-500">No data.</div>;

  const funnelMap = new Map<string, number>((d.funnel ?? []).map((f: any) => [f.stage, f.n]));
  const funnelMax = Math.max(1, ...STAGE_ORDER.map(s => funnelMap.get(s) ?? 0));
  const sources = [...(d.sources ?? [])].sort((a, b) => b.total - a.total);
  const srcMax = Math.max(1, ...sources.map((s: any) => s.total));
  const pipeline = [...(d.pipeline ?? [])];
  const pipeTotal = pipeline.reduce((s, p) => s + (p.value ?? 0), 0);
  const pipeWeighted = pipeline.reduce((s, p) => s + (p.weighted ?? 0), 0);
  const pipeMax = Math.max(1, ...pipeline.map((p: any) => p.value ?? 0));
  const won = (d.outcomes ?? []).find((o: any) => o.status === "won") ?? { n: 0, value: 0 };
  const lost = (d.outcomes ?? []).find((o: any) => o.status === "lost") ?? { n: 0, value: 0 };
  const owners = [...(d.owners ?? [])].sort((a, b) => b.accounts - a.accounts);
  const ownerMax = Math.max(1, ...owners.map((o: any) => o.accounts));
  const activity = [...(d.activity ?? [])].sort((a, b) => b.n - a.n);
  const actMax = Math.max(1, ...activity.map((a: any) => a.n));
  const winRate = (won.n + lost.n) > 0 ? Math.round((won.n / (won.n + lost.n)) * 100) : 0;

  return (
    <div className="max-w-[1200px] mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">Reports</h1>
        <p className="text-xs text-stone-500 mt-0.5">Funnel, pipeline and source performance — across the whole book.</p>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        {[
          { label: "Open pipeline", value: money(pipeTotal), icon: Target, accent: "text-sky-400" },
          { label: "Weighted forecast", value: money(pipeWeighted), icon: TrendingUp, accent: "text-emerald-400" },
          { label: "Won (all-time)", value: `${won.n} · ${money(won.value)}`, icon: Trophy, accent: "text-emerald-400" },
          { label: "Win rate", value: `${winRate}%`, icon: BarChart3, accent: "text-stone-300" },
        ].map(m => (
          <div key={m.label} className="p-3 rounded-xl border border-stone-800 bg-stone-900/50">
            <div className="flex items-center justify-between mb-1"><span className="text-[11px] text-stone-500">{m.label}</span><m.icon size={13} className={m.accent} /></div>
            <p className="text-lg font-semibold text-white tabular-nums">{m.value}</p>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Lifecycle funnel */}
        <Card title="Lifecycle funnel" icon={Users}>
          {STAGE_ORDER.map((stg, i) => {
            const n = funnelMap.get(stg) ?? 0;
            const prev = i > 0 ? (funnelMap.get(STAGE_ORDER[i - 1]) ?? 0) : 0;
            const conv = i > 0 && prev > 0 ? ` · ${Math.round((n / prev) * 100)}%` : "";
            return <Bar key={stg} label={STAGE_LABEL[stg]} value={n} max={funnelMax} sub={conv} tone="bg-emerald-500" />;
          })}
        </Card>

        {/* Pipeline by stage */}
        <Card title="Open pipeline by stage" icon={Target}>
          {pipeline.length ? pipeline.map((p: any) => (
            <Bar key={p.stage} label={PIPE_LABEL[p.stage] ?? p.stage} value={p.value} max={pipeMax} sub={`· ${p.n} deal${p.n !== 1 ? "s" : ""}`} tone="bg-sky-500" />
          )) : <p className="text-xs text-stone-600">No open deals.</p>}
        </Card>

        {/* Lead sources */}
        <Card title="Lead sources" icon={BarChart3}>
          {sources.length ? sources.map((s: any) => (
            <Bar key={s.source} label={s.source || "—"} value={s.total} max={srcMax}
              sub={`· ${s.converted} won (${s.total > 0 ? Math.round((s.converted / s.total) * 100) : 0}%)`} tone="bg-violet-500" />
          )) : <p className="text-xs text-stone-600">No leads.</p>}
        </Card>

        {/* By owner */}
        <Card title="By owner" icon={Users}>
          {owners.length ? owners.map((o: any) => (
            <Bar key={o.ownerId ?? "none"} label={o.name} value={o.accounts} max={ownerMax} sub={`· ${o.customers} customers`} tone="bg-amber-500" />
          )) : <p className="text-xs text-stone-600">No accounts.</p>}
        </Card>

        {/* Activity (30d) */}
        <Card title="Activity — last 30 days" icon={Activity}>
          {activity.length ? activity.map((a: any) => (
            <Bar key={a.type} label={a.type.replace(/_/g, " ")} value={a.n} max={actMax} tone="bg-stone-500" />
          )) : <p className="text-xs text-stone-600">No activity in the last 30 days.</p>}
        </Card>
      </div>
    </div>
  );
}
