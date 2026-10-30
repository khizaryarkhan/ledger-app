"use client";

/**
 * The items of one order, shown when its row is expanded: item + SKU + pack,
 * ordered, received, balance and a single line state. Everything else (rate,
 * billed, dates, why a line was closed) is one click away on the line itself,
 * so the default view stays five columns wide.
 *
 * Used for purchase orders and sales orders alike (the shipped quantity is
 * stored in the same received column).
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Loader } from "lucide-react";
import { fmt, formatDate, localToday } from "@/lib/format";
import { daysBetween } from "@/lib/inventory/delivery-performance";
import { closeReasonLabel, type LineState } from "@/lib/accounting/po-workflow";
import type { PoItemRow } from "@/lib/accounting/po-workflow-server";
import { ClosePoLineDrawer } from "@/components/po-workflow-drawers";

const STATE_LABEL: Record<LineState, string> = {
  NotReceived: "Not received", PartlyReceived: "Partly received", Received: "Received", ClosedShort: "Closed short", Late: "Late",
};
// Colour is for exceptions only; literal class strings so Tailwind can see them.
const STATE_CLASS: Record<LineState, string> = {
  NotReceived: "text-stone-400", PartlyReceived: "text-teal-400", Received: "text-emerald-400",
  ClosedShort: "rounded-full bg-rose-500/15 text-rose-400 border border-rose-800/60 px-2 py-0.5",
  Late: "rounded-full bg-rose-500/15 text-rose-400 border border-rose-800/60 px-2 py-0.5",
};

export function PoItemsPanel({ docId, kind, currency, canClose, onChanged }: {
  docId: string; kind: "purchase-orders" | "sales-orders"; currency: string | null; canClose: boolean; onChanged: (message?: string) => void;
}) {
  const [rows, setRows] = useState<PoItemRow[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [closing, setClosing] = useState<PoItemRow | null>(null);
  const [err, setErr] = useState("");
  const received = kind === "purchase-orders" ? "Received" : "Shipped";

  const load = useCallback(() => {
    fetch(`/api/trade-documents/${kind}/${docId}/workflow?today=${localToday()}`).then(r => r.json())
      .then(d => setRows(Array.isArray(d) ? d : [])).catch(() => setRows([]));
  }, [kind, docId]);
  useEffect(load, [load]);

  const totals = useMemo(() => {
    const t = { ordered: 0, received: 0, expected: 0, notDelivered: 0, billed: 0 };
    for (const r of rows ?? []) {
      const base = r.orderedBase || 1;
      t.ordered += r.amount;
      t.received += r.amount * Math.min(1, r.receivedBase / base);
      t.billed += r.amount * Math.min(1, r.billedBase / base);
      const left = r.amount * Math.max(0, r.orderedBase - r.receivedBase) / base;
      if (r.closed) t.notDelivered += left; else t.expected += left;
    }
    return t;
  }, [rows]);

  async function reopen(r: PoItemRow) {
    setErr("");
    const res = await fetch(`/api/inventory/po-lines/${r.id}/close`, { method: "DELETE" });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) { setErr(d?.error || "Could not reopen the line."); return; }
    load(); onChanged(`Reopened ${r.name}.`);
  }

  if (rows === null) return <div className="text-[12px] text-stone-500 inline-flex items-center gap-1.5 py-2"><Loader size={11} className="animate-spin" /> Loading items…</div>;
  if (!rows.length) return <div className="text-[12px] text-stone-600 py-2">This order has no lines.</div>;

  const th = "px-3 py-1.5 text-left text-[11px] font-medium text-stone-500";
  return (
    <div className="rounded-lg border border-stone-800 bg-stone-950 overflow-hidden">
      {err && <div className="px-3 py-2 text-[12px] text-rose-400 border-b border-stone-800">{err}</div>}
      <table className="w-full text-[13px]">
        <thead className="border-b border-stone-800 bg-stone-900/60">
          <tr>
            <th className={th}>Item</th><th className={`${th} text-right`}>Ordered</th><th className={`${th} text-right`}>{received}</th>
            <th className={`${th} text-right`}>Balance</th><th className={th}>Stage</th><th className={`${th} w-28`} />
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const uom = r.orderUom || r.baseUom || "";
            const packed = r.unitsPerOrderUnit > 1 && r.baseUom;
            const isOpen = open === r.id;
            const overdue = r.state === "Late" && (r.promisedDate || r.requestedDate) ? daysBetween((r.promisedDate || r.requestedDate)!, localToday()) : 0;
            return (
              <Fragment key={r.id}>
                <tr className="border-b border-stone-800/60 last:border-0">
                  <td className="px-3 py-2">
                    <button onClick={() => setOpen(isOpen ? null : r.id)} className="flex items-start gap-1.5 text-left group">
                      {isOpen ? <ChevronDown size={12} className="mt-1 shrink-0 text-stone-600" /> : <ChevronRight size={12} className="mt-1 shrink-0 text-stone-600" />}
                      <span>
                        <span className="block text-stone-200 group-hover:text-white">{r.name}</span>
                        <span className="block text-[11px] text-stone-500">
                          {uom}{packed ? ` of ${fmt.qty(r.unitsPerOrderUnit)} ${r.baseUom}` : ""}{r.sku ? ` · ${r.sku}` : ""}
                        </span>
                      </span>
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <div className="text-stone-200">{fmt.qty(r.qty)} {uom}</div>
                    {packed && <div className="text-[11px] text-stone-500">{fmt.qty(r.orderedBase)} {r.baseUom}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <div className="text-stone-200">{fmt.qty(r.receivedOrder)} {uom}</div>
                    {packed && <div className="text-[11px] text-stone-500">{fmt.qty(r.receivedBase)} {r.baseUom}</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.closed || r.balanceBase === 0 ? <span className="text-stone-600">—</span> : (
                      <>
                        <div className="text-stone-100 font-medium">{fmt.qty(r.balanceOrder)} {uom}</div>
                        {packed && <div className="text-[11px] text-stone-500">{fmt.qty(r.balanceBase)} {r.baseUom}</div>}
                      </>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[12px] ${STATE_CLASS[r.state]}`}>{STATE_LABEL[r.state]}</span>
                    {r.state === "Late" && overdue > 0 && <div className="text-[11px] text-stone-500 mt-0.5">{overdue} day{overdue === 1 ? "" : "s"}</div>}
                    {r.closed && r.closedAt && <div className="text-[11px] text-stone-500 mt-0.5">{formatDate(r.closedAt.slice(0, 10))} · {closeReasonLabel(r.closeCode)}</div>}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    {canClose && !r.closed && r.balanceBase > 0 && (
                      <button onClick={() => setClosing(r)} className="text-[12px] text-stone-400 hover:text-amber-300">Stop expecting…</button>
                    )}
                    {canClose && r.closed && <button onClick={() => reopen(r)} className="text-[12px] text-stone-400 hover:text-emerald-300">Reopen</button>}
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-stone-800/60 bg-stone-900/40">
                    <td colSpan={6} className="px-9 py-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-3 text-[12px]">
                        <Detail label="Pack">{uom}{packed ? ` = ${fmt.qty(r.unitsPerOrderUnit)} ${r.baseUom}` : ""}</Detail>
                        <Detail label="Rate">{fmt.money(r.rate, currency ?? undefined)} per {uom || "unit"}</Detail>
                        <Detail label="Billed so far">{fmt.qty(r.billedBase)} {r.baseUom ?? ""}</Detail>
                        <Detail label="Requested">{r.requestedDate ? formatDate(r.requestedDate) : "—"}</Detail>
                        <Detail label="Promised">
                          {r.promisedDate ? formatDate(r.promisedDate) : "—"}
                          {r.promiseRevisions > 0 && <span className="ml-1 text-amber-400">· moved {r.promiseRevisions}×</span>}
                        </Detail>
                        <Detail label="First promise">{r.originalPromisedDate ? formatDate(r.originalPromisedDate) : "—"}</Detail>
                        {r.closed && <Detail label="Closed because">{closeReasonLabel(r.closeCode)}{r.closeNote ? ` — ${r.closeNote}` : ""}</Detail>}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-stone-800 bg-stone-900/60 px-3 py-2 text-[12px] text-stone-400">
        <span>Ordered <b className="text-stone-200 tabular-nums">{fmt.money(totals.ordered, currency ?? undefined)}</b></span>
        <span>{received} <b className="text-stone-200 tabular-nums">{fmt.money(totals.received, currency ?? undefined)}</b></span>
        <span>Still expected <b className="text-stone-200 tabular-nums">{fmt.money(totals.expected, currency ?? undefined)}</b></span>
        {totals.notDelivered > 0.005 && <span>Not delivered <b className="text-rose-400 tabular-nums">{fmt.money(totals.notDelivered, currency ?? undefined)}</b></span>}
        <span>Billed <b className="text-stone-200 tabular-nums">{fmt.money(totals.billed, currency ?? undefined)}</b></span>
        <span className="text-stone-600">before tax</span>
      </div>
      {closing && (
        <ClosePoLineDrawer currency={currency} onClose={() => setClosing(null)}
          line={{ id: closing.id, name: closing.name, orderUom: closing.orderUom, baseUom: closing.baseUom, qty: closing.qty, receivedOrder: closing.receivedOrder, balanceOrder: closing.balanceOrder, balanceBase: closing.balanceBase, rate: closing.rate }}
          onDone={m => { setClosing(null); load(); onChanged(m); }} />
      )}
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><div className="text-stone-500">{label}</div><div className="mt-0.5 text-stone-200">{children}</div></div>;
}
