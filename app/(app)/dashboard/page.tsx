"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { useSession } from "next-auth/react";
import { Card, Badge } from "@/components/ui";
import { fmt, daysOverdue, getAgingBucket, daysFromNow, today } from "@/lib/format";
import { ArrowUpRight, ChevronRight, Circle } from "lucide-react";
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

    // DSO = (Total AR / Total Revenue last 90 days) * 90
    // Approximated as avg days overdue weighted by amount
    const overdueInvoices = open.filter(i => daysOverdue(i.dueDate) > 0);
    const weightedDays = overdueInvoices.reduce((s, i) => s + daysOverdue(i.dueDate) * (i.total - (i.paid || 0)), 0);
    const dso = totalOverdue > 0 ? Math.round(weightedDays / totalOverdue) : 0;

    // Collection rate = invoices closed in last 30 days / total invoices
    const recentlyClosed = regionInvoices.filter(i => i.paymentStatus === "Paid" && new Date(i.updatedAt).getTime() > thirtyDaysAgo).length;
    const collectionRate = invoices.length > 0 ? Math.round(recentlyClosed / invoices.length * 100) : 0;

    // 90+ days overdue
    const over90 = open.filter(i => daysOverdue(i.dueDate) > 90).reduce((s, i) => s + (i.total - (i.paid || 0)), 0);

    return { totalReceivable, totalOverdue, buckets, disputed, promised, dueThisWeek, overdue, emailsSent, replies, openCount: open.length, dso, collectionRate, over90, recentlyClosed };
  }, [invoices, communications]);

  const topOverdue = useMemo(() => {
    const byCust: Record<string, number> = {};
    invoices.filter(i => i.paymentStatus !== "Paid" && daysOverdue(i.dueDate) > 0).forEach(i => {
      byCust[i.customerId] = (byCust[i.customerId] || 0) + (i.total - (i.paid || 0));
    });
    return Object.entries(byCust).map(([cid, amt]) => ({ customer: customers.find(c => c.id === cid), amount: amt }))
      .filter(x => x.customer).sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [invoices, customers, projects, communications, regionFilter]);

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
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">DSO</div>
          <div className="text-2xl font-semibold text-stone-900 tracking-tight">{stats.dso} days</div>
          <div className="mt-2 text-[11px] text-stone-500">Days sales outstanding</div>
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
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Emails sent (7d)</div>
          <div className="text-2xl font-semibold text-stone-900 tracking-tight">{stats.emailsSent}</div>
          <div className="mt-2 text-[11px] text-stone-500">{stats.replies} replies received</div>
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
      </div>
    </div>
  );
}
