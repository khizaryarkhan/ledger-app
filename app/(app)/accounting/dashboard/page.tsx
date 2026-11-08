"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui";
import { fmt, localToday } from "@/lib/format";
import {
  AlertCircle, AlertTriangle, Wallet, TrendingUp, TrendingDown, Scale, ShieldCheck, ArrowUpRight,
  BookOpen, Landmark, Receipt, Globe, CheckCircle2, CalendarCheck, ArrowDownLeft,
} from "lucide-react";

interface Overview {
  currency: string;
  ar: { currency?: string; total: number; glBalance: number | null };
  ap: { currency?: string; total: number; glBalance: number | null };
  ledgerIntegrity: { trialBalanceOk: boolean; balanceSheetOk: boolean };
}
interface Aging { buckets: Record<string, number>; total: number }
interface AttentionItem { key: string; label: string; detail: string; href: string; count: number; amount?: number }
interface CashRow { currency: string; overdue: number; next30: number }
interface Metric { current: number; previous: number; change: number | null }
interface Dash {
  today: string;
  currency: string;
  ledgerHeld: boolean;
  attention: AttentionItem[];
  period: { bookCloseDate: string | null; lastClosedEnd: string | null; fiscalYearStartLabel: string } | null;
  banks: { accountId: string; name: string; code: string | null; currency: string; balance: number; lastReconciled: string | null }[];
  cashIn: CashRow[];
  cashOut: CashRow[];
  pl: {
    window: { current: { from: string; to: string }; previous: { from: string; to: string } };
    revenue: Metric; grossProfit: Metric; netProfit: Metric;
    grossMargin: { current: number | null; previous: number | null };
    topExpenses: { accountId: string | null; name: string; code: string | null; amount: number }[];
  } | null;
}

const Sk = ({ h = "h-7", w = "w-28" }: { h?: string; w?: string }) => <div className={`${h} ${w} bg-stone-800 animate-pulse rounded mt-1`} />;
const LABEL = "text-[11px] uppercase tracking-wider text-stone-400 font-semibold";
const pct1 = (n: number) => `${Math.round(n * 10) / 10}%`;

const QUICK_LINKS = [
  { href: "/accounting/reports/trial-balance", label: "Trial Balance", icon: Scale },
  { href: "/accounting/reports/profit-loss", label: "Profit & Loss", icon: TrendingUp },
  { href: "/accounting/reports/balance-sheet", label: "Balance Sheet", icon: BookOpen },
  { href: "/accounting/reports/cash-flow", label: "Cash Flow", icon: Wallet },
  { href: "/accounting/reconcile", label: "Reconcile", icon: Landmark },
  { href: "/accounting/reports/tax-liability", label: "Tax Liability", icon: Receipt },
  { href: "/accounting/reports/fx-exposure", label: "FX Exposure", icon: Globe },
];

const BUCKETS = [
  { key: "current", label: "Current", color: "bg-emerald-500" },
  { key: "1-30", label: "1-30 days", color: "bg-amber-400" },
  { key: "31-60", label: "31-60 days", color: "bg-orange-500" },
  { key: "61-90", label: "61-90 days", color: "bg-rose-400" },
  { key: "90+", label: "90+ days", color: "bg-rose-600" },
];

function CardHeader({ title, href, linkLabel }: { title: string; href?: string; linkLabel?: string }) {
  return (
    <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
      <h2 className="text-base font-semibold text-white">{title}</h2>
      {href && (
        <Link href={href} className="text-xs text-stone-400 hover:text-white inline-flex items-center gap-1">
          {linkLabel} <ArrowUpRight size={12} />
        </Link>
      )}
    </div>
  );
}

