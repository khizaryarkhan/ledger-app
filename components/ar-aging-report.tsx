"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Card, Button, Badge } from "@/components/ui";
import { fmt } from "@/lib/format";
import { Calendar, FileText, RefreshCw, AlertTriangle, CheckCircle, ChevronDown, ChevronRight } from "lucide-react";
import { useData } from "@/components/data-provider";

type Bucket = "Current" | "1-30" | "31-60" | "61-90" | "91+";
const BUCKETS: Bucket[] = ["Current", "1-30", "31-60", "61-90", "91+"];

type DetailRow = {
  customerId: string;
  customerQboId: string | null;
  projectId: string | null;
  txnType: "Invoice" | "Credit Memo";
  txnNumber: string;
  txnId: string;
  qboId: string | null;
  txnDate: string;
  dueDate: string;
  originalAmount: number;
  applied: { paymentId: string; paymentQboId: string | null; paymentDate: string; amount: number }[];
  totalApplied: number;
  openBalance: number;
  daysPastDue: number;
  bucket: Bucket;
  currency: string;
  flags: string[];
};

type SummaryRow = {
  customerId: string;
  customerQboId: string | null;
  buckets: Record<Bucket, number>;
  total: number;
};

type AgingPayload = {
  asOf: string;
  detail: DetailRow[];
  summary: SummaryRow[];
  grandTotals: Record<Bucket, number> & { total: number };
  flags: {
    missingDueDate: number;
    negativeCustomerBalances: string[];
    unappliedCredits: number;
    voidedSuspected: number;
  };
  meta: {
    invoiceCount: number;
    creditMemoCount: number;
    paymentCount: number;
    applicationCount: number;
  };
  source?: "qbo" | "local";
  qboFallbackReason?: string;
};

type ReconcilePayload = {
  asOf: string;
  balanceSheetAR: number | null;
  ledgerAR: number;
  variance: number | null;
  explanation: string;
};

function bucketColor(b: Bucket): string {
  switch (b) {
    case "Current": return "text-stone-700";
    case "1-30":    return "text-amber-700";
    case "31-60":   return "text-orange-700";
    case "61-90":   return "text-rose-700";
    case "91+":     return "text-rose-900 font-semibold";
    default:        return "text-stone-500";
  }
}

