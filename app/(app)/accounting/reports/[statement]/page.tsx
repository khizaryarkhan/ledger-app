"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { FileText, Loader2, ScrollText, Scale, TrendingUp, Landmark } from "lucide-react";
import { ReportShell } from "@/components/ui";
import { controlCompact, SelectField } from "@/components/form-kit";
import {
  RANGE_PRESETS, AS_OF_PRESETS, COLUMN_BUCKETS, COMPARE_MODES,
  rangeForPreset, asOfForPreset, type RangePresetKey, type AsOfPresetKey, type BucketSize, type CompareMode,
} from "@/lib/accounting/report-periods";

type ColumnMode = BucketSize | "class" | "location";

const TITLES: Record<string, { title: string; formal: string; sub: string; icon: any }> = {
  "trial-balance":  { title: "Trial Balance",   formal: "Trial Balance",                    sub: "Every account's balance — total debits must equal total credits.", icon: ScrollText },
  "profit-loss":    { title: "Profit & Loss",   formal: "Statement of Profit or Loss",      sub: "Income and expenses for a chosen period.", icon: FileText },
  "comprehensive-income": { title: "Comprehensive Income", formal: "Statement of Comprehensive Income", sub: "Net profit plus Other Comprehensive Income for a chosen period.", icon: TrendingUp },
  "changes-in-equity":    { title: "Changes in Equity",    formal: "Statement of Changes in Equity",    sub: "How each equity category moved over a chosen period.", icon: Landmark },
  "balance-sheet":  { title: "Balance Sheet",   formal: "Statement of Financial Position",  sub: "Assets, equity and liabilities at a point in time.", icon: Scale },
};
// All three read a [from, to] period, same as Profit & Loss.
const PERIOD_STATEMENTS = new Set(["profit-loss", "comprehensive-income", "changes-in-equity"]);
// "Display columns by" / "Compare to" are wired for these two only in this
// pass — Comprehensive Income/Changes in Equity/Trial Balance keep the period
// preset but not the column engine (see CLAUDE.md for why).
const COLUMN_ENGINE_STATEMENTS = new Set(["profit-loss", "balance-sheet"]);

const fmtMoney = (n: number) => {
  const v = Math.abs(Math.round(n)).toLocaleString();
  return n < 0 ? `(${v})` : v;
};

// "20 August 2026"
const fmtDate = (s?: string | null) => {
  if (!s) return "";
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric" });
};
const fmtDateShort = (s?: string | null) => {
  if (!s) return "";
  const d = new Date(s + "T00:00:00");
  return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};
const today = () => new Date().toISOString().slice(0, 10);

