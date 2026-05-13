"use client";

import { useState } from "react";
import Link from "next/link";
import { Card, Button, Badge } from "@/components/ui";
import { fmt } from "@/lib/format";
import { ChevronLeft, RefreshCw, CheckCircle, AlertTriangle, ExternalLink, Filter } from "lucide-react";

type Row = {
  customerId: string;
  customerName: string;
  customerCode: string;
  qboId: string | null;
  currency: string;
  qboBalance: number | null;
  qboBalanceWithJobs: number | null;
  ourOpenInvoiceBalance: number;
  ourCmCredit: number;
  ourPaymentCredit: number;
  ourJeBalance: number;
  ourDepositCredit: number;
  ourNetBalance: number;
  delta: number | null;
  status: "match" | "drift" | "no-qbo-id" | "qbo-error";
  error?: string;
};

type Totals = {
  customersChecked: number;
  qboFetched: number;
  qboErrors: number;
  customersInDrift: number;
  customersInMatch: number;
  customersWithoutQboId: number;
  ourTotalNetAR: number;
  qboTotalNetAR: number;
};

export default function ReconcilePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [running, setRunning] = useState(false);
  const [asOf, setAsOf] = useState<string | null>(null);
  const [driftOnly, setDriftOnly] = useState(true);
  const [tolerance, setTolerance] = useState(1);

  const run = async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/qbo/reconcile-customers?driftOnly=${driftOnly}&tolerance=${tolerance}`);
      if (res.ok) {
        const data = await res.json();
        setRows(data.rows || []);
        setTotals(data.totals || null);
        setAsOf(data.asOf || null);
      }
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <Link href="/settings/integrations" className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-900 mb-3">
          <ChevronLeft size={14} /> Integrations
        </Link>
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Reconcile with QBO</h1>
        <p className="text-sm text-stone-500 mt-1">
          Verify every customer's balance against QBO's authoritative <code>Customer.Balance</code> field. Use this to confirm what we display ties to QBO row-for-row.
        </p>
      </div>

      <Card className="mb-4">
        <div className="flex items-end gap-4 flex-wrap">
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={driftOnly} onChange={e => setDriftOnly(e.target.checked)} />
            Show only customers in drift
          </label>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-stone-500">Tolerance:</span>
            <input
              type="number" step="0.01" min="0" value={tolerance}
              onChange={e => setTolerance(parseFloat(e.target.value) || 0)}
              className="h-8 w-24 px-2 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
            />
            <span className="text-stone-500">per customer</span>
          </div>
          <Button onClick={run} disabled={running} icon={RefreshCw} className="ml-auto">
            {running ? "Reconciling…" : "Run reconciliation"}
          </Button>
        </div>
        {asOf && (
          <div className="text-[11px] text-stone-400 mt-3">
            Last run {new Date(asOf).toLocaleString()}.
            Each customer triggers one live QBO API call — large orgs may take a couple of minutes.
          </div>
        )}
      </Card>

      {/* Totals summary */}
      {totals && (
        <div className="grid grid-cols-4 gap-3 mb-4">
          <Card padding="md">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Customers checked</div>
            <div className="text-2xl font-semibold text-stone-900 tabular-nums">{totals.customersChecked}</div>
            <div className="text-[11px] text-stone-500 mt-2">{totals.qboFetched} fetched from QBO live</div>
          </Card>
          <Card padding="md">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">In drift</div>
            <div className={`text-2xl font-semibold tabular-nums ${totals.customersInDrift > 0 ? "text-rose-700" : "text-emerald-700"}`}>
              {totals.customersInDrift}
            </div>
            <div className="text-[11px] text-stone-500 mt-2">{totals.customersInMatch} match · tolerance €{tolerance}</div>
          </Card>
          <Card padding="md">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Our total net AR</div>
            <div className="text-2xl font-semibold text-stone-900 tabular-nums">{fmt.money(totals.ourTotalNetAR, "EUR")}</div>
          </Card>
          <Card padding="md">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">QBO total net AR</div>
            <div className="text-2xl font-semibold text-stone-900 tabular-nums">{fmt.money(totals.qboTotalNetAR, "EUR")}</div>
            <div className={`text-[11px] mt-2 tabular-nums ${Math.abs(totals.ourTotalNetAR - totals.qboTotalNetAR) < 1 ? "text-emerald-600" : "text-rose-700"}`}>
              Δ {fmt.money(totals.ourTotalNetAR - totals.qboTotalNetAR, "EUR")}
            </div>
          </Card>
        </div>
      )}

      {/* Rows */}
      {rows.length > 0 && (
        <Card padding="none">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200 bg-stone-50">
                <th className="text-left font-semibold px-3 py-3">Customer</th>
                <th className="text-right font-semibold px-3 py-3">Open Inv</th>
                <th className="text-right font-semibold px-3 py-3">CM Credit</th>
                <th className="text-right font-semibold px-3 py-3">Pay Credit</th>
                <th className="text-right font-semibold px-3 py-3">JE Bal</th>
                <th className="text-right font-semibold px-3 py-3">Deposit</th>
                <th className="text-right font-semibold px-3 py-3 bg-stone-100">Our Net</th>
                <th className="text-right font-semibold px-3 py-3 bg-stone-100">QBO Bal</th>
                <th className="text-right font-semibold px-3 py-3 bg-stone-100">Δ</th>
                <th className="text-left font-semibold px-3 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.customerId} className="border-b border-stone-100 hover:bg-stone-50">
                  <td className="px-3 py-2.5">
                    <Link href={`/customers/${r.customerId}`} className="text-stone-800 hover:text-brand-orange font-medium">
                      {r.customerName}
                    </Link>
                    <div className="text-[10px] text-stone-400 font-mono">{r.customerCode}</div>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-stone-600">{r.ourOpenInvoiceBalance ? fmt.money(r.ourOpenInvoiceBalance, r.currency) : "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{r.ourCmCredit ? fmt.money(r.ourCmCredit, r.currency) : "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{r.ourPaymentCredit ? fmt.money(r.ourPaymentCredit, r.currency) : "—"}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${r.ourJeBalance < 0 ? "text-amber-700" : "text-stone-600"}`}>{r.ourJeBalance ? fmt.money(r.ourJeBalance, r.currency) : "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{r.ourDepositCredit ? fmt.money(r.ourDepositCredit, r.currency) : "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold bg-stone-50">{fmt.money(r.ourNetBalance, r.currency)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold bg-stone-50">{r.qboBalance != null ? fmt.money(r.qboBalance, r.currency) : "—"}</td>
                  <td className={`px-3 py-2.5 text-right tabular-nums font-bold bg-stone-50 ${
                    r.delta == null ? "text-stone-300"
                    : Math.abs(r.delta) < tolerance ? "text-emerald-700"
                    : "text-rose-700"
                  }`}>
                    {r.delta != null ? fmt.money(r.delta, r.currency) : "—"}
                  </td>
                  <td className="px-3 py-2.5">
                    {r.status === "match" && <Badge variant="green" size="sm">Match</Badge>}
                    {r.status === "drift" && <Badge variant="red" size="sm">Drift</Badge>}
                    {r.status === "no-qbo-id" && <Badge variant="neutral" size="sm">No QBO id</Badge>}
                    {r.status === "qbo-error" && (
                      <span title={r.error}><Badge variant="amber" size="sm">QBO error</Badge></span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {!running && rows.length === 0 && totals && (
        <Card>
          <div className="py-8 text-center">
            <CheckCircle size={32} className="mx-auto text-emerald-500 mb-2" />
            <div className="text-sm text-stone-700 font-medium">All customers tie to QBO</div>
            <div className="text-[12px] text-stone-500 mt-1">
              {totals.customersInMatch} of {totals.customersChecked} customers match within €{tolerance} tolerance.
            </div>
          </div>
        </Card>
      )}

      {!running && rows.length === 0 && !totals && (
        <Card>
          <div className="py-12 text-center text-stone-400 text-sm">
            Click "Run reconciliation" to verify every customer's balance against QBO.
          </div>
        </Card>
      )}
    </div>
  );
}
