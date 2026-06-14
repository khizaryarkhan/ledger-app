"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card } from "@/components/ui";
import { fmt, daysOverdue } from "@/lib/format";
import { CurrencyPills } from "@/components/currency-pills";
import {
  Users, Mail, CheckSquare, TrendingUp, TrendingDown, Target,
  AlertTriangle, BarChart3, Minus, Phone, Clock,
} from "lucide-react";

// ─── helpers ────────────────────────────────────────────────────────────────
function ScoreBar({ value, max, color = "bg-stone-600" }: { value: number; max: number; color?: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full h-1.5 bg-stone-800 rounded-full overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function Chip({
  value, good, warn, className = "",
}: { value: number; good: number; warn: number; className?: string }) {
  const color =
    value <= good ? "bg-emerald-500/15 text-emerald-400" :
    value <= warn  ? "bg-amber-500/15 text-amber-400"    :
                     "bg-rose-500/15 text-rose-400";
  return (
    <span className={`inline-block text-[11px] font-semibold px-2 py-0.5 rounded-full ${color} ${className}`}>
      {value.toFixed(0)}%
    </span>
  );
}

// ─── main ────────────────────────────────────────────────────────────────────
export default function PerformancePage() {
  const { invoices, customers, projects, reps, communications, tasks } = useData() as any;
  const [period, setPeriod] = useState<"week" | "month">("month");

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const weekAgo    = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const periodStart = period === "month" ? monthStart : weekAgo;
  const periodLabel = period === "month" ? "This month" : "Last 7 days";

  // ── per-rep stats ─────────────────────────────────────────────────────────
  const repData = useMemo(() => {
    return (reps ?? []).map((rep: any) => {
      // All invoices for this rep (via customer or project assignment)
      const repInvs = invoices.filter((inv: any) => {
        const c = customers.find((c: any) => c.id === inv.customerId);
        const p = projects.find((p: any) => p.id === inv.projectId);
        return c?.repId === rep.id || p?.repId === rep.id;
      });

      const openInvs = repInvs.filter((i: any) =>
        i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && i.txnType !== "CreditMemo",
      );

      const openAR    = openInvs.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
      const overdueInvs = openInvs.filter((i: any) => daysOverdue(i.dueDate) > 0);
      const overdueAR = overdueInvs.reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);
      const at90plus  = openInvs
        .filter((i: any) => daysOverdue(i.dueDate) > 90)
        .reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);

      const overduePct  = openAR > 0 ? (overdueAR / openAR) * 100 : 0;

      // Average DPD for overdue invoices
      const avgDPD = overdueInvs.length > 0
        ? Math.round(overdueInvs.reduce((s: number, i: any) => s + daysOverdue(i.dueDate), 0) / overdueInvs.length)
        : 0;

      // Cash collected in period using paidAt
      const cashCollected = repInvs
        .filter((i: any) => i.paidAt && i.paidAt >= periodStart)
        .reduce((s: number, i: any) => s + i.total, 0);

      // Customers in portfolio
      const custIds = new Set<string>(repInvs.map((i: any) => i.customerId as string));

      // Emails sent in period for rep's customers
      const emailsSent = communications.filter((c: any) =>
        c.direction === "Outbound" &&
        c.channel === "Email" &&
        c.sentAt >= periodStart &&
        custIds.has(c.customerId),
      ).length;

      // Inbound replies in period
      const repliesReceived = communications.filter((c: any) =>
        c.direction === "Inbound" &&
        c.sentAt >= periodStart &&
        custIds.has(c.customerId),
      ).length;

      // Notes logged in period
      const notesLogged = communications.filter((c: any) =>
        c.channel === "Note" &&
        c.sentAt >= periodStart &&
        custIds.has(c.customerId),
      ).length;

      // Tasks
      const repTasks    = tasks.filter((t: any) => t.assigneeId === rep.id);
      const openTasks   = repTasks.filter((t: any) => !t.completed).length;
      const overdueTasks = repTasks.filter((t: any) => !t.completed && t.dueDate && t.dueDate < now.toISOString().slice(0, 10)).length;

      // Disputed in portfolio
      const disputedAR = openInvs
        .filter((i: any) => i.collectionStage === "Disputed")
        .reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);

      // Promised this week (promises outstanding)
      const promisedAR = openInvs
        .filter((i: any) => (i.collectionStage === "Promised" || i.collectionStage === "Promise to Pay") && i.promiseDate)
        .reduce((s: number, i: any) => s + (i.total - (i.paid || 0)), 0);

      // Currency breakdowns for multi-currency display
      function byCcy(invs: any[], amtFn: (i: any) => number): Record<string, number> {
        const out: Record<string, number> = {};
        for (const i of invs) {
          const c = i.currency ?? "?";
          const a = amtFn(i);
          if (a) out[c] = (out[c] || 0) + a;
        }
        return out;
      }
      const openARByCcy       = byCcy(openInvs, i => i.total - (i.paid || 0));
      const overdueARByCcy    = byCcy(overdueInvs, i => i.total - (i.paid || 0));
      const cashCollByCcy     = byCcy(repInvs.filter((i: any) => i.paidAt && i.paidAt >= periodStart), i => i.total);
      const at90plusByCcy     = byCcy(openInvs.filter((i: any) => daysOverdue(i.dueDate) > 90), i => i.total - (i.paid || 0));
      const promisedARByCcy   = byCcy(
        openInvs.filter((i: any) => (i.collectionStage === "Promised" || i.collectionStage === "Promise to Pay") && i.promiseDate),
        i => i.total - (i.paid || 0)
      );

      return {
        rep,
        openAR,
        overdueAR,
        overduePct,
        cashCollected,
        avgDPD,
        custCount: custIds.size,
        invoiceCount: openInvs.length,
        overdueCount: overdueInvs.length,
        emailsSent,
        repliesReceived,
        notesLogged,
        openTasks,
        overdueTasks,
        at90plus,
        disputedAR,
        promisedAR,
        openARByCcy,
        overdueARByCcy,
        cashCollByCcy,
        at90plusByCcy,
        promisedARByCcy,
      };
    }).sort((a: any, b: any) => b.openAR - a.openAR);
  }, [invoices, customers, projects, reps, communications, tasks, periodStart, now]);

  // ── totals ────────────────────────────────────────────────────────────────
  const totals = useMemo(() => {
    function mergeByCcy(key: string): Record<string, number> {
      const out: Record<string, number> = {};
      for (const r of repData) {
        for (const [c, v] of Object.entries(r[key] as Record<string, number>)) {
          out[c] = (out[c] || 0) + v;
        }
      }
      return out;
    }
    return {
      openAR:           repData.reduce((s: number, r: any) => s + r.openAR, 0),
      overdueAR:        repData.reduce((s: number, r: any) => s + r.overdueAR, 0),
      cashCollected:    repData.reduce((s: number, r: any) => s + r.cashCollected, 0),
      emailsSent:       repData.reduce((s: number, r: any) => s + r.emailsSent, 0),
      openTasks:        repData.reduce((s: number, r: any) => s + r.openTasks, 0),
      openARByCcy:      mergeByCcy("openARByCcy"),
      overdueARByCcy:   mergeByCcy("overdueARByCcy"),
      cashCollByCcy:    mergeByCcy("cashCollByCcy"),
      at90plusByCcy:    mergeByCcy("at90plusByCcy"),
    };
  }, [repData]);

  const maxCash  = Math.max(...repData.map((r: any) => r.cashCollected), 1);
  const maxEmails = Math.max(...repData.map((r: any) => r.emailsSent), 1);

  // ── weekly activity trend (emails + notes per rep last 4 weeks) ───────────
  const weeks = useMemo(() => {
    return Array.from({ length: 4 }, (_, wi) => {
      const end = new Date(now.getTime() - wi * 7 * 86400000);
      const start = new Date(end.getTime() - 7 * 86400000);
      const label = `W-${wi === 0 ? "now" : wi}`;
      const s = start.toISOString().slice(0, 10);
      const e = end.toISOString().slice(0, 10);
      const sent = communications.filter((c: any) =>
        c.direction === "Outbound" && c.channel === "Email" && c.sentAt >= s && c.sentAt < e,
      ).length;
      const received = communications.filter((c: any) =>
        c.direction === "Inbound" && c.sentAt >= s && c.sentAt < e,
      ).length;
      return { label, sent, received };
    }).reverse();
  }, [communications, now]);

  const maxWeek = Math.max(...weeks.map(w => Math.max(w.sent, w.received)), 1);

  if ((reps ?? []).length === 0) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <h1 className="text-2xl font-semibold text-white tracking-tight mb-2">Performance</h1>
        <p className="text-sm text-stone-400 mb-6">Rep activity scorecard and portfolio health</p>
        <Card>
          <div className="py-12 text-center">
            <Users size={32} className="text-stone-300 mx-auto mb-3" />
            <p className="text-sm text-stone-500">No reps configured yet.</p>
            <p className="text-xs text-stone-400 mt-1">
              Go to <Link href="/settings/team" className="text-stone-700 underline">Settings → Team</Link> to add reps.
            </p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Performance</h1>
          <p className="text-sm text-stone-400 mt-1">Rep activity scorecard and portfolio health</p>
        </div>
        <div className="flex items-center gap-1 bg-stone-800 p-1 rounded-xl">
          {(["week", "month"] as const).map(p => (
            <button key={p} onClick={() => setPeriod(p)}
              className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-colors ${period === p ? "bg-stone-700 text-white shadow-sm" : "text-stone-400 hover:text-stone-200"}`}>
              {p === "week" ? "This Week" : "This Month"}
            </button>
          ))}
        </div>
      </div>

      {/* Org-level KPIs */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        {([
          { label: "Total Open AR",   value: <CurrencyPills breakdown={totals.openARByCcy} />,    sub: `across ${repData.length} reps`,  icon: BarChart3,    color: "text-white"      },
          { label: "Total Overdue",   value: <CurrencyPills breakdown={totals.overdueARByCcy} />, sub: `${totals.openAR > 0 ? ((totals.overdueAR/totals.openAR)*100).toFixed(0) : 0}% of AR`, icon: AlertTriangle, color: "text-rose-400"  },
          { label: "Cash Collected",  value: <CurrencyPills breakdown={totals.cashCollByCcy} />,  sub: periodLabel,                       icon: TrendingUp,   color: "text-emerald-400"},
          { label: "Emails Sent",     value: String(totals.emailsSent),                           sub: periodLabel,                       icon: Mail,         color: "text-white"      },
          { label: "Open Tasks",      value: String(totals.openTasks),                            sub: "assigned to reps",                icon: CheckSquare,  color: "text-amber-600"  },
        ] as { label: string; value: React.ReactNode; sub: string; icon: any; color: string }[]).map(({ label, value, sub, icon: Icon, color }) => (
          <Card key={label} padding="md">
            <div className="flex items-center gap-2 mb-2">
              <Icon size={14} className={`${color} shrink-0`} />
              <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">{label}</div>
            </div>
            <div className={`text-2xl font-semibold tracking-tight tabular-nums ${color}`}>{value}</div>
            <div className="mt-1 text-[11px] text-stone-400">{sub}</div>
          </Card>
        ))}
      </div>

      {/* Rep Scorecard Table */}
      <div className="bg-stone-900 rounded-xl ring-1 ring-stone-800 overflow-hidden mb-5">
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-white">Rep Scorecard</div>
            <div className="text-[11px] text-stone-400 mt-0.5">Portfolio health and {periodLabel.toLowerCase()} activity</div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-stone-400 border-b border-stone-800 bg-stone-900/60">
                <th className="text-left font-semibold px-5 py-3">Rep</th>
                <th className="text-right font-semibold px-3 py-3">Customers</th>
                <th className="text-right font-semibold px-3 py-3">Open AR</th>
                <th className="text-right font-semibold px-3 py-3">Overdue</th>
                <th className="text-right font-semibold px-3 py-3">Overdue %</th>
                <th className="text-right font-semibold px-3 py-3">90+ Days</th>
                <th className="text-right font-semibold px-3 py-3">Avg DPD</th>
                <th className="text-right font-semibold px-3 py-3">Cash {periodLabel === "This month" ? "MTD" : "WTD"}</th>
                <th className="text-right font-semibold px-3 py-3">Emails</th>
                <th className="text-right font-semibold px-3 py-3">Replies</th>
                <th className="text-right font-semibold px-5 py-3">Tasks</th>
              </tr>
            </thead>
            <tbody>
              {repData.map((r: any) => (
                <tr key={r.rep.id} className="border-b border-stone-800 hover:bg-stone-800/50">
                  <td className="px-5 py-3">
                    <div className="font-semibold text-white">{r.rep.name}</div>
                    {r.rep.email && <div className="text-[11px] text-stone-400">{r.rep.email}</div>}
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-stone-400">{r.custCount}</td>
                  <td className="px-3 py-3 text-right font-bold tabular-nums text-white"><CurrencyPills breakdown={r.openARByCcy} /></td>
                  <td className="px-3 py-3 text-right tabular-nums text-rose-400 font-medium"><CurrencyPills breakdown={r.overdueARByCcy} /></td>
                  <td className="px-3 py-3 text-right">
                    <Chip value={r.overduePct} good={20} warn={50} />
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-stone-400 text-xs">
                    {r.at90plus > 0 ? <span className="text-rose-400 font-medium"><CurrencyPills breakdown={r.at90plusByCcy} /></span> : <span className="text-stone-600">—</span>}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {r.avgDPD > 0 ? (
                      <span className={`text-xs font-semibold ${r.avgDPD > 60 ? "text-rose-400" : r.avgDPD > 30 ? "text-amber-400" : "text-stone-300"}`}>
                        {r.avgDPD}d
                      </span>
                    ) : <span className="text-stone-600 text-xs">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="w-16">
                        <ScoreBar value={r.cashCollected} max={maxCash} color="bg-emerald-500" />
                      </div>
                      <span className="text-xs font-semibold text-emerald-400 tabular-nums"><CurrencyPills breakdown={r.cashCollByCcy} /></span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <div className="w-12">
                        <ScoreBar value={r.emailsSent} max={maxEmails} color="bg-stone-500" />
                      </div>
                      <span className="text-xs tabular-nums text-stone-400">{r.emailsSent}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right tabular-nums text-stone-400 text-xs">{r.repliesReceived}</td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center gap-1 justify-end">
                      <span className="text-xs tabular-nums text-stone-400">{r.openTasks} open</span>
                      {r.overdueTasks > 0 && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-400 font-semibold">{r.overdueTasks} late</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {/* Totals row */}
              <tr className="bg-stone-900 text-white">
                <td className="px-5 py-3 font-bold text-sm">TOTAL</td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">{repData.reduce((s: number, r: any) => s + r.custCount, 0)}</td>
                <td className="px-3 py-3 text-right font-bold tabular-nums"><CurrencyPills breakdown={totals.openARByCcy} /></td>
                <td className="px-3 py-3 text-right font-bold tabular-nums"><CurrencyPills breakdown={totals.overdueARByCcy} /></td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">
                  {totals.openAR > 0 ? ((totals.overdueAR / totals.openAR) * 100).toFixed(0) : 0}%
                </td>
                <td className="px-3 py-3 text-right font-bold tabular-nums"><CurrencyPills breakdown={totals.at90plusByCcy} /></td>
                <td className="px-3 py-3" />
                <td className="px-3 py-3 text-right font-bold tabular-nums"><CurrencyPills breakdown={totals.cashCollByCcy} /></td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">{totals.emailsSent}</td>
                <td className="px-3 py-3 text-right font-bold tabular-nums">{repData.reduce((s: number, r: any) => s + r.repliesReceived, 0)}</td>
                <td className="px-5 py-3 text-right font-bold tabular-nums">{totals.openTasks}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Weekly Activity Trend + Rep Detail Cards */}
      <div className="grid grid-cols-3 gap-4">
        {/* Activity trend chart */}
        <Card className="col-span-1">
          <h3 className="text-sm font-semibold text-white mb-4">Team Email Activity (4 Weeks)</h3>
          <div className="flex items-end gap-2 h-32 mb-3">
            {weeks.map((w, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-1 group relative">
                <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 bg-stone-800 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap border border-stone-700">
                  <div>Sent: {w.sent}</div>
                  <div>Rcvd: {w.received}</div>
                </div>
                <div className="flex-1 flex items-end gap-0.5 w-full justify-center">
                  <div className="bg-stone-600 rounded-t w-3" style={{ height: w.received > 0 ? `${(w.received / maxWeek) * 100}%` : "2px" }} />
                  <div className="bg-emerald-500 rounded-t w-3" style={{ height: w.sent > 0 ? `${(w.sent / maxWeek) * 100}%` : "2px" }} />
                </div>
                <div className="text-[9px] text-stone-400">{w.label}</div>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 text-[11px] text-stone-400 pt-3 border-t border-stone-800">
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-emerald-500" /> Sent</div>
            <div className="flex items-center gap-1.5"><div className="w-2.5 h-2.5 rounded bg-stone-600" /> Received</div>
          </div>
        </Card>

        {/* Per-rep mini cards */}
        <div className="col-span-2 grid grid-cols-2 gap-3 content-start">
          {repData.map((r: any) => (
            <div key={r.rep.id} className="bg-stone-900 rounded-xl ring-1 ring-stone-800 p-4">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-sm font-semibold text-white">{r.rep.name}</div>
                  <div className="text-[11px] text-stone-400 mt-0.5">{r.custCount} customers · {r.invoiceCount} invoices</div>
                </div>
                <Chip value={r.overduePct} good={20} warn={50} />
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div>
                  <div className="text-[10px] text-stone-400 font-semibold uppercase tracking-wider mb-0.5">Open AR</div>
                  <div className="text-base font-bold text-white tabular-nums"><CurrencyPills breakdown={r.openARByCcy} /></div>
                </div>
                <div>
                  <div className="text-[10px] text-stone-400 font-semibold uppercase tracking-wider mb-0.5">Cash {period === "month" ? "MTD" : "WTD"}</div>
                  <div className="text-base font-bold text-emerald-400 tabular-nums"><CurrencyPills breakdown={r.cashCollByCcy} /></div>
                </div>
              </div>

              <div className="space-y-1.5 text-[11px]">
                <div className="flex items-center justify-between">
                  <span className="text-stone-500 flex items-center gap-1"><Mail size={10} /> Emails sent</span>
                  <span className="font-semibold">{r.emailsSent}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-stone-500 flex items-center gap-1"><CheckSquare size={10} /> Open tasks</span>
                  <span className={`font-semibold ${r.overdueTasks > 0 ? "text-rose-600" : ""}`}>
                    {r.openTasks} {r.overdueTasks > 0 ? `(${r.overdueTasks} late)` : ""}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-stone-500 flex items-center gap-1"><Clock size={10} /> Avg DPD</span>
                  <span className={`font-semibold ${r.avgDPD > 60 ? "text-rose-600" : r.avgDPD > 30 ? "text-amber-600" : ""}`}>
                    {r.avgDPD > 0 ? `${r.avgDPD} days` : "—"}
                  </span>
                </div>
                {r.at90plus > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500 flex items-center gap-1"><AlertTriangle size={10} /> 90+ days</span>
                    <span className="font-semibold text-rose-600"><CurrencyPills breakdown={r.at90plusByCcy} /></span>
                  </div>
                )}
                {r.promisedAR > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-stone-500 flex items-center gap-1"><Target size={10} /> Committed</span>
                    <span className="font-semibold text-amber-600"><CurrencyPills breakdown={r.promisedARByCcy} /></span>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
