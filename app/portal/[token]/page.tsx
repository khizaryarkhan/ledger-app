"use client";

import { useState, useEffect, useRef } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

type Invoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  balance: number;
  total: number;
  alreadyDisputed: boolean;
  existingPromise: string | null;
  hasPdf: boolean;
};

type PaidInvoice = {
  id: string;
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  currency: string;
  total: number;
  paid: number;
};

type PortalData = {
  org: { name: string; logoUrl: string | null; showPaymentHistory: boolean };
  customer: { name: string };
  invoices: Invoice[];
  paymentHistory: PaidInvoice[];
};

type RowAction = {
  type: "none" | "commit" | "dispute";
  commitDate: string;
  comment: string;
  disputeCategory: string;
};

type SubmittedSummary = {
  commitments: { invoiceNumber: string; date: string }[];
  disputes: { invoiceNumber: string; category: string }[];
};

const DISPUTE_CATEGORIES = [
  "Wrong Amount",
  "Already Paid",
  "Goods / Service Issue",
  "Duplicate Invoice",
  "Other",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function money(n: number, ccy: string) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency", currency: ccy || "EUR", maximumFractionDigits: 2,
  }).format(n);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return "—";
  try { return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }); }
  catch { return d; }
}

function isOverdue(dueDate: string | null): boolean {
  if (!dueDate) return false;
  return new Date(dueDate) < new Date(new Date().toDateString());
}

function daysOverdue(dueDate: string | null): number {
  if (!dueDate) return 0;
  const diff = new Date(new Date().toDateString()).getTime() - new Date(dueDate).getTime();
  return Math.max(0, Math.ceil(diff / 86400000));
}

const REFERRAL_KEY = "pa_referral_dismissed";
const todayStr = () => new Date().toISOString().slice(0, 10);

// ── Main component ────────────────────────────────────────────────────────────

