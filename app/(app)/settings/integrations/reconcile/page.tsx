"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Card, Button, Badge } from "@/components/ui";
import { fmt } from "@/lib/format";
import { ChevronLeft, RefreshCw, CheckCircle, AlertTriangle, ExternalLink, Filter } from "lucide-react";

// ── Provider-agnostic reconciliation (instant, no per-customer API calls) ──────
type SelfReconRow = {
  customerId: string; customerName: string; customerCode: string; currency: string;
  providerStatedAR: number; reconstructedAR: number; variance: number;
  status: "match" | "drift";
};
type SelfRecon = {
  asOf: string;
  providers: string[];
  rows: SelfReconRow[];
  totals: {
    customers: number; inDrift: number; inMatch: number;
    providerStatedTotal: number; reconstructedTotal: number; variance: number;
  };
};

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
  const [error, setError] = useState<string>("");
  const [elapsedMs, setElapsedMs] = useState(0);

  // Provider-agnostic self-reconciliation — loads instantly on mount.
  const [selfRecon, setSelfRecon] = useState<SelfRecon | null>(null);
  const [selfReconLoading, setSelfReconLoading] = useState(true);
  const [selfReconErr, setSelfReconErr] = useState("");

  useEffect(() => {
    setSelfReconLoading(true);
    fetch("/api/reports/reconcile")
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then((d: SelfRecon) => setSelfRecon(d))
      .catch(e => setSelfReconErr(String(e)))
      .finally(() => setSelfReconLoading(false));
  }, []);

  const run = async () => {
    setRunning(true);
    setError("");
    setRows([]);
    setTotals(null);
    setAsOf(null);
    const started = Date.now();
    // Live elapsed counter so the user sees progress instead of a frozen page.
    const tick = setInterval(() => setElapsedMs(Date.now() - started), 250);
    try {
      const res = await fetch(`/api/qbo/reconcile-customers?driftOnly=${driftOnly}&tolerance=${tolerance}`);
      const text = await res.text();
      if (!res.ok) {
        setError(`Reconciliation failed (HTTP ${res.status}). ${text.slice(0, 300)}`);
        return;
      }
      let data: any;
      try { data = JSON.parse(text); }
      catch { setError(`Response was not JSON: ${text.slice(0, 200)}`); return; }
      setRows(data.rows || []);
      setTotals(data.totals || null);
      setAsOf(data.asOf || null);
    } catch (e: any) {
      setError(`Network error: ${e?.message || String(e)}. The endpoint may have exceeded the 5-minute timeout — try increasing tolerance or running during off-peak hours.`);
    } finally {
      clearInterval(tick);
      setRunning(false);
    }
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="mb-6">
        <Link href="/settings/integrations" className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-900 mb-3">
          <ChevronLeft size={14} /> Integrations
        </Link>
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Reconciliation</h1>
        <p className="text-sm text-stone-500 mt-1">
          Proves our receivables are reproduced from the data we captured — no dependence on the provider's own report. Works for QuickBooks, Xero and Sage.
        </p>
      </div>

      {/* ── Provider-agnostic reconciliation: our reconstruction vs provider-stated ── */}
      <Card className="mb-6">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-stone-900">Ledger reconciliation</h2>
            <p className="text-[12px] text-stone-500 mt-0.5">
              Our independent reconstruction (rebuilt from captured invoices, payments &amp; credits) vs each provider's stated open balance.
              {selfRecon && selfRecon.providers.length > 0 && (
                <> Source{selfRecon.providers.length > 1 ? "s" : ""}: <span className="font-medium text-stone-700">{selfRecon.providers.join(", ")}</span>.</>
              )}
            </p>
          </div>
          {selfRecon && (
            <Badge variant={Math.abs(selfRecon.totals.variance) < 1 ? "green" : "red"} size="sm">
              {Math.abs(selfRecon.totals.variance) < 1 ? "Reconciled" : `Δ ${fmt.money(selfRecon.totals.variance, selfRecon.rows[0]?.currency || "EUR")}`}
            </Badge>
          )}
        </div>

        {selfReconLoading && <div className="py-6 text-center text-sm text-stone-400">Computing reconciliation…</div>}
        {selfReconErr && (
          <div className="px-3 py-2 rounded-md bg-rose-50 ring-1 ring-rose-200 text-[12px] text-rose-700">
            Couldn't compute reconciliation: {selfReconErr}
          </div>
        )}

        {selfRecon && (
          <>
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="rounded-lg ring-1 ring-stone-200 p-3">
                <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-1">Provider stated AR</div>
                <div className="text-xl font-semibold text-stone-900 tabular-nums">{fmt.money(selfRecon.totals.providerStatedTotal, selfRecon.rows[0]?.currency || "EUR")}</div>
              </div>
              <div className="rounded-lg ring-1 ring-stone-200 p-3">
                <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-1">Our reconstruction</div>
                <div className="text-xl font-semibold text-stone-900 tabular-nums">{fmt.money(selfRecon.totals.reconstructedTotal, selfRecon.rows[0]?.currency || "EUR")}</div>
              </div>
              <div className="rounded-lg ring-1 ring-stone-200 p-3">
                <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-1">Variance</div>
                <div className={`text-xl font-semibold tabular-nums ${Math.abs(selfRecon.totals.variance) < 1 ? "text-emerald-700" : "text-rose-700"}`}>
                  {fmt.money(selfRecon.totals.variance, selfRecon.rows[0]?.currency || "EUR")}
                </div>
                <div className="text-[11px] text-stone-500 mt-1">{selfRecon.totals.inDrift} of {selfRecon.totals.customers} customers drift</div>
              </div>
            </div>

            {/* Explain any variance */}
            {Math.abs(selfRecon.totals.variance) >= 1 && (
              <div className="mb-4 px-3 py-2 rounded-md bg-amber-50 ring-1 ring-amber-200 text-[12px] text-amber-800">
                <div className="font-medium mb-1">A variance means a payment or credit isn't fully captured yet.</div>
                Our reconstruction rebuilds each invoice as <code>total − applied payments</code>. The most common cause of drift is a
                credit memo applied directly to an invoice (no payment transaction): the provider nets it into the invoice balance,
                but we never recorded it as an application — so our reconstruction still shows the invoice open. The drifted customers
                below show exactly where, and by how much.
              </div>
            )}

            {/* Drifted customers */}
            {selfRecon.rows.filter(r => r.status === "drift").length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
                      <th className="text-left font-semibold px-3 py-2">Customer</th>
                      <th className="text-right font-semibold px-3 py-2">Provider stated</th>
                      <th className="text-right font-semibold px-3 py-2">Reconstructed</th>
                      <th className="text-right font-semibold px-3 py-2">Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selfRecon.rows.filter(r => r.status === "drift").slice(0, 50).map(r => (
                      <tr key={r.customerId} className="border-b border-stone-100 hover:bg-stone-50">
                        <td className="px-3 py-2">
                          <Link href={`/customers/${r.customerId}`} className="text-stone-800 hover:text-brand-orange font-medium">{r.customerName}</Link>
                          <div className="text-[10px] text-stone-400 font-mono">{r.customerCode}</div>
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-stone-600">{fmt.money(r.providerStatedAR, r.currency)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-stone-600">{fmt.money(r.reconstructedAR, r.currency)}</td>
                        <td className="px-3 py-2 text-right tabular-nums font-bold text-rose-700">{fmt.money(r.variance, r.currency)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="py-6 text-center">
                <CheckCircle size={28} className="mx-auto text-emerald-500 mb-2" />
                <div className="text-sm text-stone-700 font-medium">Our ledger reproduces the provider exactly</div>
                <div className="text-[12px] text-stone-500 mt-1">All {selfRecon.totals.customers} customers reconcile within tolerance.</div>
              </div>
            )}
          </>
        )}
      </Card>

      {/* ── QBO live deep-check (re-fetches Customer.Balance per customer) ────────── */}
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-stone-900">QuickBooks live deep-check</h2>
        <p className="text-[12px] text-stone-500 mt-0.5">
          Optional QBO-only verification — re-fetches <code>Customer.Balance</code> live from QuickBooks to also catch sync staleness. One API call per customer.
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
        {running && (
          <div className="text-[11px] text-stone-500 mt-3 flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            Reconciling… {Math.floor(elapsedMs / 1000)}s elapsed. One live QBO call per customer at ~30 req/sec; please don't navigate away.
          </div>
        )}
        {error && (
          <div className="mt-3 px-3 py-2 rounded-md bg-rose-50 ring-1 ring-rose-200 text-[12px] text-rose-700 whitespace-pre-wrap">
            {error}
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
            <div className="text-[11px] text-stone-500 mt-2">{totals.customersInMatch} match · tolerance {tolerance}</div>
          </Card>
          <Card padding="md">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Our total net AR</div>
            <div className="text-2xl font-semibold text-stone-900 tabular-nums">{fmt.money(totals.ourTotalNetAR, "?")}</div>
          </Card>
          <Card padding="md">
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">QBO total net AR</div>
            <div className="text-2xl font-semibold text-stone-900 tabular-nums">{fmt.money(totals.qboTotalNetAR, "?")}</div>
            <div className={`text-[11px] mt-2 tabular-nums ${Math.abs(totals.ourTotalNetAR - totals.qboTotalNetAR) < 1 ? "text-emerald-600" : "text-rose-700"}`}>
              Δ {fmt.money(totals.ourTotalNetAR - totals.qboTotalNetAR, "?")}
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
                <th className="text-right font-semibold px-3 py-3 bg-stone-100" title="Customer.Balance — parent customer only, excludes sub-customer AR">QBO Parent</th>
                <th className="text-right font-semibold px-3 py-3 bg-stone-100" title="Customer.BalanceWithJobs — parent + all sub-customers. This is the field we reconcile against because our ledger aggregates sub-customers under the parent.">QBO incl. Jobs</th>
                <th className="text-right font-semibold px-3 py-3 bg-stone-100">Δ vs Jobs</th>
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
                  <td className="px-3 py-2.5 text-right tabular-nums text-stone-500 bg-stone-50">{r.qboBalance != null ? fmt.money(r.qboBalance, r.currency) : "—"}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums font-semibold bg-stone-50">{r.qboBalanceWithJobs != null ? fmt.money(r.qboBalanceWithJobs, r.currency) : "—"}</td>
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
              {totals.customersInMatch} of {totals.customersChecked} customers match within {tolerance} tolerance.
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