function Change({ value }: { value: number | null }) {
  if (value == null) return <span className="text-[11px] text-stone-500">no comparison</span>;
  const up = value >= 0;
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${up ? "text-emerald-400" : "text-rose-400"}`}>
      <Icon size={12} /> {up ? "+" : ""}{pct1(value)}
    </span>
  );
}

function AttentionCard({ items, loading, ccy }: { items: AttentionItem[]; loading: boolean; ccy: string }) {
  return (
    <Card padding="none" className="lg:col-span-2">
      <CardHeader title="Needs attention" />
      <div className="p-2">
        {loading && [0, 1, 2].map((i) => <div key={i} className="h-12 m-2 bg-stone-800 animate-pulse rounded" />)}
        {!loading && items.length === 0 && (
          <div className="flex items-center gap-3 px-3 py-6 text-sm text-stone-400">
            <CheckCircle2 size={18} className="text-emerald-400" />
            Nothing waiting. Approvals, reconciliations and ledger checks are all clear.
          </div>
        )}
        {!loading && items.map((it) => (
          <Link key={it.key} href={it.href} className="flex items-center gap-3 px-3 py-3 rounded-md hover:bg-stone-800/60 transition-colors group">
            <div className="w-8 h-8 rounded-md bg-amber-500/10 ring-1 ring-amber-500/30 text-amber-400 flex items-center justify-center text-sm font-semibold tabular-nums shrink-0">
              {it.count}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-stone-100">{it.label}</div>
              <div className="text-xs text-stone-400 truncate">{it.detail}</div>
            </div>
            {it.amount != null && <div className="text-sm font-semibold tabular-nums text-white shrink-0">{fmt.money(it.amount, ccy)}</div>}
            <ArrowUpRight size={14} className="text-stone-500 group-hover:text-white shrink-0" />
          </Link>
        ))}
      </div>
    </Card>
  );
}

function PeriodCard({ period, loading }: { period: Dash["period"]; loading: boolean }) {
  return (
    <Card padding="none">
      <CardHeader title="Period" href="/settings/financial-year" linkLabel="Close a period" />
      <div className="p-5 space-y-4">
        {loading ? <><Sk /><Sk w="w-40" /></> : !period ? (
          <div className="text-sm text-stone-400">Your books are kept in QuickBooks / Xero, so periods are closed there.</div>
        ) : <>
          <div>
            <div className={LABEL}>Books locked to</div>
            <div className="text-xl font-semibold text-white mt-1">{period.bookCloseDate ? fmt.date(period.bookCloseDate) : "Not locked"}</div>
            <div className="text-xs text-stone-400 mt-1">
              {period.bookCloseDate ? "Entries on or before this date can't be changed" : "Any date can still be posted to or edited"}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-stone-400">
            <CalendarCheck size={14} />
            {period.lastClosedEnd ? `Last year-end closed ${fmt.date(period.lastClosedEnd)}` : "No financial year closed yet"}
            <span className="text-stone-600">·</span> Year starts {period.fiscalYearStartLabel}
          </div>
        </>}
      </div>
    </Card>
  );
}

function CashPositionCard({ banks, loading, ledgerHeld }: { banks: Dash["banks"]; loading: boolean; ledgerHeld: boolean }) {
  return (
    <Card padding="none">
      <CardHeader title="Cash position" href="/accounting/reconcile" linkLabel="Reconcile" />
      <div className="p-5">
        {loading && [0, 1, 2].map((i) => <div key={i} className="h-8 mb-2 bg-stone-800 animate-pulse rounded" />)}
        {!loading && !ledgerHeld && <div className="text-sm text-stone-400">Bank balances are kept in QuickBooks / Xero.</div>}
        {!loading && ledgerHeld && banks.length === 0 && <div className="text-sm text-stone-400">No bank accounts in the chart of accounts yet.</div>}
        {!loading && ledgerHeld && banks.length > 0 && (
          <ul className="divide-y divide-stone-800">
            {banks.map((b) => (
              <li key={b.accountId} className="py-2.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/accounting/reports/general-ledger?accountId=${b.accountId}`} className="text-sm text-stone-100 hover:underline truncate block">
                    {b.code ? `${b.code} · ` : ""}{b.name}
                  </Link>
                  <div className={`text-[11px] ${b.lastReconciled ? "text-stone-500" : "text-amber-400"}`}>
                    {b.lastReconciled ? `Reconciled to ${fmt.date(b.lastReconciled)}` : "Never reconciled"}
                  </div>
                </div>
                <div className={`text-sm font-semibold tabular-nums shrink-0 ${b.balance < 0 ? "text-rose-400" : "text-white"}`}>
                  {fmt.money(b.balance, b.currency)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function CashFlowSide({ title, rows, icon, tone }: { title: string; rows: CashRow[]; icon: React.ReactNode; tone: string }) {
  return (
    <div>
      <div className={`flex items-center gap-1.5 ${LABEL} mb-2`}>{icon}{title}</div>
      {rows.length === 0 ? <div className="text-sm text-stone-500">Nothing due</div> : rows.map((r) => (
        <div key={r.currency} className="mb-2">
          <div className={`text-xl font-semibold tabular-nums ${tone}`}>{fmt.money(r.next30, r.currency)}</div>
          <div className="text-[11px] text-stone-400">
            due in 30 days{r.overdue > 0 && <> · <span className="text-rose-400">{fmt.money(r.overdue, r.currency)} overdue</span></>}
          </div>
        </div>
      ))}
    </div>
  );
}

function CashFlowCard({ cashIn, cashOut, loading }: { cashIn: CashRow[]; cashOut: CashRow[]; loading: boolean }) {
  // One net per currency; currencies are never added together.
  const ccys = Array.from(new Set([...cashIn, ...cashOut].map((r) => r.currency))).sort();
  const sum = (rows: CashRow[], c: string) => { const r = rows.find((x) => x.currency === c); return r ? r.overdue + r.next30 : 0; };
  return (
    <Card padding="none" className="lg:col-span-2">
      <CardHeader title="Cash in and out, next 30 days" href="/accounting/reports/cash-flow" linkLabel="Cash flow" />
      <div className="p-5">
        {loading ? <div className="grid grid-cols-3 gap-4">{[0, 1, 2].map((i) => <div key={i}><Sk /><Sk h="h-3" w="w-20" /></div>)}</div> : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            <Link href="/accounting/reports/aged-receivables" className="hover:opacity-90">
              <CashFlowSide title="Coming in" rows={cashIn} tone="text-emerald-400" icon={<ArrowDownLeft size={12} />} />
            </Link>
            <Link href="/accounting/reports/aged-payables" className="hover:opacity-90">
              <CashFlowSide title="Going out" rows={cashOut} tone="text-rose-400" icon={<ArrowUpRight size={12} />} />
            </Link>
            <div>
              <div className={`${LABEL} mb-2`}>Expected net</div>
              {ccys.length === 0 ? <div className="text-sm text-stone-500">—</div> : ccys.map((c) => {
                const net = sum(cashIn, c) - sum(cashOut, c);
                return (
                  <div key={c} className="mb-2">
                    <div className={`text-xl font-semibold tabular-nums ${net < 0 ? "text-rose-400" : "text-white"}`}>{fmt.money(net, c)}</div>
                    <div className="text-[11px] text-stone-400">including overdue</div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Card>
  );
}

function PerformanceCard({ pl, loading, ccy }: { pl: Dash["pl"]; loading: boolean; ccy: string }) {
  const rows = pl ? [
    { label: "Revenue", m: pl.revenue, tone: "text-white" },
    { label: "Gross profit", m: pl.grossProfit, tone: "text-sky-400" },
    { label: "Net profit", m: pl.netProfit, tone: pl.netProfit.current >= 0 ? "text-emerald-400" : "text-rose-400" },
  ] : [];
  const sub = pl
    ? `${fmt.shortDate(pl.window.current.from)} – ${fmt.shortDate(pl.window.current.to)} vs ${fmt.shortDate(pl.window.previous.from)} – ${fmt.shortDate(pl.window.previous.to)}`
    : "";
  return (
    <Card padding="none" className="lg:col-span-2">
      <CardHeader title="This month vs last month" href="/accounting/reports/profit-loss" linkLabel="Profit & Loss" />
      <div className="p-5">
        {loading ? <div className="grid grid-cols-4 gap-4">{[0, 1, 2, 3].map((i) => <div key={i}><Sk /><Sk h="h-3" w="w-20" /></div>)}</div> : !pl ? (
          <div className="text-sm text-stone-400">Profit &amp; loss is kept in QuickBooks / Xero.</div>
        ) : <>
          <div className="text-xs text-stone-500 mb-4">{sub}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 sm:divide-x divide-stone-800">
            {rows.map(({ label, m, tone }, i) => (
              <div key={label} className={i ? "sm:pl-4" : ""}>
                <div className={LABEL}>{label}</div>
                <div className={`text-xl font-semibold tabular-nums mt-1 ${tone}`}>{fmt.money(m.current, ccy)}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2"><Change value={m.change} /><span className="text-[11px] text-stone-500">was {fmt.money(m.previous, ccy)}</span></div>
              </div>
            ))}
            <div className="sm:pl-4">
              <div className={LABEL}>Gross margin</div>
              <div className="text-xl font-semibold tabular-nums mt-1 text-white">{pl.grossMargin.current == null ? "—" : pct1(pl.grossMargin.current)}</div>
              <div className="mt-1 text-[11px] text-stone-500">was {pl.grossMargin.previous == null ? "—" : pct1(pl.grossMargin.previous)}</div>
            </div>
          </div>
        </>}
      </div>
    </Card>
  );
}

function TopExpensesCard({ pl, loading, ccy }: { pl: Dash["pl"]; loading: boolean; ccy: string }) {
  const lines = pl?.topExpenses ?? [];
  const max = Math.max(...lines.map((l) => l.amount), 1);
  const from = pl?.window.current.from ?? "";
  const to = pl?.window.current.to ?? "";
  return (
    <Card padding="none">
      <CardHeader title="Top expenses this month" />
      <div className="p-5 space-y-3">
        {loading && [0, 1, 2, 3, 4].map((i) => <div key={i} className="h-6 bg-stone-800 animate-pulse rounded" />)}
        {!loading && !pl && <div className="text-sm text-stone-400">Kept in QuickBooks / Xero.</div>}
        {!loading && pl && lines.length === 0 && <div className="text-sm text-stone-500">No expenses posted this month.</div>}
        {!loading && lines.map((l) => {
          const href = l.accountId ? `/accounting/reports/general-ledger?accountId=${l.accountId}&from=${from}&to=${to}` : "/accounting/reports/general-ledger";
          return (
            <Link key={l.accountId ?? l.name} href={href} className="block group">
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="text-stone-300 group-hover:text-white truncate">{l.name}</span>
                <span className="text-white font-semibold tabular-nums shrink-0 ml-2">{fmt.money(l.amount, ccy)}</span>
              </div>
              <div className="h-1.5 bg-stone-800/60 rounded overflow-hidden">
                <div className="h-full bg-sky-500 rounded" style={{ width: `${(l.amount / max) * 100}%` }} />
              </div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}

function AgingCard({ title, href, aging, ccy }: { title: string; href: string; aging: Aging | null; ccy: string }) {
  const max = aging ? Math.max(...Object.values(aging.buckets), 1) : 1;
  return (
    <Card padding="none">
      <CardHeader title={title} href={href} linkLabel="Aging report" />
      <div className="p-5 space-y-3">
        {!aging ? BUCKETS.map((b) => <div key={b.key} className="h-6 bg-stone-800 animate-pulse rounded" />) : BUCKETS.map((b) => (
          <div key={b.key} className="flex items-center gap-3">
            <div className="w-24 text-xs text-stone-400 shrink-0">{b.label}</div>
            <div className="flex-1 h-6 bg-stone-800/60 rounded overflow-hidden">
              <div className={`h-full ${b.color} rounded`} style={{ width: `${((aging.buckets[b.key] ?? 0) / max) * 100}%` }} />
            </div>
            <div className="w-28 text-right text-sm font-semibold text-white tabular-nums shrink-0">{fmt.money(aging.buckets[b.key] ?? 0, ccy)}</div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function AccountingDashboardPage() {
  const [dash, setDash] = useState<Dash | null>(null);
  const [ov, setOv] = useState<Overview | null>(null);
  const [arAging, setArAging] = useState<Aging | null>(null);
  const [apAging, setApAging] = useState<Aging | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setIsLoading(true);
    setError(null);
    try {
      const [dRes, ovRes, arRes, apRes] = await Promise.all([
        fetch(`/api/accounting/dashboard?today=${localToday()}`),
        fetch("/api/reports/executive-overview"),
        fetch("/api/accounting/aging?side=receivable"),
        fetch("/api/accounting/aging?side=payable"),
      ]);
      if (!dRes.ok) throw new Error(`Server error ${dRes.status}`);
      setDash(await dRes.json());
      if (ovRes.ok) setOv(await ovRes.json());
      if (arRes.ok) setArAging(await arRes.json());
      if (apRes.ok) setApAging(await apRes.json());
    } catch (e: any) {
      setError(e.message || "Failed to load dashboard");
    } finally {
      setIsLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  const ccy = dash?.currency ?? ov?.currency ?? "EUR";
  const ledgerHeld = dash?.ledgerHeld ?? true;
  const booksOk = ov ? ov.ledgerIntegrity.trialBalanceOk && ov.ledgerIntegrity.balanceSheetOk : true;
  const today = dash?.today ?? localToday();

  // A control account disagreeing with its subledger is an exception, so it joins Needs attention.
  const variance = (side: Overview["ar"]) =>
    side.glBalance != null && (side.currency ?? ccy) === ccy ? Math.round((side.total - side.glBalance) * 100) / 100 : 0;
  const attention: AttentionItem[] = [...(dash?.attention ?? [])];
  if (ov && ledgerHeld) {
    const arV = variance(ov.ar);
    const apV = variance(ov.ap);
    if (Math.abs(arV) > 0.5) attention.push({ key: "ar-var", label: "Receivables don't match the ledger", detail: "A/R control account differs from open invoices", href: "/accounting/reconcile", count: 1, amount: arV });
    if (Math.abs(apV) > 0.5) attention.push({ key: "ap-var", label: "Payables don't match the ledger", detail: "A/P control account differs from open bills", href: "/accounting/reconcile", count: 1, amount: apV });
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white tracking-tight">Accounting Dashboard</h1>
          <p className="text-sm text-stone-400 mt-0.5">What needs doing, where the cash is, and how the month is going</p>
        </div>
        <div className="text-xs text-stone-400">As at {fmt.date(today)}</div>
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-400 text-sm">
          <AlertCircle size={16} /> {error}
          <button onClick={load} className="ml-auto underline hover:no-underline text-rose-300">Retry</button>
        </div>
      )}

      {!isLoading && ov && ledgerHeld && !booksOk && (
        <div className="mb-4 flex items-center gap-2.5 px-4 py-3 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-400">
          <AlertTriangle size={16} />
          <span className="text-sm font-medium">The books don&apos;t balance: Trial Balance or Balance Sheet is out</span>
          <Link href="/accounting/reports/trial-balance" className="ml-auto text-xs underline hover:no-underline">Investigate →</Link>
        </div>
      )}
      {!isLoading && ov && ledgerHeld && booksOk && (
        <div className="mb-4 flex items-center gap-2 text-xs text-emerald-400">
          <ShieldCheck size={14} /> Books balance: Trial Balance and Balance Sheet both check out
        </div>
      )}

      {/* Row 1 — do I need to act today? */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
        <AttentionCard items={attention} loading={isLoading} ccy={ccy} />
        <PeriodCard period={dash?.period ?? null} loading={isLoading} />
      </div>

      {/* Row 2 — how much cash, and where is it going? */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
        <CashPositionCard banks={dash?.banks ?? []} loading={isLoading} ledgerHeld={ledgerHeld} />
        <CashFlowCard cashIn={dash?.cashIn ?? []} cashOut={dash?.cashOut ?? []} loading={isLoading} />
      </div>

      {/* Row 3 — how are we performing? */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-3">
        <PerformanceCard pl={dash?.pl ?? null} loading={isLoading} ccy={ccy} />
        <TopExpensesCard pl={dash?.pl ?? null} loading={isLoading} ccy={ccy} />
      </div>

      {/* Aging stays until row 4 (DSO / DPO, tax due) replaces it */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
        <AgingCard title="Receivables aging" href="/accounting/reports/aged-receivables" aging={arAging} ccy={ccy} />
        <AgingCard title="Payables aging" href="/accounting/reports/aged-payables" aging={apAging} ccy={ccy} />
      </div>

      <Card padding="md">
        <div className={`${LABEL} mb-4`}>Reports &amp; tools</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {QUICK_LINKS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href} className="flex items-center gap-2 px-3 py-2.5 rounded-md border border-stone-800 hover:border-stone-600 hover:bg-stone-800/50 transition-colors">
              <Icon size={14} className="text-stone-400 shrink-0" />
              <span className="text-[13px] text-stone-200 truncate">{label}</span>
            </Link>
          ))}
        </div>
      </Card>
    </div>
  );
}
