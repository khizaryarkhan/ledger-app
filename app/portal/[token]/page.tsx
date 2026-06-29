"use client";

import { useState, useEffect } from "react";

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

type DisputeState = { open: boolean; category: string; reason: string };

type SubmittedSummary = {
  commitments: { invoiceNumber: string; date: string; note: string }[];
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
    style: "currency",
    currency: ccy || "EUR",
    maximumFractionDigits: 2,
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

function daysUntilDue(dueDate: string | null): number {
  if (!dueDate) return 0;
  const diff = new Date(dueDate).getTime() - new Date(new Date().toDateString()).getTime();
  return Math.ceil(diff / 86400000);
}

const REFERRAL_KEY = "pa_referral_dismissed";

// ── Component ─────────────────────────────────────────────────────────────────

export default function PortalPage({ params }: { params: { token: string } }) {
  const [data, setData]         = useState<PortalData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading]   = useState(true);

  const [selected, setSelected]     = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate]     = useState("");
  const [bulkNote, setBulkNote]     = useState("");
  const [selectAll, setSelectAll]   = useState(false);
  const [disputes, setDisputes]     = useState<Record<string, DisputeState>>({});

  const [tab, setTab]         = useState<"open" | "history">("open");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone]       = useState(false);
  const [summary, setSummary] = useState<SubmittedSummary>({ commitments: [], disputes: [] });
  const [referralVisible, setReferralVisible] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    fetch(`/api/portal/${params.token}`)
      .then(async res => {
        if (res.status === 410) { const d = await res.json(); setErrorMsg(d.error || "expired"); return; }
        if (!res.ok) { setErrorMsg("error"); return; }
        const d: PortalData = await res.json();
        setData(d);
        const init: Record<string, DisputeState> = {};
        d.invoices.forEach(i => { init[i.id] = { open: false, category: "", reason: "" }; });
        setDisputes(init);
        const dismissed = typeof window !== "undefined" && localStorage.getItem(REFERRAL_KEY);
        if (!dismissed) setReferralVisible(true);
      })
      .catch(() => setErrorMsg("error"))
      .finally(() => setLoading(false));
  }, [params.token]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const invoices          = data?.invoices ?? [];
  const totalOutstanding  = invoices.reduce((s, i) => s + i.balance, 0);
  const overdueInvoices   = invoices.filter(i => isOverdue(i.dueDate));
  const totalOverdue      = overdueInvoices.reduce((s, i) => s + i.balance, 0);
  const activeCommitments = invoices.filter(i => i.existingPromise && !i.alreadyDisputed).length;
  const currency          = invoices[0]?.currency || "EUR";

  const hasAnyDispute = Object.values(disputes).some(d => d.open && d.category);
  const hasCommitment = selected.size > 0 && !!bulkDate;
  const canSubmit     = hasCommitment || hasAnyDispute;

  // ── Handlers ──────────────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
    setSelectAll(false);
  }

  function handleSelectAll() {
    if (selectAll) { setSelected(new Set()); setSelectAll(false); }
    else { setSelected(new Set(invoices.filter(i => !i.alreadyDisputed).map(i => i.id))); setSelectAll(true); }
  }

  function updateDispute(id: string, patch: Partial<DisputeState>) {
    setDisputes(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function submit() {
    setSubmitting(true);
    const responses: any[] = [];
    const committed: SubmittedSummary["commitments"] = [];
    const disputed: SubmittedSummary["disputes"] = [];

    if (bulkDate && selected.size > 0) {
      selected.forEach(invoiceId => {
        const inv = invoices.find(i => i.id === invoiceId);
        responses.push({ invoiceId, promise: { date: bulkDate, note: bulkNote || undefined } });
        if (inv) committed.push({ invoiceNumber: inv.invoiceNumber, date: bulkDate, note: bulkNote });
      });
    }

    Object.entries(disputes).forEach(([invoiceId, d]) => {
      if (d.open && d.category && !selected.has(invoiceId)) {
        const inv = invoices.find(i => i.id === invoiceId);
        responses.push({ invoiceId, dispute: { category: d.category, reason: d.reason || undefined } });
        if (inv) disputed.push({ invoiceNumber: inv.invoiceNumber, category: d.category });
      }
    });

    if (responses.length === 0) { setSubmitting(false); return; }

    try {
      const res = await fetch(`/api/portal/${params.token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses }),
      });
      if (res.ok) {
        setSummary({ commitments: committed, disputes: disputed });
        setDone(true);
      } else {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(d.error || "error");
      }
    } catch {
      setErrorMsg("error");
    } finally {
      setSubmitting(false);
    }
  }

  // ── States ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-stone-300 border-t-stone-700 rounded-full animate-spin" />
          <p className="text-sm text-stone-400">Loading your account…</p>
        </div>
      </div>
    );
  }

  if (errorMsg) {
    const isExpired   = errorMsg === "expired" || errorMsg === "completed";
    const isNotFound  = errorMsg === "not_found";
    const msg = isExpired
      ? "This link has already been used or has expired. Please contact us if you need a new link."
      : isNotFound
      ? "This link is invalid. Please check the URL or contact your account manager."
      : "Something went wrong. Please try again or contact us directly.";
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center">
          <div className="w-14 h-14 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-stone-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 15v2m0 0v2m0-2h2m-2 0H10m2-6V7" />
              <circle cx="12" cy="12" r="10" strokeWidth={1.5} />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-stone-800 mb-2">Link unavailable</h1>
          <p className="text-sm text-stone-500 leading-relaxed">{msg}</p>
        </div>
      </div>
    );
  }

  // ── Confirmation screen ───────────────────────────────────────────────────

  if (done) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        <PortalHeader org={data?.org} />
        <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-10">
          {/* Success banner */}
          <div className="bg-emerald-50 ring-1 ring-emerald-200 rounded-2xl px-6 py-5 mb-6 flex items-start gap-4">
            <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center shrink-0 mt-0.5">
              <svg className="w-5 h-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <div>
              <h1 className="text-base font-semibold text-emerald-800">Response received</h1>
              <p className="text-sm text-emerald-700 mt-0.5">
                Thank you, <span className="font-medium">{data?.customer.name}</span>. Your response has been recorded and your account manager has been notified.
              </p>
            </div>
          </div>

          {/* Summary of what was submitted */}
          {summary.commitments.length > 0 && (
            <div className="bg-white ring-1 ring-stone-200 rounded-xl p-5 mb-4">
              <h2 className="text-sm font-semibold text-stone-800 mb-3 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                  <svg className="w-3 h-3 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </span>
                Payment commitments logged
              </h2>
              <div className="space-y-2">
                {summary.commitments.map((c, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-stone-700">#{c.invoiceNumber}</span>
                    <span className="text-stone-500">Expected by <span className="font-medium text-stone-700">{fmtDate(c.date)}</span></span>
                  </div>
                ))}
              </div>
              {summary.commitments[0]?.note && (
                <p className="text-xs text-stone-400 mt-3 pt-3 border-t border-stone-100">Note: {summary.commitments[0].note}</p>
              )}
            </div>
          )}

          {summary.disputes.length > 0 && (
            <div className="bg-white ring-1 ring-stone-200 rounded-xl p-5 mb-4">
              <h2 className="text-sm font-semibold text-stone-800 mb-3 flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-amber-100 flex items-center justify-center">
                  <svg className="w-3 h-3 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75h.007v.008H12v-.008z" />
                  </svg>
                </span>
                Queries raised
              </h2>
              <div className="space-y-2">
                {summary.disputes.map((d, i) => (
                  <div key={i} className="flex items-center justify-between text-sm">
                    <span className="font-mono text-stone-700">#{d.invoiceNumber}</span>
                    <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded font-medium">{d.category}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* What happens next */}
          <div className="bg-white ring-1 ring-stone-200 rounded-xl p-5 mb-4">
            <h2 className="text-sm font-semibold text-stone-700 mb-3">What happens next</h2>
            <ol className="space-y-3">
              {summary.commitments.length > 0 && (
                <li className="flex gap-3 text-sm text-stone-600">
                  <span className="w-5 h-5 rounded-full bg-stone-100 text-stone-500 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">1</span>
                  Your account manager has been notified of your payment commitment and will monitor for receipt by the agreed date.
                </li>
              )}
              {summary.disputes.length > 0 && (
                <li className="flex gap-3 text-sm text-stone-600">
                  <span className="w-5 h-5 rounded-full bg-stone-100 text-stone-500 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{summary.commitments.length > 0 ? "2" : "1"}</span>
                  Your query has been logged and assigned to your account manager. You can expect a response within 2 business days.
                </li>
              )}
              <li className="flex gap-3 text-sm text-stone-600">
                <span className="w-5 h-5 rounded-full bg-stone-100 text-stone-500 text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{(summary.commitments.length > 0 ? 1 : 0) + (summary.disputes.length > 0 ? 1 : 0) + 1}</span>
                If you need to make any changes or have questions, please reply to the email you received this link from.
              </li>
            </ol>
          </div>

          <p className="text-center text-xs text-stone-400 mt-6">You can now close this page.</p>
        </div>
        <PortalFooter orgName={data?.org.name} />
      </div>
    );
  }

  if (!data) return null;

  const showHistoryTab = data.org.showPaymentHistory && data.paymentHistory.length > 0;

  // ── Main portal view ──────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {referralVisible && (
        <ReferralBanner onDismiss={() => { setReferralVisible(false); localStorage.setItem(REFERRAL_KEY, "1"); }} />
      )}

      <PortalHeader org={data.org} />

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">

        {/* Greeting */}
        <div className="mb-5">
          <p className="text-base font-semibold text-stone-800">
            Hello, {data.customer.name}
          </p>
          <p className="text-sm text-stone-500 mt-0.5">
            Here is your account statement with <span className="font-medium">{data.org.name}</span>.
          </p>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <SummaryCard label="Outstanding" value={money(totalOutstanding, currency)} accent="stone" />
          <SummaryCard
            label="Overdue"
            value={overdueInvoices.length > 0 ? money(totalOverdue, currency) : "—"}
            accent={overdueInvoices.length > 0 ? "rose" : "stone"}
          />
          <SummaryCard
            label="Commitments"
            value={activeCommitments > 0 ? String(activeCommitments) : "—"}
            accent={activeCommitments > 0 ? "emerald" : "stone"}
          />
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-stone-200">
          <TabButton active={tab === "open"} onClick={() => setTab("open")}>
            Open invoices ({invoices.length})
          </TabButton>
          {showHistoryTab && (
            <TabButton active={tab === "history"} onClick={() => setTab("history")}>
              Payment history ({data.paymentHistory.length})
            </TabButton>
          )}
        </div>

        {/* Open invoices tab */}
        {tab === "open" && (
          <>
            {invoices.length === 0 ? (
              <div className="bg-white rounded-xl ring-1 ring-stone-200 p-10 text-center">
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-3">
                  <svg className="w-6 h-6 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </div>
                <p className="text-sm font-semibold text-stone-700">Your account is up to date</p>
                <p className="text-sm text-stone-400 mt-1">No open invoices at this time.</p>
              </div>
            ) : (
              <>
                {/* Toolbar: select-all + download statement */}
                <div className="flex items-center justify-between mb-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <Checkbox checked={selectAll} onChange={handleSelectAll} />
                    <span className="text-sm text-stone-600 font-medium">
                      {selectAll ? "Deselect all" : "Select all"}
                    </span>
                    {selected.size > 0 && !selectAll && (
                      <span className="text-[12px] text-stone-400">({selected.size} selected)</span>
                    )}
                  </label>
                  <a
                    href={`/api/portal/${params.token}/statement`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-[12px] font-medium text-stone-600 hover:text-stone-900 bg-white hover:bg-stone-50 ring-1 ring-stone-200 hover:ring-stone-300 px-3 py-1.5 rounded-lg transition-colors"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                    </svg>
                    Download statement
                  </a>
                </div>

                {/* How to respond note */}
                <div className="bg-blue-50 ring-1 ring-blue-100 rounded-xl px-4 py-3 mb-4 text-[13px] text-blue-800">
                  <p className="font-medium mb-0.5">How to respond</p>
                  <p className="text-blue-700">Select invoices you plan to pay and choose a payment date. To query an invoice, use the "Raise a query" button on that row.</p>
                </div>

                {/* Invoice list */}
                <div className="space-y-3 mb-4">
                  {invoices.map(inv => {
                    const overdue    = isOverdue(inv.dueDate);
                    const daysLeft   = daysUntilDue(inv.dueDate);
                    const isSelected = selected.has(inv.id);
                    const dispute    = disputes[inv.id] || { open: false, category: "", reason: "" };

                    return (
                      <div
                        key={inv.id}
                        className={`bg-white rounded-xl ring-1 overflow-hidden transition-shadow ${
                          isSelected ? "ring-stone-900 shadow-md" : "ring-stone-200"
                        }`}
                      >
                        {/* Invoice row */}
                        <div className="px-4 py-3.5 flex items-start gap-3">
                          <div className="pt-0.5">
                            <Checkbox
                              checked={isSelected}
                              onChange={() => {
                                if (!inv.alreadyDisputed) toggleSelect(inv.id);
                              }}
                              disabled={inv.alreadyDisputed}
                            />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-sm font-semibold text-stone-800">#{inv.invoiceNumber}</span>
                              {overdue && (
                                <span className="text-[10px] font-bold px-2 py-0.5 bg-rose-100 text-rose-700 rounded-full tracking-wide">OVERDUE</span>
                              )}
                              {!overdue && daysLeft <= 7 && daysLeft >= 0 && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
                                  Due in {daysLeft === 0 ? "today" : `${daysLeft}d`}
                                </span>
                              )}
                              {inv.alreadyDisputed && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">QUERY OPEN</span>
                              )}
                              {inv.existingPromise && !inv.alreadyDisputed && (
                                <span className="text-[10px] font-semibold px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded-full">COMMITTED</span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 mt-1">
                              <span className="text-[12px] text-stone-400">
                                Invoiced {fmtDate(inv.invoiceDate)}
                              </span>
                              <span className="text-stone-300">·</span>
                              <span className={`text-[12px] ${overdue ? "text-rose-500 font-medium" : "text-stone-400"}`}>
                                Due {fmtDate(inv.dueDate)}
                              </span>
                            </div>
                          </div>
                          <div className="text-right shrink-0 flex flex-col items-end gap-1">
                            <div className="font-bold text-stone-900 text-sm">{money(inv.balance, inv.currency)}</div>
                            {inv.hasPdf && (
                              <a
                                href={`/api/portal/${params.token}/pdf/${inv.id}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[11px] text-stone-400 hover:text-stone-700 flex items-center gap-1 transition-colors"
                                title="Download invoice PDF"
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                                </svg>
                                PDF
                              </a>
                            )}
                          </div>
                        </div>

                        {/* Existing commitment */}
                        {inv.existingPromise && !inv.alreadyDisputed && (
                          <div className="mx-4 mb-3 px-3 py-2 bg-emerald-50 ring-1 ring-emerald-200 rounded-lg text-[12px] text-emerald-800">
                            Previously committed to pay by <span className="font-semibold">{fmtDate(inv.existingPromise)}</span>. Select to update.
                          </div>
                        )}

                        {/* Dispute toggle */}
                        {!isSelected && !inv.alreadyDisputed && (
                          <div className="px-4 pb-3">
                            <button
                              onClick={() => updateDispute(inv.id, { open: !dispute.open, category: "", reason: "" })}
                              className={`text-[12px] font-medium px-3 py-1.5 rounded-lg transition-colors ${
                                dispute.open
                                  ? "bg-rose-600 text-white"
                                  : "bg-stone-100 text-stone-600 hover:bg-stone-200"
                              }`}
                            >
                              {dispute.open ? "✕ Cancel query" : "⚠ Raise a query"}
                            </button>
                          </div>
                        )}

                        {/* Dispute form */}
                        {dispute.open && !isSelected && (
                          <div className="mx-4 mb-3 p-3 bg-rose-50 ring-1 ring-rose-200 rounded-xl space-y-2">
                            <p className="text-[12px] font-medium text-rose-800">Query on invoice #{inv.invoiceNumber}</p>
                            <select
                              value={dispute.category}
                              onChange={e => updateDispute(inv.id, { category: e.target.value })}
                              className="w-full text-sm border border-rose-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300"
                            >
                              <option value="">Select reason…</option>
                              {DISPUTE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                            <textarea
                              rows={2}
                              placeholder="Please describe the issue (optional)…"
                              value={dispute.reason}
                              onChange={e => updateDispute(inv.id, { reason: e.target.value })}
                              className="w-full text-sm border border-rose-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-rose-300 resize-none"
                            />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Commitment panel */}
                {selected.size > 0 && (
                  <div className="bg-white ring-2 ring-stone-900 rounded-xl p-5 mb-4 space-y-4">
                    <div>
                      <div className="text-sm font-semibold text-stone-900 mb-0.5">
                        Payment commitment — {selected.size} invoice{selected.size !== 1 ? "s" : ""}
                      </div>
                      <div className="text-[12px] text-stone-500">
                        {money(
                          invoices.filter(i => selected.has(i.id)).reduce((s, i) => s + i.balance, 0),
                          currency
                        )} total
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="text-[11px] text-stone-500 font-semibold block mb-1 uppercase tracking-wide">Payment date *</label>
                        <input
                          type="date"
                          min={todayStr}
                          value={bulkDate}
                          onChange={e => setBulkDate(e.target.value)}
                          className="w-full text-sm bg-white border border-stone-300 text-stone-900 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-stone-500"
                        />
                      </div>
                      <div>
                        <label className="text-[11px] text-stone-500 font-semibold block mb-1 uppercase tracking-wide">Payment method / reference</label>
                        <input
                          type="text"
                          placeholder="e.g. Bank transfer, cheque, ref…"
                          value={bulkNote}
                          onChange={e => setBulkNote(e.target.value)}
                          className="w-full text-sm bg-white border border-stone-300 text-stone-800 rounded-lg px-3 py-2.5 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-500"
                        />
                      </div>
                    </div>
                    <p className="text-[11px] text-stone-400 leading-relaxed">
                      Your account manager will be notified and will follow up if payment is not received by this date.
                    </p>
                  </div>
                )}

                {/* Submit */}
                <div className="sticky bottom-4">
                  <button
                    onClick={submit}
                    disabled={!canSubmit || submitting}
                    className="w-full bg-stone-900 text-white font-semibold py-3.5 rounded-xl shadow-lg hover:bg-stone-800 active:scale-[0.99] transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {submitting && (
                      <span className="inline-block w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    )}
                    {submitting ? "Submitting…" : canSubmit ? "Submit response" : "Select invoices or raise a query to respond"}
                  </button>
                  <p className="text-center text-[11px] text-stone-400 mt-2">
                    Secure · Single-use link · Responses are logged to your account
                  </p>
                </div>
              </>
            )}
          </>
        )}

        {/* Payment history tab */}
        {tab === "history" && (
          <div className="space-y-2">
            {data.paymentHistory.length === 0 ? (
              <div className="bg-white rounded-xl ring-1 ring-stone-200 p-8 text-center text-sm text-stone-400">
                No payment history available.
              </div>
            ) : (
              data.paymentHistory.map(inv => (
                <div key={inv.id} className="bg-white rounded-xl ring-1 ring-stone-200 px-4 py-3.5 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm font-semibold text-stone-800">#{inv.invoiceNumber}</div>
                    <div className="text-[11px] text-stone-400">Invoiced {fmtDate(inv.invoiceDate)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-semibold text-emerald-700">{money(inv.paid, inv.currency)}</div>
                    <div className="text-[11px] text-stone-400">paid</div>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      <PortalFooter orgName={data.org.name} />
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PortalHeader({ org }: { org?: { name: string; logoUrl: string | null } | null }) {
  return (
    <header className="bg-stone-900 text-white px-4 py-4 shadow-md">
      <div className="max-w-2xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          {org?.logoUrl ? (
            <img src={org.logoUrl} alt="" className="h-8 w-auto rounded bg-white/10 p-1 object-contain" />
          ) : (
            <div className="w-8 h-8 rounded-lg bg-stone-700 flex items-center justify-center font-bold text-base">
              {org?.name?.charAt(0) ?? "A"}
            </div>
          )}
          <div>
            <div className="font-semibold text-sm">{org?.name ?? "Account Portal"}</div>
            <div className="text-[10px] text-stone-400 font-medium tracking-wide uppercase">Accounts Receivable Portal</div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-stone-500">
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          Secure link
        </div>
      </div>
    </header>
  );
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent: "stone" | "rose" | "emerald" }) {
  const colors = {
    stone:   "bg-white ring-stone-200 text-stone-800",
    rose:    "bg-rose-50 ring-rose-200 text-rose-700",
    emerald: "bg-emerald-50 ring-emerald-200 text-emerald-700",
  };
  return (
    <div className={`rounded-xl ring-1 px-3 py-3 ${colors[accent]}`}>
      <div className="text-[10px] font-semibold text-stone-400 mb-1 uppercase tracking-wider">{label}</div>
      <div className="text-sm font-bold leading-tight truncate">{value}</div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active ? "border-stone-900 text-stone-900" : "border-transparent text-stone-500 hover:text-stone-700"
      }`}
    >
      {children}
    </button>
  );
}

function Checkbox({ checked, onChange, disabled }: { checked: boolean; onChange: () => void; disabled?: boolean }) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      disabled={disabled}
      className={`w-5 h-5 rounded flex items-center justify-center transition-colors shrink-0 ${
        disabled
          ? "bg-stone-100 ring-1 ring-stone-200 cursor-not-allowed opacity-40"
          : checked
          ? "bg-stone-900 ring-1 ring-stone-900"
          : "bg-white ring-1 ring-stone-300 hover:ring-stone-500"
      }`}
    >
      {checked && !disabled && (
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      )}
    </button>
  );
}

function PortalFooter({ orgName: _ }: { orgName?: string }) {
  return (
    <footer className="text-center py-6 text-[11px] text-stone-400 border-t border-stone-200 mt-6">
      <span>Powered by </span>
      <a
        href="https://primeaccountax.com"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-stone-500 hover:text-stone-700 underline underline-offset-2"
      >
        Prime Accountax
      </a>
      <span> · Accounts Receivable Management</span>
    </footer>
  );
}

function ReferralBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="bg-gradient-to-r from-stone-900 to-stone-800 text-white px-4 py-3">
      <div className="max-w-2xl mx-auto flex items-start gap-3">
        <div className="flex-1">
          <p className="text-[13px] font-semibold">Smarter receivables management for ambitious businesses</p>
          <p className="text-[12px] text-stone-300 mt-0.5">
            Prime Accountax gives finance teams a single platform to automate collections, track payment commitments, and report on debtor performance — integrated with QuickBooks and Xero.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <a
            href="https://primeaccountax.com?ref=portal"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[12px] font-semibold bg-white text-stone-900 px-3 py-1.5 rounded-lg hover:bg-stone-100 transition-colors whitespace-nowrap"
          >
            Learn more
          </a>
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