export default function FinancialStatementPage() {
  const statement = String(useParams().statement || "trial-balance");
  const meta = TITLES[statement] ?? TITLES["trial-balance"];
  const isPL = statement === "profit-loss";
  const isPeriod = PERIOD_STATEMENTS.has(statement);
  const hasColumnEngine = COLUMN_ENGINE_STATEMENTS.has(statement);

  const [fym, setFym] = useState(1); // org's fiscal-year-start month; refined once meta loads
  const [rangePreset, setRangePreset] = useState<RangePresetKey>("this_fy_to_date");
  const [asOfPreset, setAsOfPreset] = useState<AsOfPresetKey>("today");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [asOf, setAsOf] = useState<string>(today);
  const [from, setFrom] = useState<string>(() => rangeForPreset("this_fy_to_date", today(), 1)!.from);
  const [to, setTo] = useState<string>(today);
  const [columns, setColumns] = useState<ColumnMode>("total");
  const [compareTo, setCompareTo] = useState<CompareMode>("none");
  const [hasClasses, setHasClasses] = useState(false);
  const [hasLocations, setHasLocations] = useState(false);

  // Only offer "Display columns by Class/Location" when the org actually has
  // some — same "org has at least one" gate new-document-form.tsx already
  // uses for showing the Class/Location columns on transaction lines.
  useEffect(() => {
    fetch("/api/accounting/dimensions").then((r) => r.json()).then((rows: any[]) => {
      if (!Array.isArray(rows)) return;
      setHasClasses(rows.some((d) => d.dimensionType === "Class" && d.status === "Active"));
      setHasLocations(rows.some((d) => d.dimensionType === "Location" && d.status === "Active"));
    }).catch(() => {});
  }, []);

  // Re-derive a non-custom preset's dates once the org's real fiscal year
  // start month is known (defaults to 1 until then) — a "This fiscal year to
  // date" picked before that arrives must not silently stay calendar-year.
  useEffect(() => {
    if (isPeriod && rangePreset !== "custom") { const r = rangeForPreset(rangePreset, today(), fym); if (r) { setFrom(r.from); setTo(r.to); } }
    if (!isPeriod && asOfPreset !== "custom") { const a = asOfForPreset(asOfPreset, today(), fym); if (a) setAsOf(a.asOf); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fym]);

  function onRangePreset(p: RangePresetKey) {
    setRangePreset(p);
    const r = rangeForPreset(p, today(), fym);
    if (r) { setFrom(r.from); setTo(r.to); }
  }
  function onAsOfPreset(p: AsOfPresetKey) {
    setAsOfPreset(p);
    const a = asOfForPreset(p, today(), fym);
    if (a) setAsOf(a.asOf);
  }

  function load() {
    setData(null); setError(null);
    const qs = isPeriod
      ? `statement=${statement}&from=${from}&to=${to}&columns=${columns}&compareTo=${compareTo}`
      : `statement=${statement}&asOf=${asOf}&columns=${columns}&compareTo=${compareTo}`;
    fetch(`/api/financials?${qs}`)
      .then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`); return d; })
      .then((d) => { setData(d); if (typeof d?.meta?.fiscalYearStartMonth === "number") setFym(d.meta.fiscalYearStartMonth); })
      .catch((e) => setError(e.message));
  }
  useEffect(load, [statement, asOf, from, to, isPeriod, columns, compareTo]);

  const Icon = meta.icon;
  const periodLine = isPeriod ? `For the period ${fmtDate(from)} to ${fmtDate(to)}` : `As at ${fmtDate(asOf)}`;
  const isMulti = hasColumnEngine && data?.table && data.table.columns.length > 1;

  // Every account line drills into the General Ledger for that account over
  // the report's window — "click the number to see the transactions inside
  // it". In multi-column mode a cell drills into ITS OWN column's window.
  const drill = (accountId: string | null, col?: { from?: string; to?: string; asOf?: string }): string | null => {
    if (!accountId) return null;
    const p = new URLSearchParams({ accountId });
    if (col?.from || col?.to) { if (col.from) p.set("from", col.from); if (col.to) p.set("to", col.to); }
    else if (col?.asOf) p.set("to", col.asOf);
    else if (isPeriod) { p.set("from", from); p.set("to", to); }
    else p.set("to", asOf);
    return `/accounting/reports/general-ledger?${p.toString()}`;
  };

  return (
    <ReportShell title={meta.title} sub={meta.sub} icon={Icon} onRefresh={load} loading={!data && !error}>
      <div className="flex items-end gap-3 mb-5 flex-wrap">
        {isPeriod ? (
          <>
            <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">Report period</label>
              <SelectField value={rangePreset} onChange={(e) => onRangePreset(e.target.value as RangePresetKey)} className="h-8 min-w-[190px] text-[12px]">
                {RANGE_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </SelectField>
            </div>
            {rangePreset === "custom" && (
              <>
                <label className="flex items-center gap-2 text-[12px] text-stone-400">From
                  <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} className={controlCompact} />
                </label>
                <label className="flex items-center gap-2 text-[12px] text-stone-400">To
                  <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} className={controlCompact} />
                </label>
              </>
            )}
            {rangePreset !== "custom" && <div className="text-[12px] text-stone-400 pb-1.5">{fmtDateShort(from)} – {fmtDateShort(to)}</div>}
          </>
        ) : (
          <>
            <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">As at</label>
              <SelectField value={asOfPreset} onChange={(e) => onAsOfPreset(e.target.value as AsOfPresetKey)} className="h-8 min-w-[190px] text-[12px]">
                {AS_OF_PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </SelectField>
            </div>
            {asOfPreset === "custom" ? (
              <label className="flex items-center gap-2 text-[12px] text-stone-400">Date
                <input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className={controlCompact} />
              </label>
            ) : <div className="text-[12px] text-stone-400 pb-1.5">{fmtDateShort(asOf)}</div>}
          </>
        )}
        {hasColumnEngine && (
          <>
            <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">Display columns by</label>
              <SelectField value={columns} onChange={(e) => setColumns(e.target.value as ColumnMode)} className="h-8 min-w-[130px] text-[12px]">
                {COLUMN_BUCKETS.map((b) => <option key={b.value} value={b.value}>{b.label}</option>)}
                {hasClasses && <option value="class">Class</option>}
                {hasLocations && <option value="location">Location</option>}
              </SelectField>
            </div>
            {/* Compare-to layers onto the time-bucket engine only — combining it
                with a dimension breakdown (every class, AND a prior period, in
                one table) isn't built in this pass, so the control is hidden
                rather than offered and silently ignored. */}
            {columns !== "class" && columns !== "location" && (
              <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">Compare to</label>
                <SelectField value={compareTo} onChange={(e) => setCompareTo(e.target.value as CompareMode)} className="h-8 min-w-[150px] text-[12px]">
                  {COMPARE_MODES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </SelectField>
              </div>
            )}
          </>
        )}
      </div>

      {error && <div className="mb-4 px-4 py-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-sm">{error}</div>}
      {!data && !error && <div className="text-sm text-stone-500 flex items-center gap-2"><Loader2 size={15} className="animate-spin" /> Building statement…</div>}

      {data && isMulti && isPL && <MultiProfitLoss table={{ ...data.table, meta: data.meta }} drill={drill} />}
      {data && isMulti && statement === "balance-sheet" && <MultiBalanceSheet table={{ ...data.table, meta: data.meta }} drill={drill} />}

      {data && !isMulti && (
        <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden max-w-3xl">
          {/* Statement header — the way a CA presents it */}
          <div className="text-center px-4 py-4 border-b border-stone-800">
            <div className="text-[15px] font-bold text-stone-100">{data.meta?.entity ?? ""}</div>
            <div className="text-[13px] font-semibold text-stone-300 mt-0.5">{meta.formal}</div>
            <div className="text-[12px] text-stone-400 mt-0.5">{periodLine}</div>
            <div className="text-[11px] text-stone-500 mt-0.5">All amounts in {data.meta?.currency ?? ""}{data.meta?.consolidated ? " · consolidated across all branches" : ""}</div>
          </div>
          {statement === "trial-balance" && <TrialBalance data={data} drill={drill} />}
          {isPL && <ProfitLoss data={data} drill={drill} />}
          {statement === "comprehensive-income" && <ComprehensiveIncome data={data} drill={drill} />}
          {statement === "changes-in-equity" && <ChangesInEquity data={data} />}
          {statement === "balance-sheet" && <BalanceSheet data={data} drill={drill} />}
        </div>
      )}
    </ReportShell>
  );
}

function empty() { return <div className="text-sm text-stone-500 py-10 text-center">No posted ledger entries in this period yet. Post a manual journal or a transaction and it appears here.</div>; }

const rowCls = "flex items-center justify-between py-1.5 text-[13px]";
const money = "tabular-nums text-stone-200";
type Drill = (accountId: string | null, col?: { from?: string; to?: string; asOf?: string }) => string | null;

function TrialBalance({ data, drill }: { data: any; drill: Drill }) {
  if (!data.rows.length) return empty();
  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2 border-b border-stone-800 text-[11px] uppercase tracking-wider text-stone-500">
        <span>Account</span><span className="flex gap-8"><span className="w-24 text-right">Debit</span><span className="w-24 text-right">Credit</span></span>
      </div>
      {data.rows.map((r: any, i: number) => {
        const href = drill(r.accountId);
        const inner = (
          <>
            <span className="text-stone-200 group-hover:text-white">{r.code ? <span className="text-stone-600 font-mono mr-2">{r.code}</span> : null}{r.name}</span>
            <span className="flex gap-8"><span className={`w-24 text-right ${money} ${href ? "text-teal-400 group-hover:underline" : ""}`}>{r.debit ? fmtMoney(r.debit) : ""}</span><span className={`w-24 text-right ${money} ${href ? "text-teal-400 group-hover:underline" : ""}`}>{r.credit ? fmtMoney(r.credit) : ""}</span></span>
          </>
        );
        return href
          ? <Link key={i} href={href} className="group flex items-center justify-between px-4 py-1.5 text-[13px] border-b border-stone-800/50 hover:bg-stone-800/40">{inner}</Link>
          : <div key={i} className="flex items-center justify-between px-4 py-1.5 text-[13px] border-b border-stone-800/50">{inner}</div>;
      })}
      <div className="flex items-center justify-between px-4 py-2.5 font-semibold text-stone-100 border-t border-stone-700">
        <span>Total</span><span className="flex gap-8"><span className="w-24 text-right tabular-nums">{fmtMoney(data.totalDebit)}</span><span className="w-24 text-right tabular-nums">{fmtMoney(data.totalCredit)}</span></span>
      </div>
      {!data.balanced && <div className="px-4 py-2 text-[12px] text-rose-400 border-t border-stone-800">⚠ Out of balance by {fmtMoney(data.totalDebit - data.totalCredit)} — a ledger integrity issue.</div>}
    </div>
  );
}

function Section({ title, lines, total, strong, drill }: { title: string; lines: any[]; total: number; strong?: boolean; drill?: Drill }) {
  return (
    <div className="mb-1">
      <div className="text-[11px] uppercase tracking-wider text-stone-500 px-4 pt-3 pb-1">{title}</div>
      {lines.length === 0 ? <div className="px-4 py-1 text-[12px] text-stone-600">—</div> :
        lines.map((l: any, i: number) => {
          const href = drill?.(l.accountId);
          return (
            <div key={i} className={`${rowCls} px-4 ${href ? "hover:bg-stone-800/40" : ""}`}>
              <span className="text-stone-300">{l.name}</span>
              {href
                ? <Link href={href} className="tabular-nums text-teal-400 hover:underline">{fmtMoney(l.amount)}</Link>
                : <span className={money}>{fmtMoney(l.amount)}</span>}
            </div>
          );
        })}
      <div className={`${rowCls} px-4 border-t border-stone-800/70 ${strong ? "font-semibold text-stone-100" : "text-stone-200"}`}>
        <span>Total {title}</span><span className="tabular-nums">{fmtMoney(total)}</span>
      </div>
    </div>
  );
}

function Subtotal({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between px-4 py-2 my-1 bg-stone-800/40 font-semibold text-stone-100 text-[13px]">
      <span>{label}</span><span className="tabular-nums">{fmtMoney(value)}</span>
    </div>
  );
}

function ProfitLoss({ data, drill }: { data: any; drill: Drill }) {
  const rev = data.sections[0], cos = data.sections[1];
  const hasAny = rev.lines.length || cos.lines.length || data.otherIncome.lines.length || data.operatingExpenses.lines.length;
  if (!hasAny) return empty();
  return (
    <div className="pb-2">
      <Section title="Revenue" lines={rev.lines} total={rev.total} drill={drill} />
      <Section title="Cost of Sales" lines={cos.lines} total={cos.total} drill={drill} />
      <Subtotal label="Gross Profit" value={data.grossProfit} />
      <Section title="Other Income" lines={data.otherIncome.lines} total={data.otherIncome.total} drill={drill} />
      <Section title="Operating Expenses" lines={data.operatingExpenses.lines} total={data.operatingExpenses.total} drill={drill} />
      <Section title="Finance Costs" lines={data.financeCosts.lines} total={data.financeCosts.total} drill={drill} />
      <Subtotal label="Profit Before Tax" value={data.profitBeforeTax} />
      <Section title="Taxation" lines={data.taxation.lines} total={data.taxation.total} drill={drill} />
      <div className="flex items-center justify-between px-4 py-3 mt-1 border-t-2 border-teal-800 font-bold text-stone-100 text-[14px]">
        <span>Net Profit for the Period</span><span className="tabular-nums text-teal-300">{fmtMoney(data.netProfit)}</span>
      </div>
    </div>
  );
}

function BalanceSheet({ data, drill }: { data: any; drill: Drill }) {
  // Provisions is optional in the response (balanceSheet() always returns it,
  // but an older cached response shape shouldn't crash the page) — IAS 37
  // wants it shown separately from ordinary liabilities, never folded back
  // into them.
  const hasProvisions = data.provisions && (data.provisions.nonCurrent.length || data.provisions.current.length);
  return (
    <div className="pb-2">
      <div className="px-4 pt-3 pb-1 text-[12px] font-semibold text-teal-300 uppercase tracking-wider">Assets</div>
      <Section title="Non-current Assets" lines={data.assets.nonCurrent} total={data.assets.nonCurrent.reduce((s: number, l: any) => s + l.amount, 0)} drill={drill} />
      <Section title="Current Assets" lines={data.assets.current} total={data.assets.current.reduce((s: number, l: any) => s + l.amount, 0)} drill={drill} />
      <Subtotal label="Total Assets" value={data.assets.total} />

      <div className="px-4 pt-3 pb-1 text-[12px] font-semibold text-teal-300 uppercase tracking-wider">Equity &amp; Liabilities</div>
      <Section title="Equity" lines={data.equity.lines} total={data.equity.total} strong drill={drill} />
      <Section title="Non-current Liabilities" lines={data.liabilities.nonCurrent} total={data.liabilities.nonCurrent.reduce((s: number, l: any) => s + l.amount, 0)} drill={drill} />
      <Section title="Current Liabilities" lines={data.liabilities.current} total={data.liabilities.current.reduce((s: number, l: any) => s + l.amount, 0)} drill={drill} />
      {hasProvisions && (
        <>
          <Section title="Non-current Provisions" lines={data.provisions.nonCurrent} total={data.provisions.nonCurrent.reduce((s: number, l: any) => s + l.amount, 0)} drill={drill} />
          <Section title="Current Provisions" lines={data.provisions.current} total={data.provisions.current.reduce((s: number, l: any) => s + l.amount, 0)} drill={drill} />
        </>
      )}
      <Subtotal label="Total Equity & Liabilities" value={data.totalEquityAndLiabilities} />

      {!data.balanced && <div className="px-4 py-2 text-[12px] text-rose-400 border-t border-stone-800">⚠ Does not balance — assets ≠ equity + liabilities.</div>}
    </div>
  );
}

function ComprehensiveIncome({ data, drill }: { data: any; drill: Drill }) {
  const hasAny = data.sections?.[0]?.lines.length || data.sections?.[1]?.lines.length || data.otherIncome.lines.length || data.operatingExpenses.lines.length || data.oci.lines.length;
  if (!hasAny) return empty();
  return (
    <div className="pb-2">
      <ProfitLoss data={data} drill={drill} />
      <div className="px-4 pt-3 pb-1 text-[12px] font-semibold text-teal-300 uppercase tracking-wider">Other Comprehensive Income</div>
      <Section title="Items that will not be reclassified to profit or loss" lines={data.oci.lines} total={data.oci.total} drill={drill} />
      <div className="flex items-center justify-between px-4 py-3 mt-1 border-t-2 border-teal-800 font-bold text-stone-100 text-[14px]">
        <span>Total Comprehensive Income for the Period</span><span className="tabular-nums text-teal-300">{fmtMoney(data.totalComprehensiveIncome)}</span>
      </div>
    </div>
  );
}

function ChangesInEquity({ data }: { data: any }) {
  if (!data.rows?.length) return empty();
  return (
    <div className="pb-2">
      <div className="flex items-center justify-between px-4 py-2 border-b border-stone-800 text-[11px] uppercase tracking-wider text-stone-500">
        <span>Category</span><span className="flex gap-8"><span className="w-28 text-right">Opening</span><span className="w-28 text-right">Movement</span><span className="w-28 text-right">Closing</span></span>
      </div>
      {data.rows.map((r: any) => (
        <div key={r.category} className={rowCls + " px-4 border-b border-stone-800/50"}>
          <span className="text-stone-300">{r.label}</span>
          <span className="flex gap-8">
            <span className={`w-28 text-right ${money}`}>{fmtMoney(r.opening)}</span>
            <span className={`w-28 text-right ${money}`}>{fmtMoney(r.movement)}</span>
            <span className={`w-28 text-right ${money}`}>{fmtMoney(r.closing)}</span>
          </span>
        </div>
      ))}
      <div className="flex items-center justify-between px-4 py-2.5 font-semibold text-stone-100 border-t border-stone-700">
        <span>Total</span>
        <span className="flex gap-8">
          <span className="w-28 text-right tabular-nums">{fmtMoney(data.totalOpening)}</span>
          <span className="w-28 text-right tabular-nums">{fmtMoney(data.totalMovement)}</span>
          <span className="w-28 text-right tabular-nums">{fmtMoney(data.totalClosing)}</span>
        </span>
      </div>
    </div>
  );
}

// ── Multi-column tables — "Display columns by" / "Compare to" ──────────────
type MCol = { key: string; label: string; from?: string; to?: string; asOf?: string };
type MRow = { accountId: string | null; name: string; code: string | null; values: number[] };

function ColumnHeader({ columns }: { columns: MCol[] }) {
  return (
    <div className="flex items-center text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-800 py-2 px-4">
      <span className="flex-1 min-w-[200px]">Account</span>
      {columns.map((c) => <span key={c.key} className="w-32 text-right shrink-0">{c.label}</span>)}
    </div>
  );
}

function MRowLine({ row, href }: { row: MRow; href: string | null }) {
  return (
    <div className="flex items-center px-4 py-1.5 text-[13px] border-b border-stone-800/40 hover:bg-stone-800/30">
      <span className="flex-1 min-w-[200px] truncate text-stone-300">{row.name}</span>
      {row.values.map((v, i) => (
        <span key={i} className="w-32 text-right shrink-0 tabular-nums text-stone-200">
          {v === 0 ? "" : (href ? <Link href={href} className="text-teal-400 hover:underline">{fmtMoney(v)}</Link> : fmtMoney(v))}
        </span>
      ))}
    </div>
  );
}

function MSection({ title, rows, totals, drill }: { title: string; rows: MRow[]; totals: number[]; drill: (accountId: string | null) => string | null }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-stone-500 px-4 pt-3 pb-1">{title}</div>
      {rows.length === 0 ? <div className="px-4 py-1 text-[12px] text-stone-600">—</div> : rows.map((r, i) => <MRowLine key={i} row={r} href={drill(r.accountId)} />)}
      <div className="flex items-center px-4 py-1.5 border-t border-stone-800/70 text-[13px] font-semibold text-stone-100">
        <span className="flex-1 min-w-[200px]">Total {title}</span>
        {totals.map((t, i) => <span key={i} className="w-32 text-right shrink-0 tabular-nums">{fmtMoney(t)}</span>)}
      </div>
    </div>
  );
}

function MSubtotal({ label, values, strong }: { label: string; values: number[]; strong?: boolean }) {
  return (
    <div className={`flex items-center px-4 py-2 my-1 ${strong ? "bg-teal-900/20" : "bg-stone-800/40"} font-semibold text-stone-100 text-[13px]`}>
      <span className="flex-1 min-w-[200px]">{label}</span>
      {values.map((v, i) => <span key={i} className={`w-32 text-right shrink-0 tabular-nums ${strong ? "text-teal-300" : ""}`}>{fmtMoney(v)}</span>)}
    </div>
  );
}

function colDrillArg(c: MCol) { return { from: c.from, to: c.to, asOf: c.asOf }; }

function MultiProfitLoss({ table, drill }: { table: any; drill: Drill }) {
  const columns: MCol[] = table.columns;
  // A row's link always drills into the PRIMARY (first) column's window —
  // the header line is one click, not one per cell; a cell showing a
  // comparison period's own figure is still read in context of that column's
  // label right above it.
  const wrap = (accountId: string | null): string | null => drill(accountId, colDrillArg(columns[0]));
  return (
    <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden overflow-x-auto">
      <div className="text-center px-4 py-4 border-b border-stone-800 min-w-max">
        <div className="text-[15px] font-bold text-stone-100">{table.meta?.entity}</div>
        <div className="text-[13px] font-semibold text-stone-300 mt-0.5">Statement of Profit or Loss</div>
      </div>
      <div className="min-w-max">
        <ColumnHeader columns={columns} />
        <MSection title="Revenue" rows={table.revenue.rows} totals={table.revenue.totals} drill={wrap} />
        <MSection title="Cost of Sales" rows={table.costOfSales.rows} totals={table.costOfSales.totals} drill={wrap} />
        <MSubtotal label="Gross Profit" values={table.grossProfit} />
        <MSection title="Other Income" rows={table.otherIncome.rows} totals={table.otherIncome.totals} drill={wrap} />
        <MSection title="Operating Expenses" rows={table.operatingExpenses.rows} totals={table.operatingExpenses.totals} drill={wrap} />
        <MSection title="Finance Costs" rows={table.financeCosts.rows} totals={table.financeCosts.totals} drill={wrap} />
        <MSubtotal label="Profit Before Tax" values={table.profitBeforeTax} />
        <MSection title="Taxation" rows={table.taxation.rows} totals={table.taxation.totals} drill={wrap} />
        <MSubtotal label="Net Profit for the Period" values={table.netProfit} strong />
      </div>
    </div>
  );
}

function MultiBalanceSheet({ table, drill }: { table: any; drill: Drill }) {
  const columns: MCol[] = table.columns;
  const wrap = (accountId: string | null): string | null => drill(accountId, colDrillArg(columns[0]));
  return (
    <div className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden overflow-x-auto">
      <div className="text-center px-4 py-4 border-b border-stone-800 min-w-max">
        <div className="text-[15px] font-bold text-stone-100">{table.meta?.entity}</div>
        <div className="text-[13px] font-semibold text-stone-300 mt-0.5">Statement of Financial Position</div>
      </div>
      <div className="min-w-max">
        <ColumnHeader columns={columns} />
        <div className="px-4 pt-3 pb-1 text-[12px] font-semibold text-teal-300 uppercase tracking-wider">Assets</div>
        <MSection title="Non-current Assets" rows={table.assets.nonCurrent.rows} totals={table.assets.nonCurrent.totals} drill={wrap} />
        <MSection title="Current Assets" rows={table.assets.current.rows} totals={table.assets.current.totals} drill={wrap} />
        <MSubtotal label="Total Assets" values={table.assets.total} />
        <div className="px-4 pt-3 pb-1 text-[12px] font-semibold text-teal-300 uppercase tracking-wider">Equity &amp; Liabilities</div>
        <MSection title="Equity" rows={table.equity.rows} totals={table.equity.totals} drill={wrap} />
        <MSection title="Non-current Liabilities" rows={table.liabilities.nonCurrent.rows} totals={table.liabilities.nonCurrent.totals} drill={wrap} />
        <MSection title="Current Liabilities" rows={table.liabilities.current.rows} totals={table.liabilities.current.totals} drill={wrap} />
        <MSubtotal label="Total Equity & Liabilities" values={table.totalEquityAndLiabilities} strong />
      </div>
    </div>
  );
}
