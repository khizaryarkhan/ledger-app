"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, EmptyState, stageBadge } from "@/components/ui";
import { fmt, daysOverdue, daysFromNow } from "@/lib/format";
import { Filter, ChevronRight } from "lucide-react";
import { getInvoiceRegionIdFromProjects, REGIONS } from "@/lib/regions";

const VIEWS = [
  // IMMEDIATE ACTION
  { id: "due-today", name: "Due today", description: "Must follow up today", filter: (i: any) => i.paymentStatus !== "Paid" && daysOverdue(i.dueDate) === 0, group: "Immediate" },
  { id: "due-week", name: "Due this week", description: "Invoices due in the next 7 days", filter: (i: any) => i.paymentStatus !== "Paid" && daysOverdue(i.dueDate) < 0 && daysOverdue(i.dueDate) >= -7, group: "Immediate" },
  { id: "overdue-no-reminder", name: "Overdue, never contacted", description: "Past due with zero follow-up — chase today", filter: (i: any) => daysOverdue(i.dueDate) > 0 && i.paymentStatus !== "Paid" && !i.lastFollowupDate, group: "Immediate" },
  { id: "broken-promises", name: "Broken promises", description: "Customer promised to pay — date passed, still unpaid", filter: (i: any) => i.collectionStage === "Promise to Pay" && i.promiseDate && daysOverdue(i.promiseDate) > 0 && i.paymentStatus !== "Paid", group: "Immediate" },
  // AGING BUCKETS
  { id: "1-30", name: "1–30 days overdue", description: "First overdue bucket — send reminder now", filter: (i: any) => { const d = daysOverdue(i.dueDate); return d > 0 && d <= 30 && i.paymentStatus !== "Paid"; }, group: "Aging" },
  { id: "31-60", name: "31–60 days overdue", description: "Second bucket — escalate to senior contact", filter: (i: any) => { const d = daysOverdue(i.dueDate); return d > 30 && d <= 60 && i.paymentStatus !== "Paid"; }, group: "Aging" },
  { id: "61-90", name: "61–90 days overdue", description: "Third bucket — final notice before legal", filter: (i: any) => { const d = daysOverdue(i.dueDate); return d > 60 && d <= 90 && i.paymentStatus !== "Paid"; }, group: "Aging" },
  { id: "90-plus", name: "90+ days overdue", description: "Refer to legal / write-off consideration", filter: (i: any) => daysOverdue(i.dueDate) > 90 && i.paymentStatus !== "Paid", group: "Aging" },
  // RISK
  { id: "high-value-overdue", name: "High value overdue (>€10k)", description: "Big-ticket invoices past due — priority chase", filter: (i: any) => daysOverdue(i.dueDate) > 0 && i.paymentStatus !== "Paid" && (i.total - (i.paid || 0)) > 10000, group: "Risk" },
  { id: "disputed", name: "Disputed", description: "In dispute — needs resolution before collection", filter: (i: any) => i.collectionStage === "Disputed", group: "Risk" },
  { id: "partial-paid", name: "Partially paid", description: "Payment received but balance still owing", filter: (i: any) => i.paymentStatus === "Partially Paid", group: "Risk" },
  { id: "promise-this-week", name: "Promises due this week", description: "Confirm receipt of promised payments", filter: (i: any) => i.collectionStage === "Promise to Pay" && i.promiseDate && daysOverdue(i.promiseDate) <= 0 && daysOverdue(i.promiseDate) >= -7, group: "Risk" },
];

export default function SmartViewsPage() {
  const { invoices, customers, projects } = useData();
  const [selected, setSelected] = useState(VIEWS[0].id);
  const [regionFilter, setRegionFilter] = useState("");
  const view = VIEWS.find(v => v.id === selected)!;

  const results = useMemo(() => {
    let res = invoices.filter(view.filter);
    if (regionFilter) res = res.filter((i: any) => getInvoiceRegionIdFromProjects(i, projects) === regionFilter);
    return res;
  }, [invoices, view, regionFilter, projects]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Smart Views</h1>
        <p className="text-sm text-stone-500 mt-1">Pre-built filters for common collections workflows</p>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-4">
          <div className="space-y-1">
            {VIEWS.map(v => {
              const count = invoices.filter(v.filter).length;
              const active = selected === v.id;
              return (
                <button key={v.id} onClick={() => setSelected(v.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-md transition-colors ${active ? "bg-white ring-1 ring-stone-200 shadow-sm" : "hover:bg-stone-50"}`}>
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="text-sm font-medium text-stone-900">{v.name}</div>
                    <span className="text-[11px] font-semibold text-stone-500 tabular-nums">{count}</span>
                  </div>
                  <div className="text-[11px] text-stone-500">{v.description}</div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="col-span-8">
          <Card padding="none">
            <div className="px-4 py-3 border-b border-stone-200">
              <div className="text-sm font-semibold text-stone-900">{view.name}</div>
              <div className="text-[11px] text-stone-500 mt-0.5">{results.length} invoices</div>
            </div>
            {results.length === 0 ? (
              <EmptyState icon={Filter} title="No matching invoices" description="Nothing matches this filter right now — that's good news." />
            ) : (
              <div>
                {results.slice(0, 50).map(inv => {
                  const customer = customers.find(c => c.id === inv.customerId);
                  const out = inv.total - (inv.paid || 0);
                  return (
                    <Link key={inv.id} href={`/invoices/${inv.id}`} className="flex items-center gap-3 px-4 py-2.5 border-b border-stone-100 last:border-0 hover:bg-stone-50">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-mono text-stone-500">{inv.invoiceNumber}</span>
                          <Badge variant={stageBadge(inv.collectionStage)} size="sm">{inv.collectionStage}</Badge>
                        </div>
                        <div className="text-sm font-medium text-stone-900 truncate mt-0.5">{customer?.name}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm font-semibold tabular-nums">{fmt.money(out, inv.currency)}</div>
                        <div className="text-[11px] text-stone-500">Due {fmt.shortDate(inv.dueDate)}</div>
                      </div>
                      <ChevronRight size={14} className="text-stone-300" />
                    </Link>
                  );
                })}
                {results.length > 50 && <div className="px-4 py-3 text-center text-xs text-stone-500 bg-stone-50">Showing first 50 of {results.length}</div>}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
