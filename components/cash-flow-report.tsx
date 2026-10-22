"use client";

/** Cash Flow statement (indirect method). */

import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import { controlCompact } from "@/components/form-kit";
import { ReportShell } from "@/components/ui";
import { localToday } from "@/lib/format";

const money = (n: number) => { const v = Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return n < 0 ? `(${v})` : v; };

export function CashFlowReport() {
  const y = new Date().getFullYear();
  const [from, setFrom] = useState(`${y}-01-01`);
  const [to, setTo] = useState(localToday());
  const [d, setD] = useState<any>(null);
  async function load() { setD(await fetch(`/api/accounting/cash-flow?from=${from}&to=${to}`).then(r => r.json()).catch(() => null)); }
  useEffect(() => { load(); }, [from, to]);

  const Section = ({ title, lines, total }: { title: string; lines: any[]; total: number }) => (
    <>
      <tr className="bg-stone-950/40"><td className="px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-stone-400" colSpan={2}>{title}</td></tr>
      {lines.map((l, i) => (<tr key={i} className="border-b border-stone-800/40"><td className="px-4 py-1.5 pl-8 text-stone-300">{l.name}</td><td className="px-4 py-1.5 text-right tabular-nums text-stone-300">{money(l.amount)}</td></tr>))}
      <tr className="border-b border-stone-800"><td className="px-4 py-1.5 font-medium text-stone-200">Net cash from {title.toLowerCase()}</td><td className="px-4 py-1.5 text-right tabular-nums font-medium text-stone-100">{money(total)}</td></tr>
    </>
  );

  return (
    <ReportShell title="Cash Flow Statement" sub="Indirect method — net income adjusted for the period's changes in working capital, investing and financing." icon={TrendingUp} onRefresh={load} loading={d === null}>
      <div className="flex items-center gap-2 mb-4 text-[12px] text-stone-400">From <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={controlCompact} /> to <input type="date" value={to} onChange={e => setTo(e.target.value)} className={controlCompact} /></div>

      {d === null ? <p className="text-[13px] text-stone-500">Loading…</p> : (
        <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-hidden max-w-3xl">
          <table className="w-full text-[13px]">
            <tbody>
              <tr className="border-b border-stone-800"><td className="px-4 py-2 font-medium text-stone-200">Net income</td><td className="px-4 py-2 text-right tabular-nums text-stone-100">{money(d.netIncome)}</td></tr>
              <Section title="Operating activities" lines={d.operating} total={d.operatingTotal} />
              <Section title="Investing activities" lines={d.investing} total={d.investingTotal} />
              <Section title="Financing activities" lines={d.financing} total={d.financingTotal} />
              <tr className="border-t border-stone-700 bg-stone-950/60 font-semibold"><td className="px-4 py-2.5 text-stone-100">Net change in cash</td><td className="px-4 py-2.5 text-right tabular-nums text-stone-100">{money(d.netChange)}</td></tr>
              <tr><td className="px-4 py-1.5 text-stone-400">Cash at start</td><td className="px-4 py-1.5 text-right tabular-nums text-stone-400">{money(d.openingCash)}</td></tr>
              <tr className="border-t border-stone-800"><td className="px-4 py-2 font-semibold text-stone-100">Cash at end</td><td className="px-4 py-2 text-right tabular-nums font-semibold text-stone-100">{money(d.closingCash)}</td></tr>
            </tbody>
          </table>
          {!d.reconciles && <p className="text-[11px] text-amber-400 px-4 py-2 border-t border-stone-800">Note: computed change doesn't tie exactly to the bank movement — there may be inter-account cash transfers or an opening imbalance to review.</p>}
        </div>
      )}
    </ReportShell>
  );
}