export function ArAgingReport() {
  const { customers, orgSettings } = useData() as any;
  const ccy: string = orgSettings?.currency ?? "EUR";

  const todayIso = new Date().toISOString().slice(0, 10);
  const [asOf, setAsOf] = useState(todayIso);
  const [view, setView] = useState<"summary" | "detail">("summary");
  const [includeClosed, setIncludeClosed] = useState(false);
  // QBO offers two aging methods: Report_Date (age by report-date - due-date)
  // and Current (age by today's date - due-date). UI defaults vary, so we
  // expose the toggle to match whatever the user is comparing against.
  const [agingMethod, setAgingMethod] = useState<"Report_Date" | "Current">("Report_Date");
  // Source selector. Default = "auto" (QBO API for historical, local engine
  // for today). User can force "qbo" to always hit QBO live or "local" to
  // always use our engine — useful for verifying reconciliation behaviour.
  const [sourceMode, setSourceMode] = useState<"auto" | "qbo" | "local">("auto");
  const [data, setData] = useState<AgingPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [recon, setRecon] = useState<ReconcilePayload | null>(null);
  const [reconLoading, setReconLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = () => {
    setLoading(true);
    const qs = new URLSearchParams({
      asOf,
      includeClosed: String(includeClosed),
      agingMethod,
    });
    if (sourceMode === "qbo")   qs.set("source", "qbo");
    if (sourceMode === "local") qs.set("source", "local");
    fetch(`/api/reports/ar-aging?${qs.toString()}`)
      .then(r => r.ok ? r.json() : null)
      .then(setData)
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [asOf, includeClosed, agingMethod, sourceMode]);

  const customerById = useMemo(() => new Map<string, any>(customers.map((c: any) => [c.id, c])), [customers]);

  const runReconcile = () => {
    setReconLoading(true);
    setRecon(null);
    fetch(`/api/reports/ar-reconcile?asOf=${asOf}`)
      .then(r => r.ok ? r.json() : null)
      .then(setRecon)
      .finally(() => setReconLoading(false));
  };

  const toggleExpanded = (customerId: string) => setExpanded(prev => {
    const n = new Set(prev);
    n.has(customerId) ? n.delete(customerId) : n.add(customerId);
    return n;
  });

  const isHistorical = asOf !== todayIso;

  return (
    <div className="space-y-3">
      {/* Top control bar */}
      <Card padding="sm">
        <div className="flex items-end gap-3 flex-wrap">
          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Report Date</label>
            <div className="flex items-center gap-1">
              <Calendar size={13} className="text-stone-400" />
              <input
                type="date"
                value={asOf}
                max={todayIso}
                onChange={e => setAsOf(e.target.value || todayIso)}
                className="h-8 px-2 text-sm rounded-md ring-1 ring-stone-200 focus:ring-stone-400 focus:outline-none bg-white"
              />
              {isHistorical && (
                <button onClick={() => setAsOf(todayIso)} className="text-[10px] text-stone-400 hover:text-stone-700 ml-1 font-medium">
                  Today
                </button>
              )}
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">View</label>
            <div className="flex h-8 rounded-md ring-1 ring-stone-200 overflow-hidden">
              <button onClick={() => setView("summary")}
                className={`px-3 text-[12px] font-medium transition-colors ${view === "summary" ? "bg-stone-900 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}>
                Summary
              </button>
              <button onClick={() => setView("detail")}
                className={`px-3 text-[12px] font-medium transition-colors ${view === "detail" ? "bg-stone-900 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}>
                Detail
              </button>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Source</label>
            <div className="flex h-8 rounded-md ring-1 ring-stone-200 overflow-hidden">
              <button onClick={() => setSourceMode("auto")}
                className={`px-3 text-[12px] font-medium transition-colors ${sourceMode === "auto" ? "bg-stone-900 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}
                title="QBO API for historical dates, local engine for today">
                Auto
              </button>
              <button onClick={() => setSourceMode("qbo")}
                className={`px-3 text-[12px] font-medium transition-colors ${sourceMode === "qbo" ? "bg-stone-900 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}
                title="Always fetch QBO AgedReceivableDetail live">
                QBO
              </button>
              <button onClick={() => setSourceMode("local")}
                className={`px-3 text-[12px] font-medium transition-colors ${sourceMode === "local" ? "bg-stone-900 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}
                title="Compute locally from synced invoices, payments, CMs, JEs, deposits (with application netting)">
                Local
              </button>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">Aging method</label>
            <div className="flex h-8 rounded-md ring-1 ring-stone-200 overflow-hidden">
              <button onClick={() => setAgingMethod("Report_Date")}
                className={`px-3 text-[12px] font-medium transition-colors ${agingMethod === "Report_Date" ? "bg-stone-900 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}>
                Report date
              </button>
              <button onClick={() => setAgingMethod("Current")}
                className={`px-3 text-[12px] font-medium transition-colors ${agingMethod === "Current" ? "bg-stone-900 text-white" : "bg-white text-stone-600 hover:bg-stone-50"}`}>
                Current
              </button>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
              Diagnostics
            </label>
            <label className="flex items-center gap-1.5 h-8 px-2 rounded-md ring-1 ring-stone-200 bg-white cursor-pointer">
              <input type="checkbox" checked={includeClosed} onChange={e => setIncludeClosed(e.target.checked)}
                className="rounded" />
              <span className="text-[12px] text-stone-700">Show closed transactions</span>
            </label>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={load} disabled={loading}>
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </Button>
            <Button variant="secondary" size="sm" onClick={runReconcile} disabled={reconLoading}>
              {reconLoading ? "Checking…" : "Reconcile to Balance Sheet"}
            </Button>
          </div>
        </div>
      </Card>

      {/* Reconciliation card */}
      {recon && (
        <Card padding="sm">
          <div className="flex items-center gap-3">
            {recon.variance !== null && Math.abs(recon.variance) < 1
              ? <CheckCircle size={16} className="text-emerald-600 shrink-0" />
              : <AlertTriangle size={16} className="text-amber-600 shrink-0" />}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-4 text-[12px]">
                <div>
                  <span className="text-stone-500">QBO Balance Sheet AR: </span>
                  <span className="font-semibold tabular-nums text-stone-900">
                    {recon.balanceSheetAR !== null ? fmt.money(recon.balanceSheetAR, ccy) : "—"}
                  </span>
                </div>
                <div>
                  <span className="text-stone-500">Our AR Aging total: </span>
                  <span className="font-semibold tabular-nums text-stone-900">{fmt.money(recon.ledgerAR, ccy)}</span>
                </div>
                {recon.variance !== null && (
                  <div>
                    <span className="text-stone-500">Variance: </span>
                    <span className={`font-semibold tabular-nums ${Math.abs(recon.variance) < 1 ? "text-emerald-700" : "text-rose-700"}`}>
                      {fmt.money(recon.variance, ccy)}
                    </span>
                  </div>
                )}
              </div>
              <div className="text-[11px] text-stone-500 mt-1">{recon.explanation}</div>
            </div>
          </div>
        </Card>
      )}

      {/* Loading state */}
      {loading && (
        <Card><div className="text-center text-stone-400 text-sm py-8">Computing AR Aging as of {asOf}…</div></Card>
      )}

      {/* Empty state */}
      {!loading && data && data.summary.length === 0 && (
        <Card><div className="text-center text-stone-400 text-sm py-8">No open AR as of {asOf}.</div></Card>
      )}

      {/* Flags banner */}
      {!loading && data && (data.flags.missingDueDate > 0 || data.flags.unappliedCredits > 0 || data.flags.voidedSuspected > 0) && (
        <Card padding="sm">
          <div className="flex items-start gap-2 text-[11px] text-stone-600">
            <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              {data.flags.missingDueDate > 0 && (
                <span className="mr-3"><strong>{data.flags.missingDueDate}</strong> transaction(s) missing due date (using transaction date)</span>
              )}
              {data.flags.unappliedCredits > 0 && (
                <span className="mr-3"><strong>{data.flags.unappliedCredits}</strong> unapplied credit memo(s)</span>
              )}
              {data.flags.voidedSuspected > 0 && (
                <span><strong>{data.flags.voidedSuspected}</strong> suspected voided invoice(s) excluded</span>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* SUMMARY VIEW */}
      {!loading && data && view === "summary" && data.summary.length > 0 && (
        <Card padding="none">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
                <th className="text-left font-semibold px-4 py-3">Customer</th>
                {BUCKETS.map(b => (
                  <th key={b} className="text-right font-semibold px-3 py-3 w-28">{b}</th>
                ))}
                <th className="text-right font-semibold px-4 py-3 w-32">Total</th>
              </tr>
            </thead>
            <tbody>
              {data.summary.map(row => {
                const cust = customerById.get(row.customerId);
                const isExpanded = expanded.has(row.customerId);
                const custDetail = data.detail.filter(d => d.customerId === row.customerId)
                  .sort((a, b) => (a.dueDate > b.dueDate ? 1 : -1));
                // Fallback name: QBO's customer name carried on the row's flags
                // when our customers table has no matching record (sub-customer
                // that hasn't been imported yet, etc.). Strip the prefix.
                const qboNameFlag = custDetail
                  .map(d => d.flags.find(f => f.startsWith("qbo-name:")))
                  .find(Boolean);
                const qboFallbackName = qboNameFlag?.slice("qbo-name:".length);
                const displayName = cust?.name || qboFallbackName || row.customerId;
                const isExternal = !cust;
                return (
                  <>
                    <tr key={row.customerId}
                      className="border-b border-stone-100 hover:bg-stone-50 cursor-pointer"
                      onClick={() => toggleExpanded(row.customerId)}
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {isExpanded ? <ChevronDown size={13} className="text-stone-400" /> : <ChevronRight size={13} className="text-stone-400" />}
                          {isExternal ? (
                            <span className="text-stone-800 font-medium">{displayName}</span>
                          ) : (
                            <Link href={`/customers/${row.customerId}`}
                              onClick={(e) => e.stopPropagation()}
                              className="text-stone-800 hover:text-brand-orange font-medium">
                              {displayName}
                            </Link>
                          )}
                          {isExternal && (
                            <span className="text-[10px] text-stone-400 ml-1">(not synced)</span>
                          )}
                        </div>
                      </td>
                      {BUCKETS.map(b => (
                        <td key={b} className={`px-3 py-3 text-right tabular-nums ${row.buckets[b] !== 0 ? bucketColor(b) : "text-stone-300"}`}>
                          {Math.abs(row.buckets[b]) > 0.005 ? fmt.money(row.buckets[b], ccy) : "—"}
                        </td>
                      ))}
                      <td className={`px-4 py-3 text-right tabular-nums font-semibold ${row.total < 0 ? "text-amber-700" : "text-stone-900"}`}>
                        {fmt.money(row.total, ccy)}
                      </td>
                    </tr>
                    {isExpanded && custDetail.map(d => (
                      <tr key={d.txnId} className="border-b border-stone-100 bg-stone-50/50">
                        <td className="px-4 py-2 pl-12 text-[12px] text-stone-600">
                          <Link href={`/invoices/${d.txnId}`} className="hover:text-brand-orange">
                            <span className="font-mono">{d.txnNumber}</span>
                            <span className="text-stone-400 ml-2">{d.txnType}</span>
                            {d.dueDate && <span className="text-stone-400 ml-2">due {new Date(d.dueDate + "T00:00:00Z").toLocaleDateString("en-IE", { day: "2-digit", month: "short" })}</span>}
                          </Link>
                        </td>
                        {BUCKETS.map(b => (
                          <td key={b} className={`px-3 py-2 text-right tabular-nums text-[12px] ${d.bucket === b ? bucketColor(b) : "text-stone-300"}`}>
                            {d.bucket === b ? fmt.money(d.openBalance, d.currency) : "—"}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right tabular-nums text-[12px] text-stone-700">
                          {fmt.money(d.openBalance, d.currency)}
                        </td>
                      </tr>
                    ))}
                  </>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-stone-300 bg-stone-50">
                <td className="px-4 py-3 font-semibold text-stone-900">TOTAL</td>
                {BUCKETS.map(b => (
                  <td key={b} className={`px-3 py-3 text-right tabular-nums font-semibold ${data.grandTotals[b] !== 0 ? bucketColor(b) : "text-stone-300"}`}>
                    {Math.abs(data.grandTotals[b]) > 0.005 ? fmt.money(data.grandTotals[b], ccy) : "—"}
                  </td>
                ))}
                <td className="px-4 py-3 text-right tabular-nums font-bold text-stone-900">
                  {fmt.money(data.grandTotals.total, ccy)}
                </td>
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      {/* DETAIL VIEW */}
      {!loading && data && view === "detail" && data.detail.length > 0 && (
        <Card padding="none">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-stone-500 border-b border-stone-200">
                <th className="text-left font-semibold px-3 py-2.5">Customer</th>
                <th className="text-left font-semibold px-3 py-2.5">Type</th>
                <th className="text-left font-semibold px-3 py-2.5">Number</th>
                <th className="text-left font-semibold px-3 py-2.5">Txn Date</th>
                <th className="text-left font-semibold px-3 py-2.5">Due Date</th>
                <th className="text-right font-semibold px-3 py-2.5">Original</th>
                <th className="text-right font-semibold px-3 py-2.5">Applied</th>
                <th className="text-right font-semibold px-3 py-2.5">Open Balance</th>
                <th className="text-right font-semibold px-3 py-2.5">Days Past Due</th>
                <th className="text-left font-semibold px-3 py-2.5">Bucket</th>
                <th className="text-left font-semibold px-3 py-2.5">Flags</th>
              </tr>
            </thead>
            <tbody>
              {data.detail
                .sort((a, b) => {
                  const cA = customerById.get(a.customerId)?.name || "";
                  const cB = customerById.get(b.customerId)?.name || "";
                  if (cA !== cB) return cA.localeCompare(cB);
                  return a.dueDate.localeCompare(b.dueDate);
                })
                .map(d => {
                  const cust = customerById.get(d.customerId);
                  return (
                    <tr key={d.txnId} className="border-b border-stone-100 hover:bg-stone-50 text-[12px]">
                      <td className="px-3 py-2 text-stone-700 truncate max-w-[180px]">
                        <Link href={`/customers/${d.customerId}`} className="hover:text-brand-orange">{cust?.name || d.customerId}</Link>
                      </td>
                      <td className="px-3 py-2 text-stone-600">{d.txnType}</td>
                      <td className="px-3 py-2 text-stone-700 font-mono">
                        <Link href={`/invoices/${d.txnId}`} className="hover:text-brand-orange">{d.txnNumber}</Link>
                      </td>
                      <td className="px-3 py-2 text-stone-600 tabular-nums">
                        {new Date(d.txnDate + "T00:00:00Z").toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "2-digit" })}
                      </td>
                      <td className="px-3 py-2 text-stone-600 tabular-nums">
                        {new Date(d.dueDate + "T00:00:00Z").toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "2-digit" })}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-stone-600">{fmt.money(d.originalAmount, d.currency)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-stone-600">
                        {d.totalApplied > 0.005 ? fmt.money(d.totalApplied, d.currency) : "—"}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${d.openBalance < 0 ? "text-amber-700" : "text-stone-900"}`}>
                        {fmt.money(d.openBalance, d.currency)}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums ${d.daysPastDue > 0 ? "text-rose-700" : "text-stone-500"}`}>
                        {d.daysPastDue > 0 ? d.daysPastDue : "—"}
                      </td>
                      <td className={`px-3 py-2 ${bucketColor(d.bucket)}`}>{d.bucket}</td>
                      <td className="px-3 py-2">
                        {d.flags.length > 0 && d.flags.map(f => (
                          <Badge key={f} variant="amber" size="sm">{f}</Badge>
                        ))}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-stone-300 bg-stone-50">
                <td colSpan={7} className="px-3 py-3 text-right font-semibold text-stone-900">GRAND TOTAL</td>
                <td className="px-3 py-3 text-right tabular-nums font-bold text-stone-900">{fmt.money(data.grandTotals.total, ccy)}</td>
                <td colSpan={3} />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      {/* Footer metadata */}
      {!loading && data && (
        <div className="text-[10px] text-stone-400 px-2">
          {data.meta.invoiceCount} invoice(s) + {data.meta.creditMemoCount} credit memo(s) open as of {asOf}.
          {data.source === "qbo"
            ? <> Sourced directly from QBO AgedReceivableDetail (Report Date / Accrual).</>
            : <> Computed from {data.meta.paymentCount} payment(s) and {data.meta.applicationCount} application(s). Method: Report Date / Accrual basis.</>}
          {data.qboFallbackReason && (
            <span className="text-amber-600"> · QBO call failed, fell back to local engine ({data.qboFallbackReason}).</span>
          )}
        </div>
      )}
    </div>
  );
}
