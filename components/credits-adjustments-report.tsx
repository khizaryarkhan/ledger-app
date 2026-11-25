"use client";

/**
 * Credits & Adjustments — why money was given back or the ledger adjusted by
 * hand (0116). Figures come from /api/accounting/adjustments; reason codes
 * from lib/accounting/entry-reasons.ts. "Not recorded" is shown in amber so a
 * gap in the data is visible rather than hidden.
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useData } from "@/components/data-provider";
import { buildCreditsAdjustmentsModel } from "@/lib/reports/builders/credits-adjustments";
import { Undo2 } from "lucide-react";
import { ReportShell } from "@/components/ui";
import { control } from "@/components/form-kit";
import { formatDate, localToday, fmt } from "@/lib/format";
import { useFiscalFrom } from "@/components/use-report-from";
import { listTable, listRow } from "@/components/list-view";

type Group = { code: string; label: string; count: number; amount: number };
type Data = {
  empty?: boolean;
  customerCredits: { count: number; amount: number; pctOfSales: number | null; byReason: Group[] };
  supplierCredits: { count: number; amount: number; pctOfPurchases: number | null; byReason: Group[] };
  journals: { count: number; amount: number; byReason: Group[] };
  billCapture: { bills: number; withReceivedDate: number; avgLagDays: number | null; over7Days: number };
  editedAfterPosting: number;
  lines: { id: string; type: string; docNumber: string | null; date: string; amount: number; reason: string | null; unrecorded: boolean; memo: string | null; editedAt: string | null }[];
};

const TYPE_LABEL: Record<string, string> = { CreditNote: "Credit note", RefundReceipt: "Refund", VendorCredit: "Supplier credit", Manual: "Journal", Bill: "Bill", Expense: "Expense", Invoice: "Invoice", SalesReceipt: "Sales receipt" };
const th = "text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-800";

function ReasonCard({ title, sub, groups }: { title: string; sub: string; groups: Group[] }) {
  const max = Math.max(1, ...groups.map(g => g.amount));
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900/40 p-3">
      <div className="text-[11px] uppercase tracking-wider text-stone-500">{title}</div>
      <div className="text-[12px] text-stone-400 mb-2">{sub}</div>
      {groups.length === 0 && <div className="text-[12px] text-stone-600 py-2">None in this period.</div>}
      {groups.map(g => (
        <div key={g.code} className="mb-1.5">
          <div className="flex justify-between text-[12px]">
            <span className={g.code === "unrecorded" ? "text-amber-400" : "text-stone-300"}>{g.label}</span>
            <span className="tabular-nums text-stone-400">{fmt.num2(g.amount)} · {g.count}</span>
          </div>
          <div className="h-1.5 rounded-full bg-stone-800 mt-0.5">
            <div className={`h-1.5 rounded-full ${g.code === "unrecorded" ? "bg-amber-500/60" : "bg-teal-500/70"}`} style={{ width: `${(g.amount / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CreditsAdjustmentsReport() {
  const today = localToday();
  const [from, setFrom] = useFiscalFrom();
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  // The period the figures on screen were fetched for: the export is held back unless it matches the dates selected now.
  const [loadedKey, setLoadedKey] = useState("");
  async function load() {
    const key = `${from}|${to}`;
    setLoading(true);
    setData(null);
    const x = await fetch(`/api/accounting/adjustments?${new URLSearchParams({ from, to })}`).then(r => r.json()).catch(() => null);
    setData(x); setLoadedKey(key); setLoading(false);
  }
  useEffect(() => { load(); }, [from, to]);

  const d = data && !data.empty && data.customerCredits ? data : null;

  // Export / Print / PDF. Held while loading, after a failed request, or when the figures are for other dates.
  let org: { name: string; displayName: string | null; currency: string } | null = null;
  try { org = useData().orgSettings; } catch { org = null; }
  const exportModel = useMemo(() => {
    if (loading || data === null || (data as any).error || loadedKey !== `${from}|${to}`) return null;
    if (!data.empty && !data.customerCredits) return null;
    try {
      return buildCreditsAdjustmentsModel(data, {
        entity: org ? (org.displayName || org.name) : "",
        currency: org?.currency ?? null,
        periodLine: `For the period ${formatDate(from)} to ${formatDate(to)}`,
        from, to,
        formatDate,
      });
    } catch (e) {
      console.error("Could not build the export model", e);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, loading, loadedKey, from, to, org?.name, org?.displayName, org?.currency]);
  const tiles: [string, string, string][] = d ? [
    ["Customer credits", fmt.num2(d.customerCredits.amount), "text-stone-200"],
    ["% of sales", d.customerCredits.pctOfSales == null ? "—" : `${d.customerCredits.pctOfSales}%`, (d.customerCredits.pctOfSales ?? 0) > 5 ? "text-rose-400" : "text-stone-200"],
    ["Supplier credits", fmt.num2(d.supplierCredits.amount), "text-stone-200"],
    ["Manual journals", String(d.journals.count), "text-stone-200"],
    ["Bill capture lag", d.billCapture.avgLagDays == null ? "—" : `${d.billCapture.avgLagDays} d`, (d.billCapture.avgLagDays ?? 0) > 7 ? "text-amber-400" : "text-stone-200"],
    ["Edited after posting", String(d.editedAfterPosting), d.editedAfterPosting ? "text-amber-400" : "text-stone-200"],
  ] : [];

  return (
    <ReportShell title="Credits & Adjustments" sub="Why money was given back, why the ledger was adjusted by hand, and how quickly supplier bills reach you."
      icon={Undo2} onRefresh={load} loading={loading} exportModel={exportModel}>
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <label className="text-[11px] text-stone-500">From
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${control} h-8 text-[12px] mt-0.5`} />
        </label>
        <label className="text-[11px] text-stone-500">to
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={`${control} h-8 text-[12px] mt-0.5`} />
        </label>
      </div>

      {!loading && !d && <div className="text-[13px] text-stone-500 py-8 text-center">No native credits, journals or bills in this period.</div>}

      {d && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-5">
            {tiles.map(([label, value, cls]) => (
              <div key={label} className="rounded-lg bg-stone-900 border border-stone-800 px-3 py-2.5">
                <div className="text-[10px] uppercase tracking-wider text-stone-500">{label}</div>
                <div className={`text-[18px] font-semibold tabular-nums ${cls}`}>{value}</div>
              </div>
            ))}
          </div>
          <div className="grid md:grid-cols-3 gap-3 mb-5">
            <ReasonCard title="Customer credits by reason" sub={`${d.customerCredits.count} credit notes and refunds`} groups={d.customerCredits.byReason} />
            <ReasonCard title="Supplier credits by reason" sub={`${d.supplierCredits.count} supplier credits`} groups={d.supplierCredits.byReason} />
            <ReasonCard title="Manual journals by purpose" sub={`${d.journals.count} journals`} groups={d.journals.byReason} />
          </div>
          <p className="text-[12px] text-stone-500 mb-2">
            Bill capture: {d.billCapture.withReceivedDate} of {d.billCapture.bills} bills and expenses carry a received date
            {d.billCapture.over7Days ? <>; <span className="text-amber-400">{d.billCapture.over7Days} reached you more than 7 days after their date</span></> : null}.
          </p>
          <div className="rounded-lg border border-stone-800 overflow-x-auto">
            <table className={listTable}>
              <thead><tr className={th}>
                <th className="text-left px-3 py-2">Document</th><th className="text-left px-2 py-2">Type</th>
                <th className="text-left px-2 py-2">Date</th><th className="text-right px-2 py-2">Amount</th>
                <th className="text-left px-2 py-2">Reason</th><th className="text-left px-2 py-2">Memo</th><th className="text-left px-3 py-2">Last edited</th>
              </tr></thead>
              <tbody>
                {d.lines.length === 0 && <tr><td colSpan={7} className="px-3 py-6 text-center text-[13px] text-stone-500">Nothing to show.</td></tr>}
                {d.lines.map(l => (
                  <tr key={l.id} className={listRow(false)}>
                    <td className="px-3 py-2 font-mono text-[12px]"><Link href={`/accounting/transactions/${l.id}`} className="text-teal-400 hover:text-teal-300">{l.docNumber ?? "—"}</Link></td>
                    <td className="px-2 py-2 text-stone-300">{TYPE_LABEL[l.type] ?? l.type}</td>
                    <td className="px-2 py-2 text-stone-400">{formatDate(l.date)}</td>
                    <td className="px-2 py-2 text-right tabular-nums text-stone-200">{fmt.num2(l.amount)}</td>
                    <td className={`px-2 py-2 ${l.unrecorded ? "text-amber-400" : "text-stone-300"}`}>{l.reason ?? "—"}</td>
                    <td className="px-2 py-2 text-stone-500 max-w-[260px] truncate">{l.memo ?? "—"}</td>
                    <td className="px-3 py-2 text-stone-400">{l.editedAt ? formatDate(l.editedAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ReportShell>
  );
}
