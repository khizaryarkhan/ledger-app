"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { useSession } from "next-auth/react";
import { Card, Badge } from "@/components/ui";
import { fmt, daysOverdue, getAgingBucket, daysFromNow, today } from "@/lib/format";
import { ArrowUpRight, ChevronRight, Circle, TrendingUp, AlertTriangle } from "lucide-react";
export default function DashboardPage() {
  const { invoices, customers, projects, regions, communications, tasks } = useData() as any;
  const { data: session } = useSession();
  const userId = (session?.user as any)?.id;
  const [regionFilter, setRegionFilter] = useState("");

  const stats = useMemo(() => {
    const regionInvoices = regionFilter
      ? invoices.filter((i: any) => {
          const c = customers.find((c: any) => c.id === i.customerId);
          if (c?.regionId === regionFilter) return true;
          const p = projects.find((p: any) => p.id === i.projectId);
          return p?.regionId === regionFilter;
        })
      : invoices;
    const open = regionInvoices.filter(i => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off");
    const totalReceivable = open.reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
    const overdue = open.filter(i => daysOverdue(i.dueDate) > 0);
    const totalOverdue = overdue.reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
    const buckets: Record<string, number> = { "Current": 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    open.forEach(i => { buckets[getAgingBucket(i)] += i.total - (i.paid || 0); });
    const disputed = open.filter(i => i.collectionStage === "Disputed").reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
    const promised = open.filter(i => i.collectionStage === "Promised" || i.collectionStage === "Promise to Pay").reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
    const dueThisWeek = open.filter(i => { const d = daysOverdue(i.dueDate); return d <= 0 && d >= -7; });
    const sevenDaysAgo = new Date(daysFromNow(-7)).getTime();
    const thirtyDaysAgo = new Date(daysFromNow(-30)).getTime();
    const emailsSent = communications.filter(c => c.direction === "Outbound" && c.channel === "Email" && new Date(c.sentAt).getTime() > sevenDaysAgo).length;
    const replies = communications.filter(c => c.direction === "Inbound" && new Date(c.sentAt).getTime() > sevenDaysAgo).length;

    // True DSO = (Total Open AR / Net Sales last 90 days) × 90
    const ninetyDaysAgo = Date.now() - 90 * 24 * 60 * 60 * 1000;
    const netSales90d = regionInvoices
      .filter(i => i.txnType !== "CreditMemo" && new Date(i.invoiceDate).getTime() >= ninetyDaysAgo)
      .reduce((s, i) => s + ((i as any).amount || 0), 0);
    const dso = netSales90d > 0 ? Math.round((totalReceivable / netSales90d) * 90) : 0;

    // Best Possible DSO = (Current/not-yet-due AR / Annual 365d Sales) × 365
    const threeSixtyFiveDaysAgo = Date.now() - 365 * 24 * 60 * 60 * 1000;
    const currentAR = open.filter(i => daysOverdue(i.dueDate) < 0).reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
    const annualSales365 = regionInvoices
      .filter(i => i.txnType !== "CreditMemo" && new Date(i.invoiceDate).getTime() >= threeSixtyFiveDaysAgo)
      .reduce((s, i) => s + ((i as any).amount || 0), 0);
    const bpDso = annualSales365 > 0 ? Math.round((currentAR / annualSales365) * 365) : 0;
    const dsoGap = Math.max(0, dso - bpDso);

    // Collection rate = invoices closed in last 30 days / total invoices
    const recentlyClosed = regionInvoices.filter(i => i.paymentStatus === "Paid" && new Date(i.updatedAt).getTime() > thirtyDaysAgo).length;
    const collectionRate = invoices.length > 0 ? Math.round(recentlyClosed / invoices.length * 100) : 0;

    // 90+ days overdue
    const over90 = open.filter(i => daysOverdue(i.dueDate) > 90).reduce((s, i) => s + (i.total - (i.paid || 0)), 0);

    // Proactive pipeline: due in 7-14 days, no lastFollowupDate
    const proactivePipeline = open.filter(i => {
      const d = daysOverdue(i.dueDate);
      return d < -6 && d >= -14 && !i.lastFollowupDate;
    });

    return { totalReceivable, totalOverdue, buckets, disputed, promised, dueThisWeek, overdue, emailsSent, replies, openCount: open.length, dso, bpDso, dsoGap, collectionRate, over90, recentlyClosed, proactivePipeline };
  }, [invoices, communications]);

  const topOverdue = useMemo(() => {
    const byCust: Record<string, number> = {};
    invoices.filter(i => i.paymentStatus !== "Paid" && daysOverdue(i.dueDate) > 0).forEach(i => {
      byCust[i.customerId] = (byCust[i.customerId] || 0) + (i.total - (i.paid || 0));
    });
    return Object.entries(byCust).map(([cid, amt]) => ({ customer: customers.find(c => c.id === cid), amount: amt }))
      .filter(x => x.customer).sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [invoices, customers, projects, communications, regionFilter]);

  // Concentration risk — top 5 customers by total open AR
  const concentrationRisk = useMemo(() => {
    const byCust: Record<string, number> = {};
    const open = invoices.filter(i => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off");
    const totalAR = open.reduce((s, i) => s + (i.total - (i.paid || 0)), 0);
    open.forEach(i => { byCust[i.customerId] = (byCust[i.customerId] || 0) + (i.total - (i.paid || 0)); });
    const sorted = Object.entries(byCust).map(([cid, amt]) => ({
      customer: customers.find(c => c.id === cid),
      amount: amt,
      pct: totalAR > 0 ? (amt / totalAR) * 100 : 0,
    })).filter(x => x.customer).sort((a, b) => b.amount - a.amount).slice(0, 5);
    const top5Pct = totalAR > 0 ? sorted.reduce((s, x) => s + x.pct, 0) : 0;
    return { rows: sorted, top5Pct, totalAR };
  }, [invoices, customers]);

  const myTasks = tasks.filter(t => !t.completed && t.assigneeId === userId).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, 5);
  const maxBucket = Math.max(...Object.values(stats.buckets), 1);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Dashboard</h1>
          <p className="text-sm text-stone-500 mt-1">Overview of receivables, aging and collection activity</p>
        </div>
        <div className="flex items-center gap-3">
          <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}
            className="h-8 px-3 pr-8 text-xs rounded-md ring-1 ring-stone-200 bg-white appearance-none"
            style={{backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundPosition: "right 0.5rem center", backgroundSize: "12px"}}>
            <option value="">All regions</option>
            {(regions ?? []).map((r: any) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <div className="text-xs text-stone-500">Last updated {fmt.date(new Date())}</div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-3">
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Total Receivable</div>
          <div className="text-2xl font-semibold text-stone-900 tracking-tight">{fmt.money(stats.totalReceivable)}</div>
          <div className="mt-2 text-[11px] text-stone-500">{stats.openCount} open invoices</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Overdue</div>
          <div className="text-2xl font-semibold text-rose-600 tracking-tight">{fmt.money(stats.totalOverdue)}</div>
          <div className="mt-2 text-[11px] text-stone-500">{stats.overdue.length} overdue invoices</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">90+ Days</div>
          <div className="text-2xl font-semibold text-rose-700 tracking-tight">{fmt.money(stats.over90)}</div>
          <div className="mt-2 text-[11px] text-stone-500">Escalation candidates</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Disputed</div>
          <div className="text-2xl font-semibold text-stone-900 tracking-tight">{fmt.money(stats.disputed)}</div>
          <div className="mt-2 text-[11px] text-stone-500">Pending resolution</div>
        </Card>
      </div>
      <div className="grid grid-cols-4 gap-3 mb-3">
        <Card padding="md" className="col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">DSO vs Best Possible</div>
            <TrendingUp size={14} className="text-stone-400" />
          </div>
          <div className="flex items-end gap-4 mb-3">
            <div>
              <div className="text-2xl font-semibold text-stone-900 tracking-tight">{stats.dso}d</div>
              <div className="text-[11px] text-stone-500">Actual DSO</div>
            </div>
            <div className="pb-1 text-stone-300">/</div>
            <div>
              <div className="text-2xl font-semibold text-emerald-600 tracking-tight">{stats.bpDso}d</div>
              <div className="text-[11px] text-stone-500">Best possible</div>
            </div>
            {stats.dsoGap > 0 && (
              <div className="ml-auto">
                <div className="text-xl font-semibold text-amber-600 tracking-tight">+{stats.dsoGap}d</div>
                <div className="text-[11px] text-stone-500">Collection gap</div>
              </div>
            )}
          </div>
          <div className="h-2 bg-stone-100 rounded-full overflow-hidden">
            <div className="h-full flex">
              <div className="h-full bg-emerald-400 rounded-l" style={{ width: `${stats.dso > 0 ? (stats.bpDso / stats.dso) * 100 : 0}%` }} />
              <div className="h-full bg-amber-400" style={{ width: `${stats.dso > 0 ? (stats.dsoGap / stats.dso) * 100 : 0}%` }} />
            </div>
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-stone-400">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> Best possible</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Collection gap</span>
          </div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Collection rate</div>
          <div className="text-2xl font-semibold text-emerald-600 tracking-tight">{stats.collectionRate}%</div>
          <div className="mt-2 text-[11px] text-stone-500">{stats.recentlyClosed} closed last 30d</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Promised</div>
          <div className="text-2xl font-semibold text-amber-600 tracking-tight">{fmt.money(stats.promised)}</div>
          <div className="mt-2 text-[11px] text-stone-500">Promise to pay</div>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card className="col-span-2">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-semibold text-stone-900">Aging buckets</h3>
            <Link href="/reports" className="text-xs text-stone-500 hover:text-stone-900 flex items-center gap-1">Aging report <ArrowUpRight size={12} /></Link>
          </div>
          <div className="space-y-3">
            {["Current", "1-30", "31-60", "61-90", "90+"].map((bucket, i) => {
              const colors = ["bg-emerald-500", "bg-amber-400", "bg-orange-500", "bg-rose-500", "bg-rose-700"];
              const labels = ["Current (not due)", "1-30 days", "31-60 days", "61-90 days", "90+ days"];
              const pct = (stats.buckets[bucket] / maxBucket) * 100;
              return (
                <div key={bucket} className="flex items-center gap-3">
                  <div className="w-32 text-xs text-stone-600 font-medium">{labels[i]}</div>
                  <div className="flex-1 h-7 bg-stone-100 rounded relative overflow-hidden">
                    <div className={`h-full ${colors[i]}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-28 text-right text-sm font-semibold text-stone-900 tabular-nums">{fmt.money(stats.buckets[bucket])}</div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-stone-900 mb-4">Activity (7 days)</h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between mb-1"><span className="text-xs text-stone-500">Emails sent</span><span className="text-lg font-semibold">{stats.emailsSent}</span></div>
              <div className="h-1.5 bg-stone-100 rounded"><div className="h-full bg-stone-900 rounded" style={{ width: `${Math.min(stats.emailsSent * 10, 100)}%` }} /></div>
            </div>
            <div>
              <div className="flex items-baseline justify-between mb-1"><span className="text-xs text-stone-500">Replies received</span><span className="text-lg font-semibold">{stats.replies}</span></div>
              <div className="h-1.5 bg-stone-100 rounded"><div className="h-full bg-emerald-500 rounded" style={{ width: `${Math.min(stats.replies * 20, 100)}%` }} /></div>
            </div>
            <div className="pt-3 border-t border-stone-100">
              <div className="text-xs text-stone-500 mb-1">Reply rate</div>
              <div className="text-lg font-semibold">{stats.emailsSent ? Math.round(stats.replies / stats.emailsSent * 100) : 0}%</div>
            </div>
          </div>
        </Card>

        <Card className="col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-stone-900">Top overdue customers</h3>
            <Link href="/customers" className="text-xs text-stone-500 hover:text-stone-900 flex items-center gap-1">View all <ArrowUpRight size={12} /></Link>
          </div>
          {topOverdue.length === 0 ? <div className="py-8 text-center text-sm text-stone-500">No overdue customers</div> : (
            <div className="space-y-1">
              {topOverdue.map(({ customer, amount }, i) => (
                <Link key={customer.id} href={`/customers/${customer.id}`} className="w-full flex items-center gap-3 px-2 py-2.5 rounded-md hover:bg-stone-50 group">
                  <div className="w-6 text-xs text-stone-400 font-mono">{i + 1}</div>
                  <div className="w-9 h-9 rounded-md bg-gradient-to-br from-stone-100 to-stone-200 flex items-center justify-center text-stone-600 text-xs font-semibold flex-shrink-0">
                    {customer.name.split(" ").slice(0, 2).map((w: string) => w[0]).join("")}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-sm font-medium text-stone-900 truncate">{customer.name}</div>
                    <div className="text-[11px] text-stone-500">{customer.code} · {customer.country}</div>
                  </div>
                  {customer.riskRating === "High" && <Badge variant="red" size="sm">High risk</Badge>}
                  <div className="text-sm font-semibold text-stone-900 tabular-nums">{fmt.money(amount, customer.currency)}</div>
                  <ChevronRight size={14} className="text-stone-300 group-hover:text-stone-500" />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-stone-900">My tasks today</h3>
            <Link href="/tasks" className="text-xs text-stone-500 hover:text-stone-900 flex items-center gap-1">All tasks <ArrowUpRight size={12} /></Link>
          </div>
          {myTasks.length === 0 ? <div className="py-8 text-center text-sm text-stone-500">All caught up</div> : (
            <div className="space-y-2">
              {myTasks.map(t => {
                const overdue = new Date(t.dueDate) < new Date(today());
                const href = t.invoiceId ? `/invoices/${t.invoiceId}` : "/tasks";
                return (
                  <Link key={t.id} href={href} className="w-full flex items-start gap-2.5 px-2 py-2 rounded-md hover:bg-stone-50">
                    <Circle size={14} className="text-stone-300 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-stone-900 truncate">{t.title}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[11px] ${overdue ? "text-rose-600 font-medium" : "text-stone-500"}`}>{fmt.relative(t.dueDate)}</span>
                        {t.priority === "Urgent" && <Badge variant="red" size="sm">Urgent</Badge>}
                        {t.priority === "High" && <Badge variant="orange" size="sm">High</Badge>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        <Card className="col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-stone-900">Invoices due this week</h3>
            <span className="text-xs text-stone-500">{stats.dueThisWeek.length} invoices</span>
          </div>
          {stats.dueThisWeek.length === 0 ? <div className="py-8 text-center text-sm text-stone-500">No invoices due this week</div> : (
            <div className="grid grid-cols-2 gap-2">
              {stats.dueThisWeek.slice(0, 6).map(inv => {
                const customer = customers.find(c => c.id === inv.customerId);
                const out = inv.total - (inv.paid || 0);
                return (
                  <Link key={inv.id} href={`/invoices/${inv.id}`} className="flex items-center gap-3 p-3 rounded-md ring-1 ring-stone-200 hover:ring-stone-300 hover:bg-stone-50">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-stone-900 truncate">{customer?.name}</div>
                      <div className="text-[11px] text-stone-500 mt-0.5 font-mono">{inv.invoiceNumber}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-stone-900 tabular-nums">{fmt.money(out, inv.currency)}</div>
                      <div className="text-[11px] text-stone-500 mt-0.5">Due {fmt.shortDate(inv.dueDate)}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        {/* Concentration Risk */}
        <Card className="col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-stone-900">Concentration risk</h3>
              <p className="text-[11px] text-stone-500 mt-0.5">Top 5 customers as % of total AR</p>
            </div>
            {concentrationRisk.top5Pct > 50 && (
              <div className="flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 px-2 py-1 rounded-md">
                <AlertTriangle size={11} /> High concentration
              </div>
            )}
          </div>
          {concentrationRisk.rows.length === 0 ? (
            <div className="py-6 text-center text-sm text-stone-500">No open AR</div>
          ) : (
            <div className="space-y-2.5">
              {concentrationRisk.rows.map(({ customer, amount, pct }) => (
                <Link key={customer.id} href={`/customers/${customer.id}`} className="block group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-medium text-stone-800 truncate group-hover:text-stone-900">{customer.name}</span>
                    <div className="flex items-center gap-2 ml-2 shrink-0">
                      <span className="text-[11px] font-semibold text-stone-700 tabular-nums">{fmt.money(amount)}</span>
                      <span className={`text-[11px] font-bold tabular-nums w-10 text-right ${pct > 20 ? "text-amber-600" : "text-stone-500"}`}>{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${pct > 20 ? "bg-amber-400" : "bg-stone-400"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </Link>
              ))}
              <div className="pt-2 border-t border-stone-100 flex items-center justify-between">
                <span className="text-[11px] text-stone-500">Top 5 total concentration</span>
                <span className={`text-[12px] font-bold tabular-nums ${concentrationRisk.top5Pct > 50 ? "text-amber-600" : "text-emerald-600"}`}>
                  {concentrationRisk.top5Pct.toFixed(1)}%
                </span>
              </div>
            </div>
          )}
        </Card>

        {/* Proactive Pipeline */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-stone-900">Proactive pipeline</h3>
              <p className="text-[11px] text-stone-500 mt-0.5">Due in 7–14 days, not yet contacted</p>
            </div>
            <Link href="/smart-views" className="text-xs text-stone-500 hover:text-stone-900 flex items-center gap-1">Smart Views <ArrowUpRight size={12} /></Link>
          </div>
          {stats.proactivePipeline.length === 0 ? (
            <div className="py-6 text-center">
              <div className="text-2xl font-semibold text-emerald-600 mb-1">✓</div>
              <div className="text-sm text-stone-500">All upcoming invoices contacted</div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-xs text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-md px-3 py-2 mb-3">
                <strong>{stats.proactivePipeline.length}</strong> invoice{stats.proactivePipeline.length !== 1 ? "s" : ""} due soon with no contact logged — reach out now
              </div>
              {stats.proactivePipeline.slice(0, 4).map(inv => {
                const customer = customers.find(c => c.id === inv.customerId);
                const d = Math.abs(daysOverdue(inv.dueDate));
                return (
                  <Link key={inv.id} href={`/invoices/${inv.id}`} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-stone-50">
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-stone-800 truncate">{customer?.name}</div>
                      <div className="text-[11px] text-stone-500 font-mono">{inv.invoiceNumber}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[12px] font-semibold tabular-nums">{fmt.money(inv.total - (inv.paid || 0))}</div>
                      <div className="text-[10px] text-amber-600">in {d}d</div>
                    </div>
                  </Link>
                );
              })}
              {stats.proactivePipeline.length > 4 && (
                <div className="text-center text-[11px] text-stone-400 pt-1">+{stats.proactivePipeline.length - 4} more</div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
