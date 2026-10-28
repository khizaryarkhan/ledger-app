"use client";

/**
 * Delivery Performance — on time / in full (OTIF) per supplier (PO lines vs
 * goods receipts) or per customer (SO lines vs shipments). Every figure comes
 * from /api/inventory/delivery-performance, which applies the rules in
 * lib/inventory/delivery-performance.ts. "vs first promise" sits beside "on
 * time" because a promise that keeps moving should not score as on time.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Timer } from "lucide-react";
import { ReportShell } from "@/components/ui";
import { SelectField, control } from "@/components/form-kit";
import { formatDate, localToday, fmt } from "@/lib/format";
import { listTable, listRow } from "@/components/list-view";

type Score = {
  lines: number; open: number; overdue: number; onTimePct: number | null; onTimeVsOriginalPct: number | null;
  inFullPct: number | null; otifPct: number | null; avgDaysLate: number | null; avgLeadTimeDays: number | null; revisedLines: number;
};
type PartyRow = Score & { partyId: string | null; partyLabel: string; unconfirmedOrders: number };
type LineRow = {
  lineId: string; docNumber: string | null; partyLabel: string; partyRef: string | null;
  item: string; requestedDate: string | null; promisedDate: string | null; originalPromisedDate: string | null;
  promiseRevisions: number; orderedQty: number; deliveredQty: number; lastDelivery: string | null;
  state: "Open" | "Overdue" | "Delivered" | "Closed short"; onTime: boolean | null; inFull: boolean | null; daysLate: number | null;
};

const pct = (n: number | null) => (n == null ? "—" : `${n}%`);
// Literal classes only — a band per threshold, never built at runtime.
const band = (n: number | null) => (n == null ? "text-stone-500" : n >= 95 ? "text-emerald-400" : n >= 80 ? "text-amber-400" : "text-rose-400");
const STATE_CHIP: Record<LineRow["state"], string> = {
  Open: "bg-stone-800 text-stone-300 border-stone-700",
  Overdue: "bg-rose-500/12 text-rose-400 border-rose-800/50",
  Delivered: "bg-emerald-500/12 text-emerald-400 border-emerald-800/50",
  "Closed short": "bg-amber-500/12 text-amber-400 border-amber-800/50",
};
const th = "text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-800";

export function DeliveryPerformanceReport() {
  const router = useRouter();
  const sp = useSearchParams();
  const side = sp.get("side") === "customer" ? "customer" : "supplier";
  const today = localToday();
  const [from, setFrom] = useState(`${today.slice(0, 4)}-01-01`);
  const [to, setTo] = useState(today);
  const [show, setShow] = useState<"exceptions" | "all">("exceptions");
  const [data, setData] = useState<{ overall?: Score; parties: PartyRow[]; lines: LineRow[] } | null>(null);
  const [party, setParty] = useState("");

  async function load() {
    setData(null);
    const q = new URLSearchParams({ side, from, to, asOf: today });
    const d = await fetch(`/api/inventory/delivery-performance?${q}`).then(r => r.json()).catch(() => null);
    setData(d && Array.isArray(d.parties) ? d : { parties: [], lines: [] });
  }
  useEffect(() => { setParty(""); load(); }, [side, from, to]);

  const who = side === "customer" ? "Customer" : "Supplier";
  const isException = (l: LineRow) => l.state === "Overdue" || l.onTime === false || l.inFull === false || l.promiseRevisions > 0;
  const lines = (data?.lines ?? [])
    .filter(l => !party || l.partyLabel === party)
    .filter(l => show === "all" || isException(l));
  const o = data?.overall;
  const tiles: [string, string, string][] = o ? [
    ["OTIF", pct(o.otifPct), band(o.otifPct)],
    ["On time", pct(o.onTimePct), band(o.onTimePct)],
    ["vs first promise", pct(o.onTimeVsOriginalPct), band(o.onTimeVsOriginalPct)],
    ["In full", pct(o.inFullPct), band(o.inFullPct)],
    ["Overdue lines", String(o.overdue), o.overdue ? "text-rose-400" : "text-stone-200"],
    ["Avg lead time", o.avgLeadTimeDays == null ? "—" : `${o.avgLeadTimeDays} d`, "text-stone-200"],
  ] : [];
  const sub = side === "customer"
    ? "Did we ship what customers ordered, when we promised? Sales order lines against shipments."
    : "Did suppliers deliver what we ordered, when they promised? Purchase order lines against goods receipts.";

  return (
    <ReportShell title="Delivery Performance" sub={sub} icon={Timer} onRefresh={load} loading={data === null}>
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div className="w-52">
          <SelectField value={side} onChange={e => router.replace(`?side=${e.target.value}`)} className="h-8 text-[12px]">
            <option value="supplier">Suppliers (purchasing)</option>
            <option value="customer">Customers (fulfilment)</option>
          </SelectField>
        </div>
        <label className="text-[11px] text-stone-500">Orders from
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={`${control} h-8 text-[12px] mt-0.5`} />
        </label>
        <label className="text-[11px] text-stone-500">to
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={`${control} h-8 text-[12px] mt-0.5`} />
        </label>
      </div>

      {tiles.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mb-5">
          {tiles.map(([label, value, cls]) => (
            <div key={label} className="rounded-lg bg-stone-900 border border-stone-800 px-3 py-2.5">
              <div className="text-[10px] uppercase tracking-wider text-stone-500">{label}</div>
              <div className={`text-[18px] font-semibold tabular-nums ${cls}`}>{value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-stone-800 overflow-x-auto mb-6">
        <table className={listTable}>
          <thead>
            <tr className={th}>
              <th className="text-left px-3 py-2">{who}</th>
              <th className="text-right px-2 py-2">Lines</th>
              <th className="text-right px-2 py-2">OTIF</th>
              <th className="text-right px-2 py-2">On time</th>
              <th className="text-right px-2 py-2">vs first promise</th>
              <th className="text-right px-2 py-2">In full</th>
              <th className="text-right px-2 py-2">Avg days late</th>
              <th className="text-right px-2 py-2">Avg lead time</th>
              <th className="text-right px-2 py-2">Overdue</th>
              <th className="text-right px-2 py-2">Re-promised</th>
              <th className="text-right px-3 py-2">Unconfirmed orders</th>
            </tr>
          </thead>
          <tbody>
            {(data?.parties ?? []).length === 0 && (
              <tr><td colSpan={11} className="px-3 py-8 text-center text-[13px] text-stone-500">
                {data === null ? "Loading…" : `No ${side === "customer" ? "sales" : "purchase"} orders with stocked lines in this period.`}
              </td></tr>
            )}
            {(data?.parties ?? []).map(p => (
              <tr key={p.partyId ?? p.partyLabel} className={`${listRow(party === p.partyLabel)} cursor-pointer`}
                onClick={() => setParty(party === p.partyLabel ? "" : p.partyLabel)}>
                <td className="px-3 py-2 text-stone-200">{p.partyLabel}</td>
                <td className="px-2 py-2 text-right tabular-nums text-stone-400">{p.lines}</td>
                <td className={`px-2 py-2 text-right tabular-nums font-semibold ${band(p.otifPct)}`}>{pct(p.otifPct)}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${band(p.onTimePct)}`}>{pct(p.onTimePct)}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${band(p.onTimeVsOriginalPct)}`}>{pct(p.onTimeVsOriginalPct)}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${band(p.inFullPct)}`}>{pct(p.inFullPct)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-stone-400">{p.avgDaysLate ?? "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums text-stone-400">{p.avgLeadTimeDays == null ? "—" : `${p.avgLeadTimeDays} d`}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${p.overdue ? "text-rose-400" : "text-stone-500"}`}>{p.overdue}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${p.revisedLines ? "text-amber-400" : "text-stone-500"}`}>{p.revisedLines}</td>
                <td className={`px-3 py-2 text-right tabular-nums ${p.unconfirmedOrders ? "text-amber-400" : "text-stone-500"}`}>{p.unconfirmedOrders}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between mb-2">
        <div className="text-[12px] text-stone-400">
          Lines{party ? ` · ${party}` : ""} <span className="text-stone-600">({lines.length})</span>
          {party && <button onClick={() => setParty("")} className="ml-2 text-teal-400 hover:text-teal-300">clear</button>}
        </div>
        <div className="w-64">
          <SelectField value={show} onChange={e => setShow(e.target.value as "exceptions" | "all")} className="h-8 text-[12px]">
            <option value="exceptions">Exceptions only (late, short, re-promised)</option>
            <option value="all">All lines</option>
          </SelectField>
        </div>
      </div>
      <div className="rounded-lg border border-stone-800 overflow-x-auto">
        <table className={listTable}>
          <thead>
            <tr className={th}>
              <th className="text-left px-3 py-2">Order</th>
              <th className="text-left px-2 py-2">{who}</th>
              <th className="text-left px-2 py-2">Item</th>
              <th className="text-left px-2 py-2">Requested</th>
              <th className="text-left px-2 py-2">Promised</th>
              <th className="text-left px-2 py-2">Delivered</th>
              <th className="text-right px-2 py-2">Qty</th>
              <th className="text-right px-2 py-2">Days late</th>
              <th className="text-left px-3 py-2">State</th>
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-[13px] text-stone-500">{data === null ? "Loading…" : "Nothing to show."}</td></tr>
            )}
            {lines.map(l => (
              <tr key={l.lineId} className={listRow(false)}>
                <td className="px-3 py-2 font-mono text-[12px] text-stone-300">
                  {l.docNumber}
                  {l.partyRef && <div className="text-[10px] text-stone-600 font-sans">ref {l.partyRef}</div>}
                </td>
                <td className="px-2 py-2 text-stone-300">{l.partyLabel}</td>
                <td className="px-2 py-2 text-stone-200">{l.item}</td>
                <td className="px-2 py-2 text-stone-400">{l.requestedDate ? formatDate(l.requestedDate) : "—"}</td>
                <td className="px-2 py-2 text-stone-400">
                  {l.promisedDate ? formatDate(l.promisedDate) : "—"}
                  {l.promiseRevisions > 0 && (
                    <div className="text-[10px] text-amber-400">moved {l.promiseRevisions}× · first {l.originalPromisedDate ? formatDate(l.originalPromisedDate) : "—"}</div>
                  )}
                </td>
                <td className="px-2 py-2 text-stone-400">{l.lastDelivery ? formatDate(l.lastDelivery) : "—"}</td>
                <td className="px-2 py-2 text-right tabular-nums text-stone-300">{fmt.qty(l.deliveredQty)} / {fmt.qty(l.orderedQty)}</td>
                <td className={`px-2 py-2 text-right tabular-nums ${(l.daysLate ?? 0) > 0 ? "text-rose-400" : "text-stone-500"}`}>{l.daysLate ?? "—"}</td>
                <td className="px-3 py-2"><span className={`text-[10px] font-medium border rounded-full px-2 py-0.5 ${STATE_CHIP[l.state]}`}>{l.state}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ReportShell>
  );
}
