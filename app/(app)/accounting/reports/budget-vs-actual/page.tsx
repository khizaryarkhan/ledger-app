"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Target } from "lucide-react";
import { ReportShell } from "@/components/ui";
import { SelectField } from "@/components/form-kit";
import { listTable, listRow, listCell, listNumCell } from "@/components/list-view";
import { fmt } from "@/lib/format";
import { MONTH_LABELS, type Variance, type VarianceRow } from "@/lib/accounting/budgets";

type Budget = { id: string; name: string; year: number; status: string };
type Report = {
  budget: Budget; months: { month: number; label: string }[]; rows: VarianceRow[]; profit: Variance;
  meta: { entity: string; currency: string };
};

const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const pad2 = (n: number) => String(n).padStart(2, "0");
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// Colour is for the exception only: an unfavourable variance. Everything else is quiet.
const varCls = (v: Variance) => (v.favourable === false ? "text-rose-400" : "text-stone-300");
const signed = (n: number) => (n > 0 ? "+" : "") + fmt.num2(n);

export default function BudgetVsActualPage() {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [budgetId, setBudgetId] = useState("");
  const [fromM, setFromM] = useState(1);
  const [toM, setToM] = useState(Number(new Date().toISOString().slice(5, 7)));
  const [byMonth, setByMonth] = useState(false);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/accounting/budgets").then((r) => r.json()).then((d: Budget[]) => {
      const list = Array.isArray(d) ? d : [];
      setBudgets(list);
      const first = list.find((b) => b.status === "active") ?? list[0];
      if (first) setBudgetId(first.id);
    }).catch(() => setErr("Could not load budgets"));
  }, []);

  const year = budgets.find((b) => b.id === budgetId)?.year;

  const run = useCallback(async () => {
    if (!budgetId || !year) return;
    setLoading(true); setErr(null);
    try {
      const lo = Math.min(fromM, toM), hi = Math.max(fromM, toM);
      const qs = new URLSearchParams({ budgetId, from: `${year}-${pad2(lo)}-01`, to: `${year}-${pad2(hi)}-${pad2(lastDay(year, hi))}` });
      const r = await fetch(`/api/accounting/budget-vs-actual?${qs}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d?.error || "Could not run report");
      setData(d);
    } catch (e: any) { setErr(e?.message || "Could not run report"); setData(null); } finally { setLoading(false); }
  }, [budgetId, year, fromM, toM]);
  useEffect(() => { run(); }, [run]);

  const income = data?.rows.filter((r) => r.kind === "income") ?? [];
  const expense = data?.rows.filter((r) => r.kind === "expense") ?? [];
  const cols = data?.months ?? [];

  function Row({ r }: { r: VarianceRow }) {
    return (
      <tr className={listRow()}>
        <td className={`${listCell} text-stone-200`}>{r.code ? <span className="text-stone-500 mr-1.5">{r.code}</span> : null}{r.name}</td>
        <Cells v={r.total} />
        {byMonth && cols.map((m) => <td key={m.month} className={`${listNumCell} border-l border-stone-800 ${varCls(r.months[m.month])}`}>{r.months[m.month].variance === 0 ? "—" : signed(r.months[m.month].variance)}</td>)}
      </tr>
    );
  }
  function Cells({ v }: { v: Variance }) {
    return (<>
      <td className={listNumCell}>{fmt.num2(v.budget)}</td>
      <td className={listNumCell}>{fmt.num2(v.actual)}</td>
      <td className={`${listNumCell} ${varCls(v)}`}>{signed(v.variance)}</td>
      <td className={`${listNumCell} ${varCls(v)}`}>{v.pct == null ? "—" : `${v.pct.toFixed(1)}%`}</td>
    </>);
  }
  function Group({ title, rows }: { title: string; rows: VarianceRow[] }) {
    if (!rows.length) return null;
    const sum = rows.reduce((s, r) => ({ b: s.b + r.total.budget, a: s.a + r.total.actual }), { b: 0, a: 0 });
    const kind = rows[0].kind;
    const t: Variance = {
      budget: sum.b, actual: sum.a, variance: Math.round((sum.a - sum.b) * 100) / 100,
      pct: sum.b === 0 ? null : Math.round(((sum.a - sum.b) / Math.abs(sum.b)) * 10000) / 100,
      favourable: sum.a === sum.b ? true : kind === "income" ? sum.a > sum.b : sum.a < sum.b,
    };
    return (<>
      <tr><td colSpan={5 + (byMonth ? cols.length : 0)} className="px-2 pt-4 pb-1 text-[11px] uppercase tracking-wider text-stone-500">{title}</td></tr>
      {rows.map((r) => <Row key={r.accountId} r={r} />)}
      <tr className="border-t border-stone-700 font-semibold text-stone-100"><td className={listCell}>Total {title.toLowerCase()}</td><Cells v={t} />{byMonth && cols.map((m) => <td key={m.month} className="border-l border-stone-800" />)}</tr>
    </>);
  }

  return (
    <ReportShell title="Budget vs Actual" icon={Target} onRefresh={run} loading={loading}
      sub={`${data?.meta.entity ?? ""} — budget against the posted ledger, by account. Variance is actual minus budget.`}>
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">Budget</label>
          <SelectField value={budgetId} onChange={(e) => setBudgetId(e.target.value)} className="h-8 min-w-[220px] text-[12px]">
            {budgets.length === 0 && <option value="">No budgets</option>}
            {budgets.map((b) => <option key={b.id} value={b.id}>{b.name} ({b.year})</option>)}
          </SelectField></div>
        <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">From</label>
          <SelectField value={String(fromM)} onChange={(e) => setFromM(Number(e.target.value))} className="h-8 w-28 text-[12px]">
            {MONTHS.map((m) => <option key={m} value={m}>{MONTH_LABELS[m - 1]}</option>)}
          </SelectField></div>
        <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">To</label>
          <SelectField value={String(toM)} onChange={(e) => setToM(Number(e.target.value))} className="h-8 w-28 text-[12px]">
            {MONTHS.map((m) => <option key={m} value={m}>{MONTH_LABELS[m - 1]}</option>)}
          </SelectField></div>
        <button onClick={() => setByMonth((v) => !v)}
          className={`h-8 px-3 text-xs rounded-md ring-1 ${byMonth ? "ring-stone-600 bg-stone-700 text-stone-100" : "ring-stone-700 bg-stone-800 text-stone-400 hover:text-stone-200"}`}>
          Variance by month
        </button>
      </div>

      {err && <p className="text-sm text-rose-400 mb-3">{err}</p>}
      {budgets.length === 0 && !err ? (
        <div className="rounded-xl bg-stone-900 border border-stone-800 p-8 text-center text-sm text-stone-500">
          No budgets yet. <Link href="/accounting/budgets" className="text-stone-300 underline">Create one</Link> to compare against actuals.
        </div>
      ) : data && data.rows.length === 0 ? (
        <div className="rounded-xl bg-stone-900 border border-stone-800 p-8 text-center text-sm text-stone-500">Nothing budgeted or posted for this period.</div>
      ) : data && (
        <div className="overflow-x-auto">
          <table className={`${listTable} min-w-[760px]`}>
            <thead><tr className="text-[11px] font-medium text-stone-500 border-b border-stone-800">
              <th className="text-left px-2 py-2">Account</th>
              <th className="text-right px-2 py-2">Budget</th><th className="text-right px-2 py-2">Actual</th>
              <th className="text-right px-2 py-2">Variance</th><th className="text-right px-2 py-2">Var %</th>
              {byMonth && cols.map((m) => <th key={m.month} className="text-right px-2 py-2 border-l border-stone-800">{m.label}</th>)}
            </tr></thead>
            <tbody>
              <Group title="Income" rows={income} />
              <Group title="Expenses" rows={expense} />
              <tr className="border-t-2 border-stone-600 font-semibold text-stone-100">
                <td className={`${listCell} pt-3`}>Profit</td><Cells v={data.profit} />
                {byMonth && cols.map((m) => <td key={m.month} className="border-l border-stone-800" />)}
              </tr>
            </tbody>
          </table>
          <p className="text-[11px] text-stone-500 mt-3">Currency: {data.meta.currency}. Red marks an unfavourable variance — income below budget or expenses above it.</p>
        </div>
      )}
    </ReportShell>
  );
}
