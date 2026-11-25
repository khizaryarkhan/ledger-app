"use client";

/** AR/AP Aging and Sales-Tax Liability reports (native, from the GL). */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { RefreshCw, Users, Building2, Receipt, ArrowLeft } from "lucide-react";
import { fmt, localToday } from "@/lib/format";
import { useFiscalFrom } from "@/components/use-report-from";
import { ReportShell } from "@/components/ui";
import { controlCompact } from "@/components/form-kit";
import { useData } from "@/components/data-provider";
import { buildAgingModel, AGING_BUCKETS, AGING_BUCKET_LABEL } from "@/lib/reports/builders/aging";
import { buildTaxLiabilityModel } from "@/lib/reports/builders/tax-liability";
import { useListView, ListHead, listTable, listRow, listCell, listNumCell, listMoneyCell, type ListColumn } from "@/components/list-view";

const money = fmt.num2;
// Home-currency GL figures (no per-row currency) — kept on fmt.num2 exactly
// as before rather than ListColumn's `money` typing. See stock-reports.tsx
// for the fuller explanation.
const footCls = "border-t-2 border-stone-800 bg-stone-900/60 font-semibold";

// One definition, shared with the export, so the screen and the exported file label the buckets identically.
const BUCKETS = AGING_BUCKETS;
const BUCKET_LABEL = AGING_BUCKET_LABEL;

