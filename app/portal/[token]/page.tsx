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
  alreadyDisputed: boolean;
  existingPromise: string | null;
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

type DisputeState = {
  open: boolean;
  category: string;
  reason: string;
};

const DISPUTE_CATEGORIES = ["Wrong Amount", "Already Paid", "Goods / Service Issue", "Duplicate Invoice", "Other"];

// ── Helpers ───────────────────────────────────────────────────────────────────

function money(n: number, ccy: string) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency: ccy || "EUR",
    maximumFractionDigits: 2,
  }).format(n);
}

function isOverdue(dueDateStr: string | null): boolean {
  if (!dueDateStr) return false;
  return new Date(dueDateStr) < new Date(new Date().toDateString());
}

const REFERRAL_KEY = "pa_referral_dismissed";

// ── Component ─────────────────────────────────────────────────────────────────

export default function PortalPage({ params }: { params: { token: string } }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Bulk commitment state
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate] = useState("");
  const [bulkNote, setBulkNote] = useState("");
  const [selectAll, setSelectAll] = useState(false);

  // Per-invoice dispute state
  const [disputes, setDisputes] = useState<Record<string, DisputeState>>({});

  const [tab, setTab] = useState<"open" | "history">("open");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  // Referral banner
  const [referralVisible, setReferralVisible] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);

  // Load portal data
  useEffect(() => {
    fetch(`/api/portal/${params.token}`)
      .then(async res => {
        if (res.status === 410) {
          const d = await res.json();
          setErrorMsg(d.error || "expired");
          return;
        }
        if (!res.ok) { setErrorMsg("error"); return; }
        const d: PortalData = await res.json();
        setData(d);
        // Init dispute map
        const init: Record<string, DisputeState> = {};
        d.invoices.forEach(i => { init[i.id] = { open: false, category: "", reason: "" }; });
        setDisputes(init);
        // Show referral banner unless dismissed
        const dismissed = typeof window !== "undefined" && localStorage.getItem(REFERRAL_KEY);
        if (!dismissed) setReferralVisible(true);
      })
      .catch(() => setErrorMsg("error"))
      .finally(() => setLoading(false));
  }, [params.token]);

  // ── Derived state ──────────────────────────────────────────────────────────

  const invoices = data?.invoices ?? [];
  const totalOutstanding = invoices.reduce((s, i) => s + i.balance, 0);
  const overdueInvoices = invoices.filter(i => isOverdue(i.dueDate));
  const totalOverdue = overdueInvoices.reduce((s, i) => s + i.balance, 0);
  const activeCommitments = invoices.filter(i => i.existingPromise && !i.alreadyDisputed).length;
  const currency = invoices[0]?.currency || "EUR";

  const hasAnyDispute = Object.values(disputes).some(d => d.open && d.category);
  const hasCommitment = selected.size > 0 && bulkDate;
  const canSubmit = hasCommitment || hasAnyDispute;

  // ── Handlers ───────────────────────────────────────────────────────────────

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
    setSelectAll(false);
  }

  function handleSelectAll() {
    if (selectAll) {
      setSelected(new Set());
      setSelectAll(false);
    } else {
      setSelected(new Set(invoices.map(i => i.id)));
      setSelectAll(true);
    }
  }

  function updateDispute(id: string, patch: Partial<DisputeState>) {
    setDisputes(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function submit() {
    setSubmitting(true);
    const responses: any[] = [];

    // Bulk commitment rows
    if (bulkDate && selected.size > 0) {
      selected.forEach(invoiceId => {
        responses.push({
          invoiceId,
          promise: { date: bulkDate, note: bulkNote || undefined },
        });
      });
    }

    // Dispute rows
    Object.entries(disputes).forEach(([invoiceId, d]) => {
      if (d.open && d.category) {
        // Skip if this invoice already has a commitment — commitment takes priority
        if (!selected.has(invoiceId)) {
          responses.push({
            invoiceId,
            dispute: { category: d.category, reason: d.reason || undefined },
          });
        }
      }
    });

    if (responses.length === 0) { setSubmitting(false); return; }

    try {
      const res = await fetch(`/api/portal/${params.token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ responses }),
      });
      if (res.ok) setDone(true);
      else {
        const d = await res.json().catch(() => ({}));
        setErrorMsg(d.error || "error");
      }
    } catch {
      setErrorMsg("error");
    } finally {
      setSubmitting(false);
    }
  }

  // ── Loading / error / done states ──────────────────────────────────────────

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
    const msg =
      errorMsg === "completed"
        ? "This link has already been used. Contact us for a new link."
        : errorMsg === "expired"
        ? "This link has expired. Please contact us for a new link."
        : errorMsg === "not_found"
        ? "This link is invalid. Please check the URL or contact us."
        : "Something went wrong. Please try again or contact us.";
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
        <div className="max-w-sm w-full text-center">
          <div className="w-14 h-14 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4 text-2xl">🔒</div>
          <h1 className="text-lg font-semibold text-stone-800 mb-2">Link unavailable</h1>
          <p className="text-sm text-stone-500">{msg}</p>
        </div>
      </div>
    );
  }

  if (done) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        <div className="flex-1 flex items-center justify-center px-4">
          <div className="max-w-sm w-full text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-stone-800 mb-2">Thank you!</h1>
            <p className="text-sm text-stone-500">Your response has been received. Our team will follow up if needed.</p>
            <p className="text-sm text-stone-400 mt-1">You can now close this page.</p>
          </div>
        </div>
        <PortalFooter orgName={data?.org.name} />
      </div>
    );
  }

  if (!data) return null;

  const showHistoryTab = data.org.showPaymentHistory && data.paymentHistory.length > 0;

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Referral banner */}
      {referralVisible && (
        <ReferralBanner
          customerName={data.customer.name}
          orgName={data.org.name}
          onDismiss={() => {
            setReferralVisible(false);
            localStorage.setItem(REFERRAL_KEY, "1");
          }}
        />
      )}

      {/* Header */}
      <header className="bg-stone-900 text-white px-4 py-5 shadow-md">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          {data.org.logoUrl ? (
            <img src={data.org.logoUrl} alt="" className="h-9 w-auto rounded bg-white/10 p-1 object-contain" />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-stone-700 flex items-center justify-center font-bold text-lg">
              {data.org.name.charAt(0)}
            </div>
          )}
          <div>
            <div className="font-semibold leading-tight text-sm sm:text-base">{data.org.name}</div>
            <div className="text-[11px] text-stone-400">Account Portal</div>
          </div>
        </div>
      </header>

      <div className="flex-1 max-w-2xl mx-auto w-full px-4 py-6">

        {/* Greeting */}
        <p className="text-sm text-stone-600 mb-4">
          Hello <span className="font-semibold text-stone-800">{data.customer.name}</span> — here is a summary of your account with {data.org.name}.
        </p>

        {/* Account summary */}
        <div className="grid grid-cols-3 gap-3 mb-5">
          <SummaryCard
            label="Outstanding"
            value={money(totalOutstanding, currency)}
            accent="stone"
          />
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
        {showHistoryTab && (
          <div className="flex gap-1 mb-4 border-b border-stone-200">
            <TabButton active={tab === "open"} onClick={() => setTab("open")}>
              Open invoices ({invoices.length})
            </TabButton>
            <TabButton active={tab === "history"} onClick={() => setTab("history")}>
              Payment history ({data.paymentHistory.length})
            </TabButton>
          </div>
        )}

        {/* Open invoices tab */}
        {tab === "open" && (
          <>
            {invoices.length === 0 ? (
              <div className="bg-white rounded-xl ring-1 ring-stone-200 p-8 text-center">
                <div className="text-2xl mb-2">✓</div>
                <p className="text-sm font-medium text-stone-700">All clear!</p>
                <p className="text-sm text-stone-400 mt-1">No open invoices at this time.</p>
              </div>
            ) : (
              <>
                {/* Bulk instructions */}
                <div className="bg-blue-50 ring-1 ring-blue-100 rounded-xl px-4 py-3 mb-4 text-[13px] text-blue-800 space-y-1">
                  <p className="font-medium">How to respond</p>
                  <p className="text-blue-700">Select the invoices you intend to pay, choose a single payment date, and add an optional note. You can also raise a query on any individual invoice if something doesn't look right.</p>
                </div>

                {/* Select-all bar */}
                <div className="flex items-center gap-3 mb-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <Checkbox checked={selectAll} onChange={handleSelectAll} />
                    <span className="text-sm text-stone-600 font-medium">Select all</span>
                  </label>
                  {selected.size > 0 && (
                    <span className="text-[12px] text-stone-400">{selected.size} selected</span>
                  )}
                </div>

                {/* Invoice list */}
                <div className="space-y-3 mb-4">
                  {invoices.map(inv => {
                    const overdue = isOverdue(inv.dueDate);
                    const isSelected = selected.has(inv.id);
                    const dispute = disputes[inv.id] || { open: false, category: "", reason: "" };

                    return (
                      <div
                        key={inv.id}
                        className={`bg-white rounded-xl ring-1 overflow-hidden transition-shadow ${isSelected ? "ring-stone-900 shadow-md" : "ring-stone-200"}`}
                      >
                        {/* Invoice header row */}
                        <div className="px-4 py-3 flex items-start gap-3">
                          <div className="pt-0.5">
                            <Checkbox checked={isSelected} onChange={() => toggleSelect(inv.id)} />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-sm font-semibold text-stone-800">#{inv.invoiceNumber}</span>
                              {overdue && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-rose-100 text-rose-700 rounded">OVERDUE</span>
                              )}
                              {inv.alreadyDisputed && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">QUERY OPEN</span>
                              )}
                              {inv.existingPromise && !inv.alreadyDisputed && (
                                <span className="text-[10px] font-semibold px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">COMMITTED</span>
                              )}
                            </div>
                            <div className="text-[12px] text-stone-400 mt-0.5">
                              Due {inv.dueDate || "—"}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="font-semibold text-stone-900 text-sm">{money(inv.balance, inv.currency)}</div>
                            <div className="text-[11px] text-stone-400">balance due</div>
                          </div>
                        </div>

                        {/* Existing commitment note */}
                        {inv.existingPromise && !inv.alreadyDisputed && (
                          <div className="mx-4 mb-3 px-3 py-2 bg-emerald-50 ring-1 ring-emerald-200 rounded-lg text-[12px] text-emerald-800">
                            Previously committed to pay by <span className="font-semibold">{inv.existingPromise}</span>. Select to update.
                          </div>
                        )}

                        {/* Dispute toggle */}
                        {!isSelected && (
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
                            <p className="text-[12px] font-medium text-rose-800">Raise a query on #{inv.invoiceNumber}</p>
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
                              placeholder="Describe the issue (optional)…"
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

                {/* Bulk commitment panel */}
                {selected.size > 0 && (
                  <div className="bg-white ring-2 ring-stone-900 rounded-xl p-4 mb-4 space-y-3">
                    <div className="text-sm font-semibold text-stone-900">
                      Commitment for {selected.size} invoice{selected.size !== 1 ? "s" : ""}
                    </div>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <div className="flex-1">
                        <label className="text-[11px] text-stone-500 font-medium block mb-1">Payment date *</label>
                        <input
                          type="date"
                          min={todayStr}
                          value={bulkDate}
                          onChange={e => setBulkDate(e.target.value)}
                          className="w-full text-base sm:text-sm bg-white border border-stone-300 text-stone-900 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-stone-500"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="text-[11px] text-stone-500 font-medium block mb-1">Note (optional)</label>
                      <input
                        type="text"
                        placeholder="e.g. Payment scheduled via bank transfer"
                        value={bulkNote}
                        onChange={e => setBulkNote(e.target.value)}
                        className="w-full text-sm bg-white border border-stone-300 text-stone-800 rounded-lg px-3 py-2 placeholder-stone-400 focus:outline-none focus:ring-2 focus:ring-stone-500"
                      />
                    </div>
                    <p className="text-[11px] text-stone-500">
                      This commitment will be applied to all {selected.size} selected invoice{selected.size !== 1 ? "s" : ""}.
                      Our team will follow up if we don't receive payment by this date.
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
                    {submitting ? "Submitting…" : "Submit response"}
                  </button>
                  <p className="text-center text-[11px] text-stone-400 mt-2">
                    You can respond once per link. After submitting, this link will close.
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
                <div key={inv.id} className="bg-white rounded-xl ring-1 ring-stone-200 px-4 py-3 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <svg className="w-4 h-4 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-sm font-semibold text-stone-800">#{inv.invoiceNumber}</div>
                    <div className="text-[11px] text-stone-400">Invoiced {inv.invoiceDate || "—"}</div>
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

function SummaryCard({ label, value, accent }: { label: string; value: string; accent: "stone" | "rose" | "emerald" }) {
  const colors = {
    stone: "bg-white ring-stone-200 text-stone-800",
    rose:  "bg-rose-50 ring-rose-200 text-rose-700",
    emerald: "bg-emerald-50 ring-emerald-200 text-emerald-700",
  };
  return (
    <div className={`rounded-xl ring-1 px-3 py-3 ${colors[accent]}`}>
      <div className="text-[11px] font-medium text-stone-500 mb-0.5">{label}</div>
      <div className="text-sm font-bold leading-tight truncate">{value}</div>
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-stone-900 text-stone-900"
          : "border-transparent text-stone-500 hover:text-stone-700"
      }`}
    >
      {children}
    </button>
  );
}

function Checkbox({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      role="checkbox"
      aria-checked={checked}
      onClick={onChange}
      className={`w-5 h-5 rounded flex items-center justify-center transition-colors shrink-0 ${
        checked ? "bg-stone-900 ring-1 ring-stone-900" : "bg-white ring-1 ring-stone-300 hover:ring-stone-500"
      }`}
    >
      {checked && (
        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
        </svg>
      )}
    </button>
  );
}

function PortalFooter({ orgName: _ }: { orgName?: string }) {
  return (
    <footer className="text-center py-6 text-[11px] text-stone-400 border-t border-stone-200 mt-4">
      <span>Powered by </span>
      <a
        href="https://primeaccountax.com"
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold text-stone-600 hover:text-stone-800 underline underline-offset-2 transition-colors"
      >
        Prime Accountax
      </a>
      <span> · Accounts Receivable Management</span>
    </footer>
  );
}

function ReferralBanner({ customerName, orgName, onDismiss }: { customerName: string; orgName: string; onDismiss: () => void }) {
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
          <button
            onClick={onDismiss}
            className="text-stone-400 hover:text-white p-1"
            aria-label="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