export default function PortalPage({ params }: { params: { token: string } }) {
  const [data, setData]         = useState<PortalData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);
  const [tab, setTab]           = useState<"open" | "history">("open");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]         = useState(false);
  const [summary, setSummary]   = useState<SubmittedSummary>({ commitments: [], disputes: [] });
  const [referralVisible, setReferralVisible] = useState(false);

  // Per-row action state
  const [rowActions, setRowActions] = useState<Record<string, RowAction>>({});
  // Selected invoice IDs
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Batch bar state
  const [batchDate, setBatchDate]     = useState("");
  const [batchComment, setBatchComment] = useState("");
  const [batchDispute, setBatchDispute] = useState("");

  useEffect(() => {
    fetch(`/api/portal/${params.token}`)
      .then(async res => {
        if (res.status === 410) { const d = await res.json(); setErrorMsg(d.error || "expired"); return; }
        if (!res.ok) { setErrorMsg("error"); return; }
        const d: PortalData = await res.json();
        setData(d);
        const init: Record<string, RowAction> = {};
        d.invoices.forEach(i => { init[i.id] = { type: "none", commitDate: "", comment: "", disputeCategory: "" }; });
        setRowActions(init);
        const dismissed = typeof window !== "undefined" && localStorage.getItem(REFERRAL_KEY);
        if (!dismissed) setReferralVisible(true);
      })
      .catch(() => setErrorMsg("error"))
      .finally(() => setLoading(false));
  }, [params.token]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const invoices         = data?.invoices ?? [];
  const totalOutstanding = invoices.reduce((s, i) => s + i.balance, 0);
  const overdueInvs      = invoices.filter(i => isOverdue(i.dueDate));
  const totalOverdue     = overdueInvs.reduce((s, i) => s + i.balance, 0);
  const currency         = invoices[0]?.currency || "EUR";

  const actionCount = Object.values(rowActions).filter(a => {
    if (a.type === "commit") return !!a.commitDate;
    if (a.type === "dispute") return !!a.disputeCategory;
    return false;
  }).length;

  const canSubmit = actionCount > 0;

  // ── Row helpers ───────────────────────────────────────────────────────────

  function patchRow(id: string, patch: Partial<RowAction>) {
    setRowActions(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function handleSelectAll() {
    const eligible = invoices.filter(i => !i.alreadyDisputed).map(i => i.id);
    if (selected.size === eligible.length) setSelected(new Set());
    else setSelected(new Set(eligible));
  }

  // Apply batch values to all selected rows
  function applyBatch() {
    if (selected.size === 0) return;
    setRowActions(prev => {
      const next = { ...prev };
      selected.forEach(id => {
        const current = next[id] ?? { type: "none" as const, commitDate: "", comment: "", disputeCategory: "" };
        if (batchDate) {
          next[id] = { ...current, type: "commit", commitDate: batchDate, comment: batchComment || current.comment };
        } else if (batchDispute) {
          next[id] = { ...current, type: "dispute", disputeCategory: batchDispute, comment: batchComment || current.comment };
        } else if (batchComment) {
          next[id] = { ...current, comment: batchComment };
        }
      });
      return next;
    });
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  async function submit() {
    setSubmitting(true);
    const responses: any[] = [];
    const committed: SubmittedSummary["commitments"] = [];
    const disputed:  SubmittedSummary["disputes"]    = [];

    invoices.forEach(inv => {
      const a = rowActions[inv.id];
      if (!a) return;
      if (a.type === "commit" && a.commitDate) {
        responses.push({ invoiceId: inv.id, promise: { date: a.commitDate, note: a.comment || undefined } });
        committed.push({ invoiceNumber: inv.invoiceNumber, date: a.commitDate });
      } else if (a.type === "dispute" && a.disputeCategory) {
        responses.push({ invoiceId: inv.id, dispute: { category: a.disputeCategory, reason: a.comment || undefined } });
        disputed.push({ invoiceNumber: inv.invoiceNumber, category: a.disputeCategory });
      }
    });

    if (responses.length === 0) { setSubmitting(false); return; }

    try {
      const res = await fetch(`/api/portal/${params.token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses }),
      });
      if (res.ok) { setSummary({ commitments: committed, disputes: disputed }); setDone(true); }
      else { const d = await res.json().catch(() => ({})); setErrorMsg(d.error || "error"); }
    } catch { setErrorMsg("error"); }
    finally  { setSubmitting(false); }
  }

  // ── Loading / error ───────────────────────────────────────────────────────

  if (loading) return (
    <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-600 rounded-full animate-spin" />
        <p className="text-sm text-stone-400">Loading your account…</p>
      </div>
    </div>
  );

  if (errorMsg) {
    const msg = errorMsg === "expired" || errorMsg === "completed"
      ? "This link has already been used or has expired. Please contact your account manager for a new link."
      : errorMsg === "not_found"
      ? "This link is invalid. Please check the URL or contact your account manager."
      : "Something went wrong. Please try again or contact us.";
    return (
      <div className="min-h-screen bg-[#F5F6FA] flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center">
          <div className="w-14 h-14 rounded-full bg-white shadow-sm flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
            </svg>
          </div>
          <h1 className="text-base font-semibold text-stone-800 mb-1">Link unavailable</h1>
          <p className="text-sm text-stone-500 leading-relaxed">{msg}</p>
        </div>
      </div>
    );
  }

  // ── Confirmation ──────────────────────────────────────────────────────────

  if (done) return (
    <div className="min-h-screen bg-[#F5F6FA] flex flex-col">
      <PortalHeader org={data?.org} />
      <div className="flex-1 max-w-3xl mx-auto w-full px-4 py-10">
        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-6 mb-5 flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
            </svg>
          </div>
          <div>
            <h1 className="text-base font-semibold text-stone-900">Response submitted</h1>
            <p className="text-sm text-stone-500 mt-0.5">
              Thank you, <span className="font-medium text-stone-700">{data?.customer.name}</span>. Your account manager has been notified.
            </p>
          </div>
        </div>

        {summary.commitments.length > 0 && (
          <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-5 mb-4">
            <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Payment commitments</h2>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-stone-100">
                {summary.commitments.map((c, i) => (
                  <tr key={i}>
                    <td className="py-2 font-mono text-stone-700">#{c.invoiceNumber}</td>
                    <td className="py-2 text-right text-stone-500">Expected by <span className="font-medium text-stone-700">{fmtDate(c.date)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {summary.disputes.length > 0 && (
          <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-5 mb-4">
            <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">Queries raised</h2>
            <table className="w-full text-sm">
              <tbody className="divide-y divide-stone-100">
                {summary.disputes.map((d, i) => (
                  <tr key={i}>
                    <td className="py-2 font-mono text-stone-700">#{d.invoiceNumber}</td>
                    <td className="py-2 text-right"><span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">{d.category}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="bg-white border border-stone-200 rounded-xl shadow-sm p-5">
          <h2 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-3">What happens next</h2>
          <ol className="space-y-2.5 text-sm text-stone-600">
            {summary.commitments.length > 0 && (
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-stone-100 text-stone-500 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                Your account manager will monitor for receipt by the committed date and will follow up if needed.
              </li>
            )}
            {summary.disputes.length > 0 && (
              <li className="flex gap-3">
                <span className="w-5 h-5 rounded-full bg-stone-100 text-stone-500 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{summary.commitments.length > 0 ? 2 : 1}</span>
                Your query has been assigned to your account manager. Expect a response within 2 business days.
              </li>
            )}
            <li className="flex gap-3">
              <span className="w-5 h-5 rounded-full bg-stone-100 text-stone-500 text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">{(summary.commitments.length > 0 ? 1 : 0) + (summary.disputes.length > 0 ? 1 : 0) + 1}</span>
              If you need to make any changes, please reply to the email you received this link from.
            </li>
          </ol>
        </div>

        <p className="text-center text-xs text-stone-400 mt-6">You may now close this page.</p>
      </div>
      <PortalFooter />
    </div>
  );

  if (!data) return null;

  const showHistoryTab    = data.org.showPaymentHistory && data.paymentHistory.length > 0;
  const eligibleCount     = invoices.filter(i => !i.alreadyDisputed).length;
  const allSelected       = selected.size === eligibleCount && eligibleCount > 0;
  const someSelected      = selected.size > 0;
  const selectedBalance   = invoices.filter(i => selected.has(i.id)).reduce((s, i) => s + i.balance, 0);

  // ── Main view ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#F5F6FA] flex flex-col">
      {referralVisible && (
        <ReferralBanner onDismiss={() => { setReferralVisible(false); localStorage.setItem(REFERRAL_KEY, "1"); }} />
      )}

      <PortalHeader org={data.org} />

      <div className="flex-1 max-w-4xl mx-auto w-full px-4 py-6">

        {/* Account summary */}
        <div className="mb-4">
          <h1 className="text-lg font-semibold text-stone-900">{data.customer.name}</h1>
          <p className="text-sm text-stone-500">Account statement · {data.org.name}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <KpiCard label="Outstanding" value={money(totalOutstanding, currency)} />
          <KpiCard label="Overdue" value={overdueInvs.length > 0 ? money(totalOverdue, currency) : "—"} accent={overdueInvs.length > 0 ? "rose" : undefined} />
          <KpiCard label="Open invoices" value={String(invoices.length)} />
          <KpiCard label="Overdue invoices" value={overdueInvs.length > 0 ? String(overdueInvs.length) : "—"} accent={overdueInvs.length > 0 ? "rose" : undefined} />
        </div>

        {/* Tabs */}
        <div className="flex gap-0 mb-0 border-b border-stone-200">
          <TabBtn active={tab === "open"} onClick={() => setTab("open")}>Open invoices ({invoices.length})</TabBtn>
          {showHistoryTab && <TabBtn active={tab === "history"} onClick={() => setTab("history")}>Payment history ({data.paymentHistory.length})</TabBtn>}
          <div className="flex-1" />
          <a
            href={`/api/portal/${params.token}/statement`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 text-[12px] font-medium text-stone-500 hover:text-stone-800 px-3 py-2 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
            </svg>
            Statement PDF
          </a>
        </div>

        {/* ── OPEN INVOICES TABLE ── */}
        {tab === "open" && (
          <>
            {invoices.length === 0 ? (
              <div className="bg-white border border-stone-200 rounded-b-xl p-12 text-center">
                <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <p className="text-sm font-medium text-stone-700">Your account is up to date</p>
                <p className="text-sm text-stone-400 mt-1">No open invoices at this time.</p>
              </div>
            ) : (
              <div className="bg-white border border-stone-200 rounded-b-xl shadow-sm overflow-hidden">

                {/* Batch action bar */}
                <div className="border-b border-stone-100 px-4 py-3 flex flex-wrap items-center gap-3 bg-stone-50">
                  {/* Select all */}
                  <label className="flex items-center gap-2 cursor-pointer select-none shrink-0">
                    <Checkbox
                      checked={allSelected}
                      indeterminate={someSelected && !allSelected}
                      onChange={handleSelectAll}
                    />
                    <span className="text-xs font-medium text-stone-600">
                      {someSelected ? `${selected.size} selected · ${money(selectedBalance, currency)}` : "Select all"}
                    </span>
                  </label>

                  <div className="h-4 w-px bg-stone-200 shrink-0 hidden sm:block" />

                  {/* Batch commit date */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="text-[11px] text-stone-400 font-medium hidden sm:block">Pay by</span>
                    <input
                      type="date"
                      min={todayStr()}
                      value={batchDate}
                      onChange={e => setBatchDate(e.target.value)}
                      className="text-xs border border-stone-200 rounded-lg px-2.5 py-1.5 bg-white text-stone-700 focus:outline-none focus:ring-1 focus:ring-stone-400"
                    />
                  </div>

                  {/* Batch dispute */}
                  <select
                    value={batchDispute}
                    onChange={e => setBatchDispute(e.target.value)}
                    className="text-xs border border-stone-200 rounded-lg px-2.5 py-1.5 bg-white text-stone-600 focus:outline-none focus:ring-1 focus:ring-stone-400 shrink-0"
                  >
                    <option value="">Query reason…</option>
                    {DISPUTE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>

                  {/* Batch comment */}
                  <input
                    type="text"
                    placeholder="Add a comment…"
                    value={batchComment}
                    onChange={e => setBatchComment(e.target.value)}
                    className="text-xs border border-stone-200 rounded-lg px-2.5 py-1.5 bg-white text-stone-700 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400 flex-1 min-w-[140px]"
                  />

                  <button
                    onClick={applyBatch}
                    disabled={!someSelected || (!batchDate && !batchDispute && !batchComment)}
                    className="text-xs font-semibold px-3 py-1.5 bg-stone-900 text-white rounded-lg hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    Apply to selected
                  </button>
                </div>

                {/* Table header */}
                <div className="hidden sm:grid grid-cols-[32px_1fr_110px_110px_120px_140px_120px_80px] gap-x-3 px-4 py-2 border-b border-stone-100 bg-stone-50">
                  <div />
                  <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Invoice</div>
                  <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Date</div>
                  <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Due</div>
                  <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider text-right">Balance</div>
                  <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Pay by date</div>
                  <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Query</div>
                  <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider text-center">PDF</div>
                </div>

                {/* Rows */}
                <div className="divide-y divide-stone-100">
                  {invoices.map(inv => {
                    const overdue   = isOverdue(inv.dueDate);
                    const days      = daysOverdue(inv.dueDate);
                    const isSelected = selected.has(inv.id);
                    const action    = rowActions[inv.id] ?? { type: "none", commitDate: "", comment: "", disputeCategory: "" };
                    const hasAction = (action.type === "commit" && action.commitDate) || (action.type === "dispute" && action.disputeCategory);

                    return (
                      <div key={inv.id} className={`transition-colors ${hasAction ? "bg-emerald-50/40" : isSelected ? "bg-stone-50" : "bg-white hover:bg-stone-50/60"}`}>

                        {/* Main row */}
                        <div className="grid grid-cols-[32px_1fr] sm:grid-cols-[32px_1fr_110px_110px_120px_140px_120px_80px] gap-x-3 px-4 py-3 items-center">

                          {/* Checkbox */}
                          <Checkbox
                            checked={isSelected}
                            onChange={() => { if (!inv.alreadyDisputed) toggleSelect(inv.id); }}
                            disabled={inv.alreadyDisputed}
                          />

                          {/* Invoice number + badges */}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-sm font-semibold text-stone-800">#{inv.invoiceNumber}</span>
                              {overdue && (
                                <span className="text-[10px] font-bold px-2 py-0.5 bg-rose-100 text-rose-600 rounded-full">
                                  {days}d overdue
                                </span>
                              )}
                              {inv.alreadyDisputed && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">Query open</span>
                              )}
                              {inv.existingPromise && !inv.alreadyDisputed && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">Committed</span>
                              )}
                              {action.type === "commit" && action.commitDate && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">✓ Will pay {fmtDate(action.commitDate)}</span>
                              )}
                              {action.type === "dispute" && action.disputeCategory && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full">⚠ {action.disputeCategory}</span>
                              )}
                            </div>
                            {/* Mobile: show dates inline */}
                            <div className="sm:hidden text-[11px] text-stone-400 mt-0.5">
                              {fmtDate(inv.invoiceDate)} · Due {fmtDate(inv.dueDate)} · <span className="font-semibold text-stone-700">{money(inv.balance, inv.currency)}</span>
                            </div>
                          </div>

                          {/* Invoice date */}
                          <div className="hidden sm:block text-sm text-stone-500">{fmtDate(inv.invoiceDate)}</div>

                          {/* Due date */}
                          <div className={`hidden sm:block text-sm ${overdue ? "text-rose-600 font-medium" : "text-stone-500"}`}>
                            {fmtDate(inv.dueDate)}
                          </div>

                          {/* Balance */}
                          <div className="hidden sm:block text-sm font-semibold text-stone-800 text-right tabular-nums">
                            {money(inv.balance, inv.currency)}
                          </div>

                          {/* Pay-by date input */}
                          <div className="hidden sm:block">
                            {!inv.alreadyDisputed && (
                              <input
                                type="date"
                                min={todayStr()}
                                value={action.type === "commit" ? action.commitDate : ""}
                                onChange={e => patchRow(inv.id, { type: e.target.value ? "commit" : "none", commitDate: e.target.value })}
                                className={`w-full text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-stone-400 ${
                                  action.type === "commit" && action.commitDate
                                    ? "border-blue-300 bg-blue-50 text-blue-800"
                                    : "border-stone-200 bg-white text-stone-700"
                                }`}
                              />
                            )}
                          </div>

                          {/* Query dropdown */}
                          <div className="hidden sm:block">
                            {!inv.alreadyDisputed && (
                              <select
                                value={action.type === "dispute" ? action.disputeCategory : ""}
                                onChange={e => patchRow(inv.id, { type: e.target.value ? "dispute" : "none", disputeCategory: e.target.value, commitDate: "" })}
                                className={`w-full text-xs border rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-stone-400 ${
                                  action.type === "dispute" && action.disputeCategory
                                    ? "border-orange-300 bg-orange-50 text-orange-800"
                                    : "border-stone-200 bg-white text-stone-600"
                                }`}
                              >
                                <option value="">No query</option>
                                {DISPUTE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                              </select>
                            )}
                          </div>

                          {/* PDF */}
                          <div className="hidden sm:flex items-center justify-center">
                            {inv.hasPdf && (
                              <a
                                href={`/api/portal/${params.token}/pdf/${inv.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-[11px] font-medium text-stone-400 hover:text-stone-700 transition-colors"
                                title="Download invoice PDF"
                              >
                                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                </svg>
                                PDF
                              </a>
                            )}
                          </div>
                        </div>

                        {/* Comment row — only shows if row has an action */}
                        {(hasAction || action.comment) && (
                          <div className="px-4 pb-3 pl-12">
                            <input
                              type="text"
                              placeholder="Add a comment or note for your account manager (optional)…"
                              value={action.comment}
                              onChange={e => patchRow(inv.id, { comment: e.target.value })}
                              className="w-full text-xs border border-stone-200 rounded-lg px-3 py-2 bg-white text-stone-700 placeholder-stone-400 focus:outline-none focus:ring-1 focus:ring-stone-400"
                            />
                          </div>
                        )}

                        {/* Mobile: action controls */}
                        {!inv.alreadyDisputed && (
                          <div className="sm:hidden px-4 pb-3 flex flex-col gap-2">
                            <div className="flex gap-2">
                              <div className="flex-1">
                                <label className="text-[10px] text-stone-400 font-semibold block mb-1">PAY BY DATE</label>
                                <input
                                  type="date"
                                  min={todayStr()}
                                  value={action.type === "commit" ? action.commitDate : ""}
                                  onChange={e => patchRow(inv.id, { type: e.target.value ? "commit" : "none", commitDate: e.target.value })}
                                  className="w-full text-xs border border-stone-200 rounded-lg px-2.5 py-2 bg-white"
                                />
                              </div>
                              <div className="flex-1">
                                <label className="text-[10px] text-stone-400 font-semibold block mb-1">QUERY</label>
                                <select
                                  value={action.type === "dispute" ? action.disputeCategory : ""}
                                  onChange={e => patchRow(inv.id, { type: e.target.value ? "dispute" : "none", disputeCategory: e.target.value, commitDate: "" })}
                                  className="w-full text-xs border border-stone-200 rounded-lg px-2.5 py-2 bg-white"
                                >
                                  <option value="">No query</option>
                                  {DISPUTE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                              </div>
                            </div>
                            {hasAction && (
                              <input
                                type="text"
                                placeholder="Comment (optional)…"
                                value={action.comment}
                                onChange={e => patchRow(inv.id, { comment: e.target.value })}
                                className="w-full text-xs border border-stone-200 rounded-lg px-2.5 py-2 bg-white"
                              />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Submit footer */}
                <div className="border-t border-stone-100 px-4 py-4 bg-stone-50 flex items-center justify-between gap-4">
                  <div className="text-sm text-stone-500">
                    {actionCount > 0
                      ? <span><span className="font-semibold text-stone-800">{actionCount}</span> invoice{actionCount !== 1 ? "s" : ""} with a response</span>
                      : <span className="text-stone-400">Set a pay-by date or query on each invoice to respond</span>
                    }
                  </div>
                  <button
                    onClick={submit}
                    disabled={!canSubmit || submitting}
                    className="flex items-center gap-2 bg-stone-900 text-white text-sm font-semibold px-5 py-2.5 rounded-xl hover:bg-stone-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    {submitting && <span className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />}
                    {submitting ? "Submitting…" : "Submit response"}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* ── PAYMENT HISTORY ── */}
        {tab === "history" && (
          <div className="bg-white border border-stone-200 rounded-b-xl shadow-sm overflow-hidden">
            <div className="hidden sm:grid grid-cols-[1fr_120px_120px_120px] gap-x-3 px-4 py-2 border-b border-stone-100 bg-stone-50">
              <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Invoice</div>
              <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Invoiced</div>
              <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider">Due date</div>
              <div className="text-[10px] font-semibold text-stone-400 uppercase tracking-wider text-right">Amount paid</div>
            </div>
            <div className="divide-y divide-stone-100">
              {data.paymentHistory.map(inv => (
                <div key={inv.id} className="grid grid-cols-[1fr_auto] sm:grid-cols-[1fr_120px_120px_120px] gap-x-3 px-4 py-3 items-center hover:bg-stone-50/60">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                      <svg className="w-3 h-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                      </svg>
                    </div>
                    <span className="font-mono text-sm font-semibold text-stone-700">#{inv.invoiceNumber}</span>
                  </div>
                  <div className="hidden sm:block text-sm text-stone-500">{fmtDate(inv.invoiceDate)}</div>
                  <div className="hidden sm:block text-sm text-stone-500">{fmtDate(inv.dueDate)}</div>
                  <div className="text-sm font-semibold text-emerald-700 text-right tabular-nums">{money(inv.paid, inv.currency)}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── HOW TO USE ── */}
        <div className="mt-8 bg-white border border-stone-200 rounded-xl shadow-sm p-6">
          <h2 className="text-sm font-semibold text-stone-700 mb-4 flex items-center gap-2">
            <svg className="w-4 h-4 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11.25 11.25l.041-.02a.75.75 0 011.063.852l-.708 2.836a.75.75 0 001.063.853l.041-.021M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9-3.75h.008v.008H12V8.25z" />
            </svg>
            How to use this portal
          </h2>
          <div className="grid sm:grid-cols-3 gap-4">
            <InstructionCard
              step="1"
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
                </svg>
              }
              title="Set a payment date"
              body="Enter a date in the 'Pay by date' column for any invoice you plan to pay. Your account manager will be notified and will follow up if payment isn't received."
            />
            <InstructionCard
              step="2"
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                </svg>
              }
              title="Raise a query"
              body="If an invoice looks incorrect, select a reason in the 'Query' column. Add a comment to provide more detail. Your query will be investigated within 2 business days."
            />
            <InstructionCard
              step="3"
              icon={
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
                </svg>
              }
              title="Batch actions"
              body="Use the toolbar at the top of the table to select multiple invoices at once. Set a single payment date or query reason that applies to all selected invoices, then click 'Apply to selected'."
            />
          </div>
          <p className="text-xs text-stone-400 mt-4 pt-4 border-t border-stone-100">
            This is a secure, single-use link. Once you submit your response this link will close. To request a new link or speak with your account manager, reply to the email you received.
          </p>
        </div>

      </div>

      <PortalFooter />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PortalHeader({ org }: { org?: { name: string; logoUrl: string | null } | null }) {
  return (
    <header className="bg-white border-b border-stone-200 px-4 py-3 shadow-sm">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          {org?.logoUrl ? (
            <img src={org.logoUrl} alt="" className="h-7 w-auto object-contain" />
          ) : (
            <div className="w-7 h-7 rounded-md bg-stone-900 flex items-center justify-center font-bold text-white text-sm">
              {org?.name?.charAt(0) ?? "A"}
            </div>
          )}
          <div>
            <div className="font-semibold text-sm text-stone-900">{org?.name ?? "Account Portal"}</div>
            <div className="text-[10px] text-stone-400 font-medium tracking-wide uppercase">Accounts Receivable</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-stone-400">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          Secure link
        </div>
      </div>
    </header>
  );
}

function KpiCard({ label, value, accent }: { label: string; value: string; accent?: "rose" }) {
  return (
    <div className={`bg-white border rounded-xl px-4 py-3 shadow-sm ${accent === "rose" ? "border-rose-200 bg-rose-50" : "border-stone-200"}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-stone-400 mb-1">{label}</div>
      <div className={`text-base font-bold tabular-nums ${accent === "rose" ? "text-rose-600" : "text-stone-900"}`}>{value}</div>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
        active ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-700"
      }`}
    >
      {children}
    </button>
  );
}

function Checkbox({ checked, onChange, disabled, indeterminate }: {
  checked: boolean; onChange: () => void; disabled?: boolean; indeterminate?: boolean;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ref.current) (ref.current as any).indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <button
      ref={ref}
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      onClick={onChange}
      disabled={disabled}
      className={`w-4 h-4 rounded flex items-center justify-center transition-colors shrink-0 ${
        disabled ? "opacity-30 cursor-not-allowed bg-stone-100 ring-1 ring-stone-200"
        : (checked || indeterminate) ? "bg-stone-900 ring-1 ring-stone-900"
        : "bg-white ring-1 ring-stone-300 hover:ring-stone-500"
      }`}
    >
      {indeterminate && !checked && (
        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
        </svg>
      )}
      {checked && (
        <svg className="w-2.5 h-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      )}
    </button>
  );
}

function InstructionCard({ step, icon, title, body }: { step: string; icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <div className="w-6 h-6 rounded-full bg-stone-100 flex items-center justify-center text-[11px] font-bold text-stone-500 shrink-0">{step}</div>
        <div className="text-stone-500">{icon}</div>
        <span className="text-sm font-semibold text-stone-700">{title}</span>
      </div>
      <p className="text-xs text-stone-500 leading-relaxed pl-8">{body}</p>
    </div>
  );
}

function PortalFooter() {
  return (
    <footer className="text-center py-5 text-[11px] text-stone-400 border-t border-stone-200 mt-4 bg-white">
      <span>Powered by </span>
      <a href="https://primeaccountax.com" target="_blank" rel="noopener noreferrer" className="font-semibold text-stone-500 hover:text-stone-700 underline underline-offset-2">
        Prime Accountax
      </a>
      <span> · Accounts Receivable Management</span>
    </footer>
  );
}

function ReferralBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="bg-stone-900 text-white px-4 py-3 border-b border-stone-700">
      <div className="max-w-4xl mx-auto flex items-start gap-3">
        <div className="flex-1">
          <p className="text-[13px] font-semibold">Smarter receivables management for ambitious businesses</p>
          <p className="text-[12px] text-stone-300 mt-0.5">
            Prime Accountax gives finance teams a single platform to automate collections, track payment commitments, and report on debtor performance — integrated with QuickBooks and Xero.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a href="https://primeaccountax.com?ref=portal" target="_blank" rel="noopener noreferrer" className="text-[12px] font-semibold bg-white text-stone-900 px-3 py-1.5 rounded-lg hover:bg-stone-100 transition-colors whitespace-nowrap">Learn more</a>
          <button onClick={onDismiss} className="text-stone-400 hover:text-white p-1" aria-label="Dismiss">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