export function AgingReport({ side }: { side: "receivable" | "payable" }) {
  const [data, setData] = useState<any>(null);
  const [asOf, setAsOf] = useState(localToday());
  const isAR = side === "receivable";
  // Clear first so a new "As of" date is never exported over the previous date's figures; a failed request is flagged so it is never exported as "nothing outstanding".
  async function load() { setData(null); setData(await fetch(`/api/accounting/aging?side=${side}&asOf=${asOf}`).then(r => r.json()).catch(() => ({ rows: [], buckets: {}, total: 0, failed: true }))); }
  useEffect(() => { load(); }, [asOf]);
  const rows = data?.rows ?? [];

  const COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "doc",    label: "Doc",  sort: r => r.docNumber, filter: { kind: "text", value: r => r.docNumber } },
    { key: "party",  label: isAR ? "Customer" : "Supplier", sort: r => r.party, filter: { kind: "text", value: r => r.party } },
    { key: "due",    label: "Due",  sort: r => r.dueDate },
    { key: "age",    label: "Age",  sort: r => r.bucket, filter: { kind: "multi", value: r => BUCKET_LABEL[r.bucket] ?? r.bucket } },
    { key: "total",  label: "Total", align: "right", sort: r => Number(r.total) || 0, descFirst: true },
    { key: "open",   label: "Open",  align: "right", sort: r => Number(r.open) || 0, descFirst: true },
  ], [isAR]);
  const lv = useListView(rows, COLS, { storageKey: `finance-aging-${side}` });

  // Export / Print / PDF: the buckets, and the documents the list is showing right now (after the user's sort and filters).
  let org: { name: string; displayName: string | null; currency: string } | null = null;
  try { org = useData().orgSettings; } catch { org = null; }
  const exportModel = useMemo(() => {
    if (data === null || data.failed || data.error) return null;
    try {
      return buildAgingModel(data, lv.rows, {
        side, asOf,
        entity: org ? (org.displayName || org.name) : "",
        currency: org?.currency ?? null,
        asOfLine: `As at ${fmt.shortDate(asOf)}`,
      });
    } catch (e) {
      console.error("Could not build the export model", e);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, lv.rows, side, asOf, org?.name, org?.displayName, org?.currency]);

  return (
    <ReportShell title={isAR ? "Aged Receivables" : "Aged Payables"} sub={isAR ? "Open customer invoices bucketed by how overdue they are." : "Open supplier bills bucketed by how overdue they are."} icon={isAR ? Users : Building2} onRefresh={load} loading={data === null} exportModel={exportModel}>
      <div className="flex items-center gap-2 mb-3 text-[12px] text-stone-400">As of <input type="date" value={asOf} onChange={e => setAsOf(e.target.value)} className={controlCompact} /></div>
      <div className="grid grid-cols-5 gap-2 mb-4">
        {BUCKETS.map(b => (
          <div key={b} className={`rounded-lg border p-3 ${b === "90+" ? "border-rose-800/50 bg-rose-500/5" : "border-stone-800 bg-stone-900"}`}>
            <div className="text-[10px] uppercase tracking-wide text-stone-500">{BUCKET_LABEL[b]}{b !== "current" ? " days" : ""}</div>
            <div className={`text-[15px] font-semibold tabular-nums ${b === "90+" ? "text-rose-400" : "text-stone-100"}`}>{money(data?.buckets?.[b])}</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-hidden"><div className="overflow-x-auto">
        <table className={`${listTable} min-w-[680px]`}>
          <ListHead lv={lv} />
          <tbody>
            {data === null && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
            {data !== null && lv.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Nothing outstanding.</td></tr>}
            {lv.rows.map((r: any) => (
              <tr key={r.id} className={listRow()}>
                <td className={`${listCell} font-mono text-[12px]`}><Link href={`/accounting/transactions/${r.id}`} className="text-emerald-400 hover:text-emerald-300 hover:underline">{r.docNumber}</Link></td>
                <td className={`${listCell} text-stone-200`}>{r.party}</td>
                <td className={`${listCell} text-stone-400`}>{fmt.shortDate(r.dueDate)}</td>
                <td className={listCell}><span className={`text-[11px] ${r.bucket === "90+" ? "text-rose-400" : r.bucket === "current" ? "text-stone-500" : "text-amber-400"}`}>{BUCKET_LABEL[r.bucket]}</span></td>
                <td className={`${listNumCell} text-stone-400`}>{money(r.total)}</td>
                <td className={`${listMoneyCell} text-stone-200`}>{money(r.open)}</td>
              </tr>
            ))}
          </tbody>
          {data !== null && lv.rows.length > 0 && <tfoot><tr className={footCls}><td className="px-2 py-2.5 text-stone-200" colSpan={5}>Total {isAR ? "receivable" : "payable"}</td><td className={listMoneyCell}><span className="text-white">{money(data.total)}</span></td></tr></tfoot>}
        </table>
      </div></div>
    </ReportShell>
  );
}

export function TaxLiabilityReport() {
  const [data, setData] = useState<any>(null);
  const [from, setFrom] = useFiscalFrom();
  const [to, setTo] = useState(localToday());
  // The period the figures on screen were fetched for: the export is held back unless it matches the dates selected now.
  const [loadedKey, setLoadedKey] = useState("");
  async function load() {
    const key = `${from}|${to}`;
    setData(null);
    setData(await fetch(`/api/accounting/tax-liability?from=${from}&to=${to}`).then(r => r.json()).catch(() => null));
    setLoadedKey(key);
  }
  useEffect(() => { load(); }, [from, to]);
  let taxOrg: { name: string; displayName: string | null; currency: string } | null = null;
  try { taxOrg = useData().orgSettings; } catch { taxOrg = null; }
  const exportModel = useMemo(() => {
    if (data === null || data.error || data.closingBalance == null || loadedKey !== `${from}|${to}`) return null;
    try {
      return buildTaxLiabilityModel(data, {
        entity: taxOrg ? (taxOrg.displayName || taxOrg.name) : "",
        currency: taxOrg?.currency ?? null,
        periodLine: `For the period ${fmt.shortDate(from)} to ${fmt.shortDate(to)}`,
        from, to,
      });
    } catch (e) {
      console.error("Could not build the export model", e);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loadedKey, from, to, taxOrg?.name, taxOrg?.displayName, taxOrg?.currency]);
  const Row = ({ label, value, strong, hint }: { label: string; value: number; strong?: boolean; hint?: string }) => (
    <div className={`flex items-center justify-between px-4 py-2.5 border-b border-stone-800/60 ${strong ? "bg-stone-950/40" : ""}`}>
      <div><span className={strong ? "font-semibold text-stone-100" : "text-stone-300"}>{label}</span>{hint && <span className="text-[11px] text-stone-500 ml-2">{hint}</span>}</div>
      <span className={`tabular-nums ${strong ? "font-semibold text-stone-100" : "text-stone-300"}`}>{money(value)}</span>
    </div>
  );
  return (
    <ReportShell title="Sales Tax Liability" sub="Output tax collected on sales, less input tax reclaimed on purchases, for the period." icon={Receipt} onRefresh={load} loading={data === null} exportModel={exportModel}>
      <div className="flex items-center gap-2 mb-4 text-[12px] text-stone-400">
        From <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={controlCompact} />
        to <input type="date" value={to} onChange={e => setTo(e.target.value)} className={controlCompact} />
      </div>
      <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-hidden max-w-xl">
        {data === null ? <div className="px-4 py-8 text-center text-stone-500">Loading…</div> : (<>
          <Row label="Opening balance" value={data.openingBalance} hint="owed at period start" />
          <Row label="Output tax (on sales)" value={data.outputTax} />
          <Row label="Input tax (on purchases)" value={data.inputTax ? -data.inputTax : 0} />
          {data.adjustments !== 0 && <Row label="Adjustments / payments" value={data.adjustments} />}
          <Row label="Net for period" value={data.netLiability} strong />
          <Row label="Closing balance (payable)" value={data.closingBalance} strong hint="owed to tax authority" />
        </>)}
      </div>
    </ReportShell>
  );
}
