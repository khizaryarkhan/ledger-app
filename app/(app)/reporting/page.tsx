"use client";

import Link from "next/link";
import { BarChart3, TrendingUp, BookOpen, CreditCard, FileText, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui";

const REPORTS = [
  {
    href: "/reporting/profit-loss",
    icon: TrendingUp,
    color: "emerald",
    title: "Profit & Loss",
    desc: "Revenue, expenses, and net profit for any date range",
    qbo: true, xero: true,
  },
  {
    href: "/reporting/balance-sheet",
    icon: BookOpen,
    color: "blue",
    title: "Balance Sheet",
    desc: "Assets, liabilities, and equity at a point in time",
    qbo: true, xero: true,
  },
  {
    href: "/reporting/cash-flow",
    icon: CreditCard,
    color: "violet",
    title: "Cash Flow",
    desc: "Cash inflows and outflows for a period",
    qbo: true, xero: true,
  },
  {
    href: "/reporting/trial-balance",
    icon: FileText,
    color: "amber",
    title: "Trial Balance",
    desc: "All account balances — use for reconciliation and audit",
    qbo: true, xero: true,
  },
  {
    href: "/reporting/ar-aging",
    icon: BarChart3,
    color: "rose",
    title: "AR Ageing",
    desc: "Outstanding receivables by customer, aged into buckets",
    qbo: true, xero: true,
  },
  {
    href: "/reporting/ap-aging",
    icon: BarChart3,
    color: "orange",
    title: "AP Ageing",
    desc: "Outstanding payables by supplier, aged into buckets",
    qbo: true, xero: true,
  },
];

const COLOR_MAP: Record<string, string> = {
  emerald: "text-emerald-400 bg-emerald-500/10",
  blue:    "text-blue-400 bg-blue-500/10",
  violet:  "text-violet-400 bg-violet-500/10",
  amber:   "text-amber-400 bg-amber-500/10",
  rose:    "text-rose-400 bg-rose-500/10",
  orange:  "text-orange-400 bg-orange-500/10",
};

export default function ReportingPage() {
  return (
    <div className="p-6 max-w-[900px] mx-auto">
      <div className="mb-6">
        <h1 className="text-base font-semibold text-white">Reporting</h1>
        <p className="text-xs text-stone-500 mt-0.5">
          Native reports pulled live from your accounting integration — always up to date, no sync needed.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map(r => {
          const Icon = r.icon;
          return (
            <Link key={r.href} href={r.href} className="block group">
              <Card className="h-full hover:ring-stone-600 transition-all cursor-pointer p-5">
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${COLOR_MAP[r.color]}`}>
                  <Icon size={17} />
                </div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white">{r.title}</h3>
                  <ArrowUpRight size={13} className="text-stone-600 group-hover:text-stone-300 transition-colors shrink-0 mt-0.5" />
                </div>
                <p className="text-[12px] text-stone-500 mt-1 leading-relaxed mb-3">{r.desc}</p>
                <div className="flex gap-1.5">
                  {r.qbo  && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">QBO</span>}
                  {r.xero && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">Xero</span>}
                </div>
              </Card>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
