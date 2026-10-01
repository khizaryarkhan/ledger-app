"use client";

/** Procurement reports — Open POs, Expected Bills (open GR/IR), Open Bills. */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ShoppingCart, PackageCheck, FileText } from "lucide-react";
import { fmt } from "@/lib/format";
import { ReportShell } from "@/components/ui";
import { useListView, ListHead, listTable, listRow, listCell, listNumCell, listMoneyCell, type ListColumn } from "@/components/list-view";

const money = fmt.num2;
// Home-currency GL/procurement figures (no per-row currency) — kept on
// fmt.num2 exactly as before rather than ListColumn's `money` typing (which
// formats via fmt.money and would default an unset currency to EUR). See
// stock-reports.tsx for the fuller explanation.
const footCls = "border-t-2 border-stone-800 bg-stone-900/60 font-semibold";

function useReport(type: string) {
  const [data, setData] = useState<any>(null);
  async function load() { setData(await fetch(`/api/inventory/procurement-reports?type=${type}`).then(r => r.json()).catch(() => ({ rows: [], total: 0 }))); }
  useEffect(() => { load(); }, []);
  return { data, load, loading: data === null };
}

export function OpenPosReport() {
  const { data, load, loading } = useReport("open-pos");
  const rows = data?.rows ?? [];
  const COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "po",       label: "PO #",     sort: r => r.docNumber, filter: { kind: "text", value: r => r.docNumber } },
    { key: "supplier", label: "Supplier", sort: r => r.supplier, filter: { kind: "text", value: r => r.supplier } },
    { key: "date",     label: "Date",     sort: r => r.date },
    { key: "status",   label: "Status",   sort: r => r.status, filter: { kind: "multi", value: r => r.status } },
    { key: "remaining", label: "Remaining value", align: "right", sort: r => Number(r.remainingValue) || 0, descFirst: true },
  ], []);
  const lv = useListView(rows, COLS, { storageKey: "procurement-open-pos" });
  return (
    <ReportShell title="Open Purchase Orders" sub="Ordered but not fully received — with the quantity still expected from each supplier." icon={ShoppingCart} onRefresh={load} loading={loading}>
      <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className={`${listTable} min-w-[640px]`}>
            <ListHead lv={lv} />
            <tbody>
              {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {!loading && lv.rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">No open purchase orders.</td></tr>}
              {lv.rows.map((p: any) => (
                <tr key={p.id} className={listRow()}>
                  <td className={`${listCell} font-mono text-[12px] text-stone-200`}>{p.docNumber || p.id.slice(0, 8)}</td>
                  <td className={`${listCell} text-stone-200`}>{p.supplier || "—"}</td>
                  <td className={`${listCell} text-stone-400`}>{p.date}</td>
                  <td className={listCell}><span className={`text-[11px] ${p.status === "Partial" ? "text-amber-400" : "text-stone-400"}`}>{p.status}</span></td>
                  <td className={`${listMoneyCell} text-stone-200`}>{money(p.remainingValue)}</td>
                </tr>
              ))}
            </tbody>
            {!loading && lv.rows.length > 0 && <tfoot><tr className={footCls}><td className="px-2 py-2.5 text-stone-200" colSpan={4}>Total remaining on order</td><td className={listMoneyCell}><span className="text-white">{money(data.total)}</span></td></tr></tfoot>}
          </table>
        </div>
      </div>
    </ReportShell>
  );
}

export function ExpectedBillsReport() {
  const { data, load, loading } = useReport("expected-bills");
  const rows = data?.rows ?? [];
  const COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "receipt",  label: "Receipt #", sort: r => r.receiptNo, filter: { kind: "text", value: r => r.receiptNo } },
    { key: "supplier", label: "Supplier",  sort: r => r.supplierLabel, filter: { kind: "text", value: r => r.supplierLabel } },
    { key: "date",     label: "Date",      sort: r => r.receiptDate },
    { key: "received", label: "Received",  align: "right", sort: r => Number(r.received) || 0, descFirst: true },
    { key: "billed",   label: "Billed",    align: "right", sort: r => Number(r.billed) || 0, descFirst: true },
    { key: "open",     label: "Awaiting bill", align: "right", sort: r => Number(r.openAmount) || 0, descFirst: true },
  ], []);
  const lv = useListView(rows, COLS, { storageKey: "procurement-expected-bills" });
  return (
    <ReportShell title="Expected Bills" sub="Goods received but not yet billed — the open GR/IR accrual awaiting a supplier bill." icon={PackageCheck} onRefresh={load} loading={loading}>
      <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className={`${listTable} min-w-[620px]`}>
            <ListHead lv={lv} />
            <tbody>
              {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {!loading && lv.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Nothing awaiting a bill — GR/IR is clear.</td></tr>}
              {lv.rows.map((r: any) => (
                <tr key={r.id} className={listRow()}>
                  <td className={`${listCell} font-mono text-[12px] text-stone-200`}>{r.receiptNo || r.id.slice(0, 8)}</td>
                  <td className={`${listCell} text-stone-200`}>{r.supplierLabel || "—"}</td>
                  <td className={`${listCell} text-stone-400`}>{r.receiptDate}</td>
                  <td className={`${listNumCell} text-stone-400`}>{money(r.received)}</td>
                  <td className={`${listNumCell} text-stone-400`}>{money(r.billed)}</td>
                  <td className={`${listMoneyCell} text-amber-400`}>{money(r.openAmount)}</td>
                </tr>
              ))}
            </tbody>
            {!loading && lv.rows.length > 0 && <tfoot><tr className={footCls}><td className="px-2 py-2.5 text-stone-200" colSpan={5}>Total expected bills (GR/IR)</td><td className={listMoneyCell}><span className="text-white">{money(data.total)}</span></td></tr></tfoot>}
          </table>
        </div>
      </div>
    </ReportShell>
  );
}

