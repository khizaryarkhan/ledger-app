"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { BookOpen, Loader } from "lucide-react";
import { txnTypeLabel } from "@/lib/accounting/doc-format";
import { formatDateShort, localToday } from "@/lib/format";
import { useFiscalFrom } from "@/components/use-report-from";
import { useData } from "@/components/data-provider";
import { listTable, listRow, listCell, listNumCell } from "@/components/list-view";
import { ReportShell } from "@/components/ui";
import { controlCompact, SelectField } from "@/components/form-kit";
import { buildGeneralLedgerModel } from "@/lib/reports/builders/general-ledger";

const today = () => localToday();
// NOT fmt.num2 — this report's negative figures are parenthesized
// ("(100.00)"), a display convention distinct from fmt's leading-minus
// rule. Kept exactly as it was (this is a visual-consistency pass on the
// table shell, not a change to the money-display rule); flagged in the
// handback report as a candidate for its own follow-up.
const money = (n: number) => (n < 0 ? `(${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })})` : n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export default function GeneralLedgerPage() {
  return <Suspense fallback={<div className="p-6 text-sm text-stone-500">Loading…</div>}><GeneralLedgerInner /></Suspense>;
}

function GeneralLedgerInner() {
  // Drilled into from a report number: ?accountId=&from=&to=
  const sp = useSearchParams();
  const { customers, projects } = useData() as { customers: any[]; projects: any[] };
  const [accounts, setAccounts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [accountId, setAccountId] = useState(sp.get("accountId") || "");
  const [customerId, setCustomerId] = useState(sp.get("customerId") || "");
  const [projectId, setProjectId] = useState(sp.get("projectId") || "");
  const [nameId, setNameId] = useState(sp.get("nameId") || "");
  const [from, setFrom] = useFiscalFrom(sp.get("from"));
  const [to, setTo] = useState(sp.get("to") || today());
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [showFx, setShowFx] = useState(false);

  useEffect(() => { fetch("/api/accounting/accounts").then(r => r.json()).then(a => setAccounts(Array.isArray(a) ? a : [])).catch(() => {}); }, []);
  useEffect(() => { fetch("/api/payables/suppliers").then(r => r.json()).then(d => setSuppliers(Array.isArray(d) ? d : (d?.suppliers ?? []))).catch(() => {}); }, []);

  // The filters that produce a view, as one string: stored with the data so an export is only offered when what is
  // on screen was fetched with exactly the filters now selected (overlapping requests can otherwise cross over).
  const queryString = () => {
    const qs = new URLSearchParams({ statement: "general-ledger", from, to });
    if (accountId) qs.set("accountId", accountId);
    if (customerId) qs.set("customerId", customerId);
    if (projectId) qs.set("projectId", projectId);
    if (nameId) qs.set("nameId", nameId);
    return qs.toString();
  };
  const [dataKey, setDataKey] = useState("");

  async function run() {
    setLoading(true);
    try {
      const key = queryString();
      const d = await fetch(`/api/financials?${key}`).then(r => r.json());
      setData(d);
      setDataKey(key);
    } finally { setLoading(false); }
  }
  useEffect(() => { run(); /* eslint-disable-next-line */ }, [accountId, customerId, projectId, nameId, from, to]);

  const curr = data?.meta?.currency || "";
  const anyFx = useMemo(() => (data?.accounts ?? []).some((a: any) => a.rows.some((r: any) => r.currency)), [data]);

  // Export / Print / PDF: the response on screen, with the filters that produced it. Held back while a
  // refresh is running so a stale view is never exported under new filters.
  const exportModel = useMemo(() => {
    // Not while refreshing, not for a failed response, and not when the data on screen was fetched with other filters.
    if (!data || data.error || loading || dataKey !== queryString()) return null;
    const params: { label: string; value: string }[] = [];
    // A filter is always stated, even when its name is not in the lookup list (e.g. a drill-in for an inactive account).
    const named = (id: string, label: string, name: string | undefined) => { if (id) params.push({ label, value: name ?? "(filtered — name unavailable)" }); };
    const acct = accounts.find((a) => a.id === accountId);
    named(accountId, "Account", acct ? `${acct.code ? `${acct.code} · ` : ""}${acct.name}` : undefined);
    named(customerId, "Customer", customers.find((c: any) => c.id === customerId)?.name);
    const sup = suppliers.find((s: any) => s.id === nameId);
    named(nameId, "Supplier", sup ? (sup.displayName || sup.name) : undefined);
    named(projectId, "Project", projects.find((p: any) => p.id === projectId)?.name);
    try {
      return buildGeneralLedgerModel(data, {
        title: "General Ledger",
        periodLine: `For the period ${formatDateShort(from)} to ${formatDateShort(to)}`,
        params,
        showFx,
      });
    } catch (e) {
      console.error("Could not build the export model", e);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dataKey, loading, accounts, accountId, customers, customerId, suppliers, nameId, projects, projectId, from, to, showFx]);

  return (
    <ReportShell title="General Ledger" sub={`${data?.meta?.entity ?? ""} — every posting with its type, document and running balance.`} icon={BookOpen} onRefresh={run} loading={loading} exportModel={exportModel}>
      <div className="flex flex-wrap items-end gap-3 mb-5">
        <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">Account</label>
          <SelectField value={accountId} onChange={e => setAccountId(e.target.value)} className="h-8 min-w-[220px] text-[12px]">
            <option value="">All accounts</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ""}{a.name}</option>)}
          </SelectField>
        </div>
        <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">Customer</label>
          <SelectField value={customerId} onChange={e => setCustomerId(e.target.value)} className="h-8 min-w-[180px] text-[12px]">
            <option value="">All customers</option>
            {customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </SelectField>
        </div>
        <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">Supplier</label>
          <SelectField value={nameId} onChange={e => setNameId(e.target.value)} className="h-8 min-w-[180px] text-[12px]">
            <option value="">All suppliers</option>
            {suppliers.map((s: any) => <option key={s.id} value={s.id}>{s.displayName || s.name}</option>)}
          </SelectField>
        </div>
        <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">Project</label>
          <SelectField value={projectId} onChange={e => setProjectId(e.target.value)} className="h-8 min-w-[180px] text-[12px]">
            <option value="">All projects</option>
            {projects.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </SelectField>
        </div>
        <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">From</label><input type="date" value={from} onChange={e => setFrom(e.target.value)} className={controlCompact} /></div>
        <div><label className="block text-[11px] uppercase tracking-wider text-stone-500 mb-1">To</label><input type="date" value={to} onChange={e => setTo(e.target.value)} className={controlCompact} /></div>
        {anyFx && (
          <label className="flex items-center gap-1.5 text-[12px] text-stone-400 mb-2 cursor-pointer">
            <input type="checkbox" checked={showFx} onChange={e => setShowFx(e.target.checked)} /> Show foreign currency
          </label>
        )}
        {loading && <Loader size={16} className="animate-spin text-stone-500 mb-2" />}
      </div>

      {!data ? null : (data.accounts ?? []).length === 0 ? (
        <div className="rounded-xl bg-stone-900 border border-stone-800 p-8 text-center text-stone-500 text-sm">No postings in this period.</div>
      ) : (
        <div className="space-y-6">
          {data.accounts.map((a: any) => (
            <div key={a.account.id} className="rounded-xl bg-stone-900 border border-stone-800 overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800 bg-stone-950/40">
                <div className="font-semibold text-stone-100 text-[14px]">{a.account.code ? `${a.account.code} · ` : ""}{a.account.name}</div>
                <div className="text-[12px] text-stone-500">Opening <span className="tabular-nums text-stone-300">{money(a.opening)}</span></div>
              </div>
              <div className="overflow-x-auto">
                <table className={`${listTable} min-w-[720px]`}>
                  <thead>
                    <tr className="text-[11px] font-medium text-stone-500 border-b border-stone-800">
                      <th className="text-left px-2 py-2">Date</th>
                      <th className="text-left px-2 py-2">Type</th>
                      <th className="text-left px-2 py-2">No.</th>
                      <th className="text-left px-2 py-2">Name / Memo</th>
                      <th className="text-right px-2 py-2">Debit</th>
                      <th className="text-right px-2 py-2">Credit</th>
                      <th className="text-right px-2 py-2">Balance</th>
                      {showFx && anyFx && (
                        <>
                          <th className="text-right px-2 py-2">Foreign amount</th>
                          <th className="text-left px-2 py-2">Ccy</th>
                          <th className="text-right px-2 py-2">Rate</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {a.rows.map((r: any, i: number) => (
                      <tr key={i} className={listRow()}>
                        <td className={`${listCell} text-stone-400 whitespace-nowrap`}>{formatDateShort(r.date)}</td>
                        <td className={listCell}>
                          <span className="text-[11px] font-medium text-teal-300 bg-teal-500/10 border border-teal-800/40 rounded px-1.5 py-0.5">{txnTypeLabel(r.sourceType)}</span>
                        </td>
                        <td className={`${listCell} font-mono text-[12px]`}>
                          {r.entryId ? <Link href={`/accounting/transactions/${r.entryId}`} className="text-teal-400 hover:underline">{r.docNumber}</Link> : <span className="text-stone-400">{r.docNumber}</span>}
                        </td>
                        <td className={`${listCell} text-stone-300 max-w-[280px] truncate`}>{r.name ? <span className="text-stone-200">{r.name}</span> : null}{r.name && r.memo ? " · " : ""}{r.memo ? <span className="text-stone-500">{r.memo}</span> : (!r.name ? <span className="text-stone-600">—</span> : null)}</td>
                        <td className={`${listNumCell} text-stone-300`}>{r.debit ? money(r.debit) : ""}</td>
                        <td className={`${listNumCell} text-stone-300`}>{r.credit ? money(r.credit) : ""}</td>
                        <td className={`${listNumCell} text-stone-200`}>{money(r.balance)}</td>
                        {showFx && anyFx && (
                          <>
                            <td className={`${listNumCell} text-stone-400`}>{r.currency ? money(r.fxDebit || r.fxCredit || 0) : ""}</td>
                            <td className={`${listCell} text-stone-500`}>{r.currency ?? ""}</td>
                            <td className={`${listNumCell} text-stone-500`}>{r.currency ? r.exchangeRate : ""}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-stone-800 font-semibold text-white">
                      <td className="px-4 py-2" colSpan={6}>Closing balance</td>
                      <td className="px-4 py-2 text-right tabular-nums">{money(a.closing)} {curr}</td>
                      {showFx && anyFx && <td colSpan={3} />}
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </ReportShell>
  );
}
