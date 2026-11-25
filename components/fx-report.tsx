"use client";

/** Currency Exposure & FX revaluation — enter today's rate per currency to see unrealised gain/loss. */

import { useEffect, useMemo, useState } from "react";
import { Coins } from "lucide-react";
import { fmt, localToday } from "@/lib/format";
import { controlCompact } from "@/components/form-kit";
import { ReportShell } from "@/components/ui";
import { useData } from "@/components/data-provider";
import { buildFxModel, revalueRow } from "@/lib/reports/builders/fx-exposure";
import { useListView, ListHead, listTable, listRow, listCell, listNumCell, listMoneyCell, type ListColumn } from "@/components/list-view";

const money = fmt.num2;
// Home-currency-relative figures (booked/revalued/G-L are computed per FX
// row, not summed across currencies into one pot) — kept on fmt.num2 exactly
// as before rather than ListColumn's `money` typing. See stock-reports.tsx
// for the fuller explanation.
const footCls = "border-t-2 border-stone-800 bg-stone-900/60 font-semibold";

export function FxExposureReport() {
  const [data, setData] = useState<any>(null);
  const [asOf, setAsOf] = useState(localToday());
  const [rates, setRates] = useState<Record<string, string>>({});
  // The date the figures on screen were fetched for: the export is held back unless it matches the date selected now.
  const [loadedKey, setLoadedKey] = useState("");
  async function load() {
    const key = asOf;
    setData(null);
    setData(await fetch(`/api/accounting/fx-exposure?asOf=${asOf}`).then(r => r.json()).catch(() => null));
    setLoadedKey(key);
  }
  useEffect(() => { load(); }, [asOf]);
  const rows = data?.rows ?? [];
  const home = data?.home ?? "";

  // Seed the rate inputs with each currency's implied average rate.
  useEffect(() => {
    if (!data) return;
    setRates(prev => {
      const next = { ...prev };
      for (const r of rows) if (next[r.currency] === undefined && r.avgRate) next[r.currency] = String(r.avgRate);
      return next;
    });
  }, [data]);

  const withGL = useMemo(() => rows.map((r: any) => revalueRow(r, rates)), [rows, rates]);
  const COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "account",  label: "Account", sort: r => r.accountName, filter: { kind: "text", value: r => r.accountName } },
    { key: "ccy",      label: "Ccy",     sort: r => r.currency, filter: { kind: "multi", value: r => r.currency } },
    { key: "foreign",  label: "Foreign balance", align: "right", sort: r => Number(r.foreignBalance) || 0, descFirst: true },
    { key: "booked",   label: `Booked (${home})`, align: "right", sort: r => Number(r.homeCarrying) || 0, descFirst: true },
    { key: "rate",     label: "Rate now", align: "right" },
    { key: "revalued", label: "Revalued", align: "right", sort: r => Number(r.revalued) || 0, descFirst: true },
    { key: "gl",       label: "Unrealised G/(L)", align: "right", sort: r => Number(r.gl) || 0, descFirst: true },
  ], [home]);
  const lv = useListView(withGL, COLS, { storageKey: "fx-exposure" });
  // Reflects the filtered set, matching the rest of the app's list-view
  // footers (a filter narrows what the total totals).
  const totalGL = useMemo(() => lv.rows.reduce((s: number, r: any) => s + r.gl, 0), [lv.rows]);

  // Export / Print / PDF: the rows the list shows, revalued at the rates typed in now (the file states them).
  let org: { name: string; displayName: string | null; currency: string } | null = null;
  try { org = useData().orgSettings; } catch { org = null; }
  const exportModel = useMemo(() => {
    if (data === null || data.error || !Array.isArray(data.rows) || loadedKey !== asOf) return null;
    // Wait for the effect that seeds the rate boxes, so the file never shows the pre-seed (unrevalued) figures.
    if (rows.some((r: any) => r.avgRate && rates[r.currency] === undefined)) return null;
    try {
      return buildFxModel(data, lv.rows, { entity: org ? (org.displayName || org.name) : "", asOf, asOfLine: `As at ${fmt.shortDate(asOf)}`, rates });
    } catch (e) {
      console.error("Could not build the export model", e);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loadedKey, asOf, lv.rows, rates, org?.name, org?.displayName]);

  return (
    <ReportShell title="Currency Exposure & FX Revaluation" sub={`Foreign-currency balances and the home value they were booked at. Enter today's rate per currency to see the unrealised gain/loss if revalued now. Home currency: ${home}.`} icon={Coins} onRefresh={load} loading={data === null} exportModel={exportModel}>
      <div className="flex items-center gap-2 mb-3 text-[12px] text-stone-400">As of <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={controlCompact} /></div>

      <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-hidden"><div className="overflow-x-auto">
        <table className={`${listTable} min-w-[720px]`}>
          <ListHead lv={lv} />
          <tbody>
            {data === null && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
            {data !== null && lv.rows.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-stone-500">No foreign-currency balances.</td></tr>}
            {lv.rows.map((r: any) => (
              <tr key={r.accountId + r.currency} className={listRow()}>
                <td className={`${listCell} text-stone-200`}>{r.accountName}</td>
                <td className={`${listCell} text-stone-400 font-mono`}>{r.currency}</td>
                <td className={`${listNumCell} text-stone-300`}>{money(r.foreignBalance)}</td>
                <td className={`${listNumCell} text-stone-300`}>{money(r.homeCarrying)}</td>
                <td className={listNumCell}><input type="number" value={rates[r.currency] ?? ""} onChange={e => setRates(p => ({ ...p, [r.currency]: e.target.value }))} className={`${controlCompact} w-24 text-right font-mono`} /></td>
                <td className={`${listNumCell} text-stone-300`}>{money(r.revalued)}</td>
                <td className={`${listMoneyCell} ${r.gl > 0 ? "text-emerald-400" : r.gl < 0 ? "text-rose-400" : "text-stone-500"}`}>{money(r.gl)}</td>
              </tr>
            ))}
          </tbody>
          {data !== null && lv.rows.length > 0 && (
            <tfoot><tr className={footCls}>
              <td className="px-2 py-2.5 text-stone-200" colSpan={6}>Total unrealised FX gain / (loss)</td>
              <td className={`${listMoneyCell} ${totalGL > 0 ? "text-emerald-400" : totalGL < 0 ? "text-rose-400" : "text-stone-100"}`}>{money(totalGL)}</td>
            </tr></tfoot>
          )}
        </table>
      </div></div>
      <p className="text-[11px] text-stone-500 mt-3">This is a position report. Posting the revaluation to the ledger (and recognising realised FX at settlement) is a scheduled enhancement.</p>
    </ReportShell>
  );
}