export function OpenBillsReport() {
  const { data, load, loading } = useReport("open-bills");
  const rows = data?.rows ?? [];
  const COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "bill",     label: "Bill #",   sort: r => r.docNumber, filter: { kind: "text", value: r => r.docNumber } },
    { key: "supplier", label: "Supplier", sort: r => r.supplier, filter: { kind: "text", value: r => r.supplier } },
    { key: "due",      label: "Due",      sort: r => r.dueDate },
    { key: "total",    label: "Total",    align: "right", sort: r => Number(r.total) || 0, descFirst: true },
    { key: "open",     label: "Open",     align: "right", sort: r => Number(r.open) || 0, descFirst: true },
  ], []);
  const lv = useListView(rows, COLS, { storageKey: "procurement-open-bills" });
  return (
    <ReportShell title="Open Bills" sub="Posted supplier bills with an unpaid Accounts Payable balance." icon={FileText} onRefresh={load} loading={loading}>
      <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className={`${listTable} min-w-[640px]`}>
            <ListHead lv={lv} />
            <tbody>
              {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
              {!loading && lv.rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">No open bills — everything is paid.</td></tr>}
              {lv.rows.map((b: any) => (
                <tr key={b.id} className={listRow()}>
                  <td className={`${listCell} font-mono text-[12px]`}><Link href={`/accounting/transactions/${b.id}`} className="text-emerald-400 hover:text-emerald-300 hover:underline">{b.docNumber}</Link></td>
                  <td className={`${listCell} text-stone-200`}>{b.supplier}</td>
                  <td className={listCell}><span className={b.overdue ? "text-rose-400" : "text-stone-400"}>{b.dueDate || "—"}</span></td>
                  <td className={`${listNumCell} text-stone-400`}>{money(b.total)}</td>
                  <td className={`${listMoneyCell} text-stone-200`}>{money(b.open)}</td>
                </tr>
              ))}
            </tbody>
            {!loading && lv.rows.length > 0 && <tfoot><tr className={footCls}><td className="px-2 py-2.5 text-stone-200" colSpan={4}>Total payable</td><td className={listMoneyCell}><span className="text-white">{money(data.total)}</span></td></tr></tfoot>}
          </table>
        </div>
      </div>
    </ReportShell>
  );
}
