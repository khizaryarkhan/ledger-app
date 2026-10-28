"use client";

/**
 * Reports hub — the home for every accounting report. Grouped like QBO's
 * Reports centre; we keep adding reports here over time.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, BookOpen, ScrollText, TrendingUp, Scale, Boxes, ClipboardList, PackageSearch, ArrowRight, ShoppingCart, PackageCheck, FileText, Truck, Users, Building2, Receipt, Coins, GitBranch, Gauge, AlertTriangle, Landmark, Timer } from "lucide-react";
import { useData } from "@/components/data-provider";
import { ListPage, ListPageHeader } from "@/components/list-view";
import { controlCompactIcon } from "@/components/form-kit";

type Report = { href: string; title: string; sub: string; icon: any };
type Group = { label: string; reports: Report[] };

// Always available — general ledger/financial statements and core AR/AP,
// independent of which vertical modules an org has.
const CORE_GROUPS: Group[] = [
  {
    label: "Financial statements",
    reports: [
      { href: "/accounting/reports/general-ledger", title: "General Ledger", sub: "Every posting to every account, in date order.", icon: BookOpen },
      { href: "/accounting/reports/trial-balance",  title: "Trial Balance",  sub: "Each account's balance — debits must equal credits.", icon: ScrollText },
      { href: "/accounting/reports/profit-loss",    title: "Profit & Loss",  sub: "Income and expenses for a chosen period.", icon: TrendingUp },
      { href: "/accounting/reports/comprehensive-income", title: "Comprehensive Income", sub: "Net profit plus Other Comprehensive Income for a chosen period.", icon: TrendingUp },
      { href: "/accounting/reports/balance-sheet",  title: "Balance Sheet",  sub: "Assets, equity and liabilities at a point in time.", icon: Scale },
      { href: "/accounting/reports/changes-in-equity", title: "Changes in Equity", sub: "How each equity category moved over a chosen period.", icon: Landmark },
      { href: "/accounting/reports/cash-flow",      title: "Cash Flow",      sub: "Where cash came from and went — operating, investing, financing.", icon: TrendingUp },
    ],
  },
  {
    label: "Receivables & payables",
    reports: [
      { href: "/accounting/reports/aged-receivables", title: "Aged Receivables", sub: "Open customer invoices bucketed by how overdue they are.", icon: Users },
      { href: "/accounting/reports/aged-payables", title: "Aged Payables", sub: "Open supplier bills bucketed by how overdue they are.", icon: Building2 },
      { href: "/accounting/reports/tax-liability", title: "Sales Tax Liability", sub: "Output tax on sales less input tax on purchases, per period.", icon: Receipt },
      { href: "/accounting/reports/fx-exposure", title: "Currency Exposure", sub: "Foreign balances vs home carrying value — unrealised FX gain/loss.", icon: Coins },
    ],
  },
];

// Only relevant to orgs with the Manufacturing module — every one of these
// reports is driven by inventory tracking, receiving/shipping, or job work.
const MANUFACTURING_GROUPS: Group[] = [
  {
    label: "Stock & inventory",
    reports: [
      { href: "/accounting/reports/stock-valuation", title: "Stock Valuation Summary", sub: "On-hand quantity, average cost and total value per item.", icon: Boxes },
      { href: "/accounting/reports/stock-valuation?view=lots", title: "Stock Valuation Detail", sub: "Every open FIFO cost lot with its remaining qty and value.", icon: PackageSearch },
      { href: "/accounting/reports/stock-vs-gl", title: "Stock vs GL", sub: "Stock value against each inventory account's ledger balance, as at a date.", icon: Scale },
      { href: "/accounting/reports/stock-status", title: "Stock Status", sub: "On-hand & expected (on PO) vs minimum reorder level.", icon: ClipboardList },
      { href: "/accounting/reports/lot-traceability", title: "Lot Traceability", sub: "A lot's complete history — what it was made from and what it became.", icon: GitBranch },
      { href: "/accounting/reports/jobwork-yield", title: "Subcontractor Yield & Wastage", sub: "Actual material yield vs. sent, ranked per job-work vendor.", icon: Gauge },
      { href: "/accounting/reports/delivery-performance", title: "Supplier Delivery Performance", sub: "On time / in full per supplier against requested and promised dates.", icon: Timer },
      { href: "/accounting/reports/delivery-performance?side=customer", title: "Customer Delivery Performance", sub: "Did we ship what customers ordered, when we promised? OTIF per customer.", icon: Timer },
      { href: "/accounting/reports/production-performance", title: "Production Performance", sub: "Planned vs actual for MOs and job work: on time, yield, downtime, delay and scrap reasons.", icon: Gauge },
      { href: "/accounting/reports/delivery-risk", title: "Delivery Risk", sub: "Job Work, POs and MOs running past their expected date, grouped by Sales Order.", icon: AlertTriangle },
    ],
  },
  {
    label: "Purchasing",
    reports: [
      { href: "/accounting/reports/open-pos", title: "Open Purchase Orders", sub: "Ordered but not fully received — remaining value per PO.", icon: ShoppingCart },
      { href: "/accounting/reports/expected-bills", title: "Expected Bills", sub: "Goods received not yet billed — the open GR/IR accrual.", icon: PackageCheck },
      { href: "/accounting/reports/open-bills", title: "Open Bills", sub: "Posted supplier bills with an unpaid A/P balance.", icon: FileText },
    ],
  },
  {
    label: "Sales",
    reports: [
      { href: "/accounting/reports/open-sos", title: "Open Sales Orders", sub: "Confirmed but not fully shipped — value committed to customers.", icon: ShoppingCart },
      { href: "/accounting/reports/awaiting-invoicing", title: "Awaiting Invoicing", sub: "Goods shipped to customers but not yet invoiced.", icon: Truck },
      { href: "/accounting/reports/open-invoices", title: "Open Invoices", sub: "Posted customer invoices with an unpaid A/R balance.", icon: FileText },
    ],
  },
];

export default function ReportsHubPage() {
  const [q, setQ] = useState("");
  const { orgSettings } = useData();
  const manufacturingEnabled = Array.isArray(orgSettings?.enabledModules) && orgSettings.enabledModules.includes("manufacturing");

  const ALL_GROUPS = useMemo(
    () => manufacturingEnabled ? [...CORE_GROUPS, ...MANUFACTURING_GROUPS] : CORE_GROUPS,
    [manufacturingEnabled],
  );

  const groups = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return ALL_GROUPS;
    return ALL_GROUPS.map(g => ({ ...g, reports: g.reports.filter(r => r.title.toLowerCase().includes(s) || r.sub.toLowerCase().includes(s)) })).filter(g => g.reports.length);
  }, [q, ALL_GROUPS]);

  return (
    <ListPage>
      <ListPageHeader title="Reports" subtitle="All your accounting reports in one place." />
      <div className="flex-1 overflow-y-auto px-6 py-4">
      <div className="relative max-w-sm mb-6">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-600" />
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search reports…" className={`${controlCompactIcon} w-full`} />
      </div>

      {groups.map(g => (
        <div key={g.label} className="mb-7">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">{g.label}</div>
          <div className="grid sm:grid-cols-2 gap-2.5">
            {g.reports.map(r => {
              const Icon = r.icon;
              return (
                <Link key={r.href} href={r.href} className="group flex items-start gap-3 rounded-xl bg-stone-900 border border-stone-800 hover:border-stone-600 p-3.5 transition-colors">
                  <div className="w-8 h-8 rounded-lg bg-stone-800 flex items-center justify-center shrink-0 mt-0.5"><Icon size={15} className="text-stone-300" /></div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 text-[13.5px] font-medium text-stone-100">{r.title}<ArrowRight size={13} className="text-stone-600 opacity-0 group-hover:opacity-100 transition-opacity" /></div>
                    <p className="text-[12px] text-stone-400 leading-snug mt-0.5">{r.sub}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
      {groups.length === 0 && <p className="text-sm text-stone-500">No reports match “{q}”.</p>}
      </div>
    </ListPage>
  );
}
