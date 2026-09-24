"use client";

/**
 * Stock vs GL (R-09). For every account that plays an inventory role: the
 * value of the stock that posts to it against the account's ledger balance,
 * and open job-work value against the Work-in-Progress account. A difference
 * is drift between the stock subledger and the books — the thing that went
 * unseen for weeks before this report existed.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Scale } from "lucide-react";
import { fmt, localToday } from "@/lib/format";
import { ReportShell } from "@/components/ui";
import { control, tableHead, t } from "@/components/form-kit";

const money = fmt.num2;
type Row = { accountId: string; accountName: string; accountCode: string | null; groups: string[]; stockValue: number; glBalance: number; difference: number };
type Wip = { accountId: string; accountName: string; accountCode: string | null; openOrdersValue: number; glBalance: number; difference: number };

const diffCls = (d: number) => Math.abs(d) < 0.005 ? "text-stone-600" : "text-rose-400 font-semibold";

export function StockVsGlReport() {
  const [asAt, setAsAt] = useState(localToday());
  const [data, setData] = useState<{ rows: Row[]; wip: Wip[]; unassignedValue: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setData(null); setErr(null);
    const res = await fetch(`/api/accounting/stock-vs-gl?asAt=${asAt}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(d?.error || "Could not load the report"); setData({ rows: [], wip: [], unassignedValue: 0 }); return; }
    setData(d);
  }
  useEffect(() => { load(); }, [asAt]);

  const tot = (data?.rows ?? []).reduce((s, r) => ({ stock: s.stock + r.stockValue, gl: s.gl + r.glBalance, diff: s.diff + r.difference }), { stock: 0, gl: 0, diff: 0 });

  return (
    <ReportShell title="Stock vs GL" sub="Stock value against the ledger balance of each inventory account, as at a date." icon={Scale} onRefresh={load} loading={data === null}>
      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <label className={`flex items-center gap-2 ${t.secondary}`}>As at
          <input type="date" value={asAt} onChange={e => setAsAt(e.target.value)} className={`${control} !w-44`} />
        </label>
        <Link href="/accounting/posting-groups" className="text-[12px] text-stone-400 hover:text-stone-200">Posting groups →</Link>
      </div>
      {err && <p className="text-[13px] text-rose-400 mb-3">{err}</p>}

      <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-x-auto mb-6">
        <table className="w-full text-[13px] min-w-[680px]">
          <thead><tr className={tableHead}>
            <th className="text-left px-4 py-2.5">Inventory account</th><th className="text-left px-4 py-2.5">Posting groups</th>
            <th className="text-right px-4 py-2.5">Stock value</th><th className="text-right px-4 py-2.5">GL balance</th><th className="text-right px-4 py-2.5">Difference</th>
          </tr></thead>
          <tbody>
            {data === null && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
            {data && data.rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">No inventory accounts are mapped yet.</td></tr>}
            {data?.rows.map(r => (
              <tr key={r.accountId} className="border-b border-stone-800/60">
                <td className="px-4 py-2 text-stone-100 font-medium">{r.accountCode ? <span className="font-mono text-[12px] text-stone-400 mr-2">{r.accountCode}</span> : null}{r.accountName}</td>
                <td className="px-4 py-2 text-stone-400">{r.groups.join(", ") || "—"}</td>
                <td className="px-4 py-2 text-right tabular-nums text-stone-300">{money(r.stockValue)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-stone-300">{money(r.glBalance)}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${diffCls(r.difference)}`}>{money(r.difference)}</td>
              </tr>
            ))}
            {data && data.unassignedValue !== 0 && (
              <tr className="border-b border-stone-800/60">
                <td className="px-4 py-2 text-amber-300" colSpan={2}>Stock whose group has no inventory account mapped</td>
                <td className="px-4 py-2 text-right tabular-nums text-amber-300">{money(data.unassignedValue)}</td><td /><td />
              </tr>
            )}
            {data && data.rows.length > 0 && (
              <tr className="border-t border-stone-700 bg-stone-950/40 font-semibold">
                <td className="px-4 py-2.5 text-stone-200" colSpan={2}>Total</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-stone-100">{money(tot.stock)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-stone-100">{money(tot.gl)}</td>
                <td className={`px-4 py-2.5 text-right tabular-nums ${diffCls(tot.diff)}`}>{money(tot.diff)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <h2 className={`${t.heading} mb-2`}>Open orders vs work in progress</h2>
      <p className={`${t.hint} mb-3`}>Material out at job workers (dispatched, not yet received back) against the Work-in-Progress account. A build opens and closes in one entry, so it never leaves value here.</p>
      <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-x-auto">
        <table className="w-full text-[13px] min-w-[600px]">
          <thead><tr className={tableHead}>
            <th className="text-left px-4 py-2.5">WIP account</th>
            <th className="text-right px-4 py-2.5">Open orders</th><th className="text-right px-4 py-2.5">GL balance</th><th className="text-right px-4 py-2.5">Difference</th>
          </tr></thead>
          <tbody>
            {data?.wip.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-stone-500">No work-in-progress account is mapped yet.</td></tr>}
            {data?.wip.map(w => (
              <tr key={w.accountId} className="border-b border-stone-800/60">
                <td className="px-4 py-2 text-stone-100 font-medium">{w.accountCode ? <span className="font-mono text-[12px] text-stone-400 mr-2">{w.accountCode}</span> : null}{w.accountName}</td>
                <td className="px-4 py-2 text-right tabular-nums text-stone-300">{money(w.openOrdersValue)}</td>
                <td className="px-4 py-2 text-right tabular-nums text-stone-300">{money(w.glBalance)}</td>
                <td className={`px-4 py-2 text-right tabular-nums ${diffCls(w.difference)}`}>{money(w.difference)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportShell>
  );
}
