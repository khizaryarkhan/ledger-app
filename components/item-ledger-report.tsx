"use client";

/**
 * Item Ledger — the stock card. One block per item: opening quantity and value, every movement in the period
 * (receipt, use in production, output, sale, adjustment) with its document and lot, and the running balance.
 *
 * The General Ledger cannot do this: it posts one line per account per document, so several items share a line
 * and it carries no quantity. This reads the item-level movement log instead, and the banner ties its total back
 * to the inventory accounts of the books so the two can never quietly part company.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { BookOpen, ShieldCheck, ShieldAlert } from "lucide-react";
import { fmt, localToday } from "@/lib/format";
import { ReportShell } from "@/components/ui";
import { control, SelectField, t, th } from "@/components/form-kit";
import { listTable, listRow, listCell, listNumCell } from "@/components/list-view";
import { totalClosingValue, type ItemLedger } from "@/lib/inventory/item-ledger";

const money = fmt.num2;
type Result = {
  from: string | null; to: string; ledgers: ItemLedger[]; truncated: boolean;
  itemOptions: { id: string; name: string }[];
  tie: { stockValue: number; glBalance: number; difference: number };
};

const monthStart = (ymd: string) => `${ymd.slice(0, 8)}01`;

export function ItemLedgerReport() {
  const today = localToday();
  const [from, setFrom] = useState(monthStart(today));
  const [to, setTo] = useState(today);
  const [itemId, setItemId] = useState("");
  const [data, setData] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setData(null); setErr(null);
    const q = new URLSearchParams({ to, ...(from ? { from } : {}), ...(itemId ? { itemId } : {}) });
    const res = await fetch(`/api/inventory/item-ledger?${q}`);
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(d?.error || "Could not load the report"); setData({ from, to, ledgers: [], truncated: false, itemOptions: [], tie: { stockValue: 0, glBalance: 0, difference: 0 } }); return; }
    setData(d);
  }
  useEffect(() => { load(); }, [from, to, itemId]);

  const tie = data?.tie;
  // The same tolerance Stock vs GL uses (a cent or two of rounding when a cost is spread over quantity), so the
  // two reports can never disagree about whether the same books tie.
  const tied = tie ? Math.abs(tie.difference) < 0.015 : true;
  const roundingCent = tie ? tied && Math.abs(tie.difference) >= 0.005 : false;

  return (
    <ReportShell title="Item Ledger" sub="Every movement of each item, with its document and lot, and the running quantity and value." icon={BookOpen} onRefresh={load} loading={data === null}>
      <div className="flex items-end gap-3 mb-4 flex-wrap">
        <label className={`${t.secondary} flex flex-col gap-1`}>Item
          <div className="w-64">
            <SelectField value={itemId} onChange={e => setItemId(e.target.value)}>
              <option value="">All items</option>
              {(data?.itemOptions ?? []).map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </SelectField>
          </div>
        </label>
        <label className={`${t.secondary} flex flex-col gap-1`}>From
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${control} !w-44`} />
        </label>
        <label className={`${t.secondary} flex flex-col gap-1`}>To
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={`${control} !w-44`} />
        </label>
      </div>

      {err && <p className="text-[13px] text-rose-400 mb-3">{err}</p>}
      {data?.truncated && (
        <p className="text-[13px] text-amber-300 mb-3">This period has more movements than can be shown at once, so the balances below are not complete. Narrow the dates or pick one item.</p>
      )}

      {tie && (
        <div className={`rounded-lg border px-4 py-3 mb-5 flex items-center gap-3 flex-wrap ${tied ? "border-emerald-900/60 bg-emerald-950/20" : "border-amber-800/70 bg-amber-950/20"}`}>
          {tied ? <ShieldCheck size={16} className="text-emerald-400" /> : <ShieldAlert size={16} className="text-amber-400" />}
          <span className={`text-[13px] ${tied ? "text-emerald-300" : "text-amber-300"}`}>
            {tied ? (roundingCent ? `Ties to the books · ${money(Math.abs(tie.difference))} of rounding` : "Ties to the books") : `Does not tie to the books · off by ${money(Math.abs(tie.difference))}`}
          </span>
          <span className="text-[12px] text-stone-400">
            All stock at {fmt.shortDate(to)}: {money(tie.stockValue)} · inventory accounts in the ledger: {money(tie.glBalance)}
          </span>
          <Link href="/accounting/reports/stock-vs-gl" className="text-[12px] text-stone-400 hover:text-stone-200 ml-auto">Stock vs GL →</Link>
        </div>
      )}

      {data === null && <p className="px-1 py-8 text-center text-stone-500">Loading…</p>}
      {data && data.ledgers.length === 0 && !err && <p className="px-1 py-8 text-center text-stone-500">No stock movements in this period.</p>}

      {data?.ledgers.map(l => (
        <div key={l.item.id} className="rounded-lg bg-stone-900 border border-stone-800 overflow-x-auto mb-5">
          <div className="px-4 py-3 flex items-baseline justify-between gap-3 flex-wrap border-b border-stone-800">
            <div className={t.heading}>{l.item.name} <span className="ml-1 text-[12px] font-normal text-stone-500">in {l.item.uom ?? "units"}</span></div>
            <div className="text-[12px] text-stone-400 tabular-nums">Opening {fmt.qty(l.openingQty)} · {money(l.openingValue)}</div>
          </div>
          <table className={`${listTable} min-w-[960px]`}>
            <thead>
              <tr className="border-b border-stone-800">
                <th className={th}>Date</th><th className={th}>Type</th><th className={th}>No.</th><th className={th}>Lot</th>
                <th className={`${th} text-right`}>In</th><th className={`${th} text-right`}>Out</th>
                <th className={`${th} text-right`}>Unit cost</th><th className={`${th} text-right`}>Value</th>
                <th className={`${th} text-right`}>Balance qty</th><th className={`${th} text-right`}>Balance value</th>
              </tr>
            </thead>
            <tbody>
              {l.lines.length === 0 && <tr><td colSpan={10} className="px-4 py-4 text-center text-stone-500">No movements in this period.</td></tr>}
              {l.lines.map(m => (
                <tr key={m.id} className={listRow()}>
                  <td className={`${listCell} text-stone-300 whitespace-nowrap`}>{fmt.shortDate(m.date)}</td>
                  <td className={`${listCell} text-stone-300 whitespace-nowrap`}>{m.label}</td>
                  <td className={`${listCell} font-mono text-[12px] whitespace-nowrap`}>
                    {m.entryId && m.docNo
                      ? <Link href={`/accounting/transactions/${m.entryId}`} className="text-emerald-400 hover:underline">{m.docNo}</Link>
                      : Math.abs(m.totalCost) > 0.005
                        ? <span className="text-amber-300" title="This stock carries value but has no ledger entry behind it, so the books do not know about it.">No ledger entry</span>
                        : <span className="text-stone-300" title="Received at no value, so there was nothing to post to the ledger.">{m.docNo ?? "—"}</span>}
                  </td>
                  <td className={`${listCell} font-mono text-[12px] text-stone-400 whitespace-nowrap`}>{m.lotNo ?? "—"}</td>
                  <td className={`${listNumCell} text-stone-200`}>{m.qtyIn ? fmt.qty(m.qtyIn) : ""}</td>
                  <td className={`${listNumCell} text-stone-200`}>{m.qtyOut ? fmt.qty(m.qtyOut) : ""}</td>
                  <td className={`${listNumCell} text-stone-400`}>{m.unitCost != null ? money(m.unitCost) : "—"}</td>
                  <td className={`${listNumCell} text-stone-300`}>{money(m.totalCost)}</td>
                  <td className={`${listNumCell} text-stone-100`}>{fmt.qty(m.balanceQty)}</td>
                  <td className={`${listNumCell} text-stone-100`}>{money(m.balanceValue)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-stone-800 bg-stone-900/60 font-semibold">
                <td className="px-2 py-2.5 text-stone-200" colSpan={4}>Closing · {l.unposted > 0 ? <span className="text-amber-300 font-normal">{l.unposted} movement{l.unposted === 1 ? "" : "s"} with no ledger entry</span> : <span className="text-stone-500 font-normal">in {fmt.qty(l.inQty)}, out {fmt.qty(l.outQty)}</span>}</td>
                <td className={listNumCell}>{fmt.qty(l.inQty)}</td>
                <td className={listNumCell}>{fmt.qty(l.outQty)}</td>
                <td />
                <td className={listNumCell}>{money(l.inValue - l.outValue)}</td>
                <td className={`${listNumCell} text-white`}>{fmt.qty(l.closingQty)}</td>
                <td className={`${listNumCell} text-white`}>{money(l.closingValue)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      ))}

      {data && data.ledgers.length > 1 && !data.truncated && (
        <p className="text-[12px] text-stone-400 text-right tabular-nums">Closing value of the items shown: <span className="text-stone-100 font-semibold">{money(totalClosingValue(data.ledgers))}</span></p>
      )}
    </ReportShell>
  );
}
