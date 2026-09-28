"use client";

/** Sales reports — Open SOs, Awaiting Invoicing (shipped not invoiced), Open Invoices. */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ShoppingCart, Truck, FileText } from "lucide-react";
import { fmt } from "@/lib/format";
import { ReportShell } from "@/components/ui";
import { useListView, ListHead, listTable, listRow, listCell, listNumCell, listMoneyCell, type ListColumn } from "@/components/list-view";

const money = fmt.num2;
// Home-currency GL/sales figures (no per-row currency) — kept on fmt.num2
// exactly as before rather than ListColumn's `money` typing. See
// stock-reports.tsx for the fuller explanation.
const footCls = "border-t-2 border-stone-800 bg-stone-900/60 font-semibold";

function useReport(type: string) {
  const [data, setData] = useState<any>(null);
  async function load() { setData(await fetch(`/api/inventory/sales-reports?type=${type}`).then(r => r.json()).catch(() => ({ rows: [], total: 0 }))); }
  useEffect(() => { load(); }, []);
  return { data, load, loading: data === null };
}

export function OpenSosReport() {
  const { data, load, loading } = useReport("open-sos");
  const rows = data?.rows ?? [];
  const COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "so",       label: "SO #",     sort: r => r.docNumber, filter: { kind: "text", value: r => r.docNumber } },
    { key: "customer", label: "Customer", sort: r => r.customer, filter: { kind: "text", value: r => r.customer } },
    { key: "date",     label: "Date",     sort: r => r.date },
    { key: "status",   label: "Status",   sort: r => r.status, filter: { kind: "multi", value: r => r.status } },
    { key: "remaining", label: "Remaining value", align: "right", sort: r => Number(r.remainingValue) || 0, descFirst: true },
  ], []);
  const lv = useListView(rows, COLS, { storageKey: "sales-open-sos" });
  return (
    <ReportShell title="Open Sales Orders" sub="Confirmed but not fully shipped — the value still committed to customers." icon={ShoppingCart} onRefresh={load} loading={loading}>
      <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-hidden"><div className="overflow-x-auto">
        <table className={`${listTable} min-w-[640px]`}>
          <ListHead lv={lv} />
          <tbody>
            {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
            {!loading && lv.rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">No open sales orders.</td></tr>}
            {lv.rows.map((p: any) => (
              <tr key={p.id} className={listRow()}>
                <td className={`${listCell} font-mono text-[12px] text-stone-200`}>{p.docNumber || p.id.slice(0, 8)}</td>
                <td className={`${listCell} text-stone-200`}>{p.customer || "—"}</td>
                <td className={`${listCell} text-stone-400`}>{p.date}</td>
                <td className={listCell}><span className={`text-[11px] ${p.status === "Partial" ? "text-amber-400" : "text-stone-400"}`}>{p.status}</span></td>
                <td className={`${listMoneyCell} text-stone-200`}>{money(p.remainingValue)}</td>
              </tr>
            ))}
          </tbody>
          {!loading && lv.rows.length > 0 && <tfoot><tr className={footCls}><td className="px-2 py-2.5 text-stone-200" colSpan={4}>Total committed to customers</td><td className={listMoneyCell}><span className="text-white">{money(data.total)}</span></td></tr></tfoot>}
        </table>
      </div></div>
    </ReportShell>
  );
}

export function AwaitingInvoicingReport() {
  const { data, load, loading } = useReport("awaiting-invoicing");
  const rows = data?.rows ?? [];
  const COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "shipment", label: "Shipment #", sort: r => r.shipmentNo, filter: { kind: "text", value: r => r.shipmentNo } },
    { key: "customer", label: "Customer",   sort: r => r.customerLabel, filter: { kind: "text", value: r => r.customerLabel } },
    { key: "date",     label: "Date",       sort: r => r.shipmentDate },
    { key: "sale",     label: "Sale value", align: "right", sort: r => Number(r.saleValue) || 0, descFirst: true },
    { key: "invoiced", label: "Invoiced",   align: "right", sort: r => Number(r.invoiced) || 0, descFirst: true },
    { key: "open",     label: "Awaiting invoice", align: "right", sort: r => Number(r.openAmount) || 0, descFirst: true },
  ], []);
  const lv = useListView(rows, COLS, { storageKey: "sales-awaiting-invoicing" });
  return (
    <ReportShell title="Awaiting Invoicing" sub="Goods shipped to customers but not yet invoiced — revenue still to be billed." icon={Truck} onRefresh={load} loading={loading}>
      <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-hidden"><div className="overflow-x-auto">
        <table className={`${listTable} min-w-[620px]`}>
          <ListHead lv={lv} />
          <tbody>
            {loading && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
            {!loading && lv.rows.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-stone-500">Nothing awaiting an invoice.</td></tr>}
            {lv.rows.map((r: any) => (
              <tr key={r.id} className={listRow()}>
                <td className={`${listCell} font-mono text-[12px] text-stone-200`}>{r.shipmentNo || r.id.slice(0, 8)}</td>
                <td className={`${listCell} text-stone-200`}>{r.customerLabel || "—"}</td>
                <td className={`${listCell} text-stone-400`}>{r.shipmentDate}</td>
                <td className={`${listNumCell} text-stone-400`}>{money(r.saleValue)}</td>
                <td className={`${listNumCell} text-stone-400`}>{money(r.invoiced)}</td>
                <td className={`${listMoneyCell} text-amber-400`}>{money(r.openAmount)}</td>
              </tr>
            ))}
          </tbody>
          {!loading && lv.rows.length > 0 && <tfoot><tr className={footCls}><td className="px-2 py-2.5 text-stone-200" colSpan={5}>Total awaiting invoicing</td><td className={listMoneyCell}><span className="text-white">{money(data.total)}</span></td></tr></tfoot>}
        </table>
      </div></div>
    </ReportShell>
  );
}

export function OpenInvoicesReport() {
  const { data, load, loading } = useReport("open-invoices");
  const rows = data?.rows ?? [];
  const COLS = useMemo<ListColumn<any>[]>(() => [
    { key: "invoice",  label: "Invoice #", sort: r => r.docNumber, filter: { kind: "text", value: r => r.docNumber } },
    { key: "customer", label: "Customer",  sort: r => r.customer, filter: { kind: "text", value: r => r.customer } },
    { key: "due",      label: "Due",       sort: r => r.dueDate },
    { key: "total",    label: "Total",     align: "right", sort: r => Number(r.total) || 0, descFirst: true },
    { key: "open",     label: "Open",      align: "right", sort: r => Number(r.open) || 0, descFirst: true },
  ], []);
  const lv = useListView(rows, COLS, { storageKey: "sales-open-invoices" });
  return (
    <ReportShell title="Open Invoices" sub="Posted customer invoices with an unpaid Accounts Receivable balance." icon={FileText} onRefresh={load} loading={loading}>
      <div className="rounded-lg bg-stone-900 border border-stone-800 overflow-hidden"><div className="overflow-x-auto">
        <table className={`${listTable} min-w-[640px]`}>
          <ListHead lv={lv} />
          <tbody>
            {loading && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">Loading…</td></tr>}
            {!loading && lv.rows.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-stone-500">No open invoices.</td></tr>}
            {lv.rows.map((b: any) => (
              <tr key={b.id} className={listRow()}>
                <td className={`${listCell} font-mono text-[12px]`}><Link href={`/accounting/transactions/${b.id}`} className="text-emerald-400 hover:text-emerald-300 hover:underline">{b.docNumber}</Link></td>
                <td className={`${listCell} text-stone-200`}>{b.customer}</td>
                <td className={listCell}><span className={b.overdue ? "text-rose-400" : "text-stone-400"}>{b.dueDate || "—"}</span></td>
                <td className={`${listNumCell} text-stone-400`}>{money(b.total)}</td>
                <td className={`${listMoneyCell} text-stone-200`}>{money(b.open)}</td>
              </tr>
            ))}
          </tbody>
          {!loading && lv.rows.length > 0 && <tfoot><tr className={footCls}><td className="px-2 py-2.5 text-stone-200" colSpan={4}>Total receivable</td><td className={listMoneyCell}><span className="text-white">{money(data.total)}</span></td></tr></tfoot>}
        </table>
      </div></div>
    </ReportShell>
  );
}
