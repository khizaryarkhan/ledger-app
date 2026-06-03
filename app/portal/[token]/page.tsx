"use client";

import { useState, useEffect } from "react";

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

type PortalData = {
  org: { name: string; logoUrl: string | null };
  customer: { name: string };
  invoices: Invoice[];
};

type Response = {
  mode: "none" | "promise" | "dispute";
  promiseDate?: string;
  promiseAmount?: string;
  promiseNote?: string;
  disputeCategory?: string;
  disputeReason?: string;
};

const DISPUTE_CATEGORIES = ["Wrong Amount", "Already Paid", "Goods/Service", "Duplicate", "Other"];

function money(n: number, ccy: string) {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: ccy || "EUR", maximumFractionDigits: 2 }).format(n);
}

export default function PortalPage({ params }: { params: { token: string } }) {
  const [data, setData] = useState<PortalData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [responses, setResponses] = useState<Record<string, Response>>({});
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    fetch(`/api/portal/${params.token}`)
      .then(async res => {
        if (res.status === 410) { const d = await res.json(); setError(d.error || "expired"); return; }
        if (!res.ok) { setError("error"); return; }
        const d = await res.json();
        setData(d);
        const init: Record<string, Response> = {};
        d.invoices.forEach((i: Invoice) => { init[i.id] = { mode: "none" }; });
        setResponses(init);
      })
      .catch(() => setError("error"))
      .finally(() => setLoading(false));
  }, [params.token]);

  function update(id: string, patch: Partial<Response>) {
    setResponses(prev => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  const hasAnyResponse = Object.values(responses).some(r =>
    (r.mode === "promise" && r.promiseDate) || (r.mode === "dispute" && r.disputeCategory)
  );

  async function submit() {
    setSubmitting(true);
    const payload = {
      responses: Object.entries(responses)
        .filter(([, r]) => (r.mode === "promise" && r.promiseDate) || (r.mode === "dispute" && r.disputeCategory))
        .map(([invoiceId, r]) => ({
          invoiceId,
          ...(r.mode === "promise" && r.promiseDate
            ? { promise: { date: r.promiseDate, amount: r.promiseAmount ? Number(r.promiseAmount) : undefined, note: r.promiseNote } }
            : {}),
          ...(r.mode === "dispute" && r.disputeCategory
            ? { dispute: { category: r.disputeCategory, reason: r.disputeReason } }
            : {}),
        })),
    };
    try {
      const res = await fetch(`/api/portal/${params.token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) setDone(true);
      else { const d = await res.json().catch(() => ({})); setError(d.error || "error"); }
    } catch { setError("error"); }
    finally { setSubmitting(false); }
  }

  // ── States ──────────────────────────────────────────────────────────────
  if (loading) return <Centered><div className="text-stone-400 text-sm">Loading…</div></Centered>;

  if (error) {
    const msg = error === "completed"
      ? "This link has already been used. If you need to respond again, please contact us for a new link."
      : error === "expired"
      ? "This link has expired. Please contact us for a new link."
      : error === "not_found"
      ? "This link is invalid. Please check the link or contact us."
      : "Something went wrong. Please try again or contact us.";
    return (
      <Centered>
        <div className="max-w-md text-center px-6">
          <div className="w-12 h-12 rounded-full bg-stone-100 flex items-center justify-center mx-auto mb-4 text-2xl">🔒</div>
          <h1 className="text-lg font-semibold text-stone-800 mb-2">Link unavailable</h1>
          <p className="text-sm text-stone-500">{msg}</p>
        </div>
      </Centered>
    );
  }

  if (done) {
    return (
      <Centered>
        <div className="max-w-md text-center px-6">
          <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4 text-3xl">✓</div>
          <h1 className="text-xl font-semibold text-stone-800 mb-2">Thank you!</h1>
          <p className="text-sm text-stone-500">Your response has been received. Our team will be in touch if needed. You can now close this page.</p>
        </div>
      </Centered>
    );
  }

  if (!data) return null;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <div className="bg-stone-900 text-white px-5 py-6">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          {data.org.logoUrl
            ? <img src={data.org.logoUrl} alt="" className="h-9 w-auto rounded bg-white p-1" />
            : <div className="w-9 h-9 rounded-lg bg-stone-700 flex items-center justify-center font-semibold">{data.org.name.charAt(0)}</div>}
          <div>
            <div className="font-semibold leading-tight">{data.org.name}</div>
            <div className="text-[11px] text-stone-400">Invoice response portal</div>
          </div>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        <p className="text-sm text-stone-600 mb-1">Hello <span className="font-medium text-stone-800">{data.customer.name}</span>,</p>
        <p className="text-sm text-stone-500 mb-5">
          Below are your open invoices. For each, you can let us know when you expect to pay, or raise a query if something doesn’t look right.
        </p>

        {data.invoices.length === 0 ? (
          <div className="bg-white rounded-xl p-8 text-center text-sm text-stone-400 ring-1 ring-stone-200">
            No open invoices to show.
          </div>
        ) : (
          <div className="space-y-3">
            {data.invoices.map(inv => {
              const r = responses[inv.id] || { mode: "none" };
              return (
                <div key={inv.id} className="bg-white rounded-xl ring-1 ring-stone-200 overflow-hidden">
                  {/* Invoice header */}
                  <div className="px-4 py-3 flex items-center justify-between border-b border-stone-100">
                    <div>
                      <div className="font-mono text-sm font-medium text-stone-800">#{inv.invoiceNumber}</div>
                      <div className="text-[11px] text-stone-400">Due {inv.dueDate}</div>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-stone-900">{money(inv.balance, inv.currency)}</div>
                      <div className="text-[11px] text-stone-400">outstanding</div>
                    </div>
                  </div>

                  {/* Mode toggle */}
                  <div className="px-4 pt-3 flex gap-2">
                    <button
                      onClick={() => update(inv.id, { mode: r.mode === "promise" ? "none" : "promise" })}
                      className={`flex-1 text-xs font-medium py-2 rounded-lg transition-colors ${r.mode === "promise" ? "bg-stone-900 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}
                    >📅 I’ll pay by…</button>
                    <button
                      onClick={() => update(inv.id, { mode: r.mode === "dispute" ? "none" : "dispute" })}
                      className={`flex-1 text-xs font-medium py-2 rounded-lg transition-colors ${r.mode === "dispute" ? "bg-rose-600 text-white" : "bg-stone-100 text-stone-600 hover:bg-stone-200"}`}
                    >⚠️ Raise a query</button>
                  </div>

                  {/* Promise form */}
                  {r.mode === "promise" && (
                    <div className="px-4 py-3 space-y-2.5">
                      <div className="flex gap-2">
                        <div className="flex-1">
                          <label className="text-[11px] text-stone-500 font-medium">Payment date</label>
                          <input type="date" min={todayStr} value={r.promiseDate || ""}
                            onChange={e => update(inv.id, { promiseDate: e.target.value })}
                            className="w-full mt-1 text-sm border border-stone-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-300" />
                        </div>
                        <div className="w-32">
                          <label className="text-[11px] text-stone-500 font-medium">Amount (optional)</label>
                          <input type="number" placeholder="Full" value={r.promiseAmount || ""}
                            onChange={e => update(inv.id, { promiseAmount: e.target.value })}
                            className="w-full mt-1 text-sm border border-stone-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-300" />
                        </div>
                      </div>
                      <input type="text" placeholder="Note (optional)" value={r.promiseNote || ""}
                        onChange={e => update(inv.id, { promiseNote: e.target.value })}
                        className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-300" />
                      <p className="text-[11px] text-stone-400">Leave amount blank to commit to the full balance.</p>
                    </div>
                  )}

                  {/* Dispute form */}
                  {r.mode === "dispute" && (
                    <div className="px-4 py-3 space-y-2.5">
                      <div>
                        <label className="text-[11px] text-stone-500 font-medium">What’s the issue?</label>
                        <select value={r.disputeCategory || ""}
                          onChange={e => update(inv.id, { disputeCategory: e.target.value })}
                          className="w-full mt-1 text-sm border border-stone-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-300 bg-white">
                          <option value="">Select a reason…</option>
                          {DISPUTE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      <textarea placeholder="Please describe the issue…" rows={3} value={r.disputeReason || ""}
                        onChange={e => update(inv.id, { disputeReason: e.target.value })}
                        className="w-full text-sm border border-stone-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-stone-300 resize-none" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Submit */}
        {data.invoices.length > 0 && (
          <div className="mt-5 sticky bottom-4">
            <button
              onClick={submit}
              disabled={!hasAnyResponse || submitting}
              className="w-full bg-stone-900 text-white font-medium py-3 rounded-xl shadow-lg hover:bg-stone-800 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {submitting ? "Submitting…" : "Submit response"}
            </button>
            <p className="text-center text-[11px] text-stone-400 mt-2">
              You can respond once. After submitting, this link will close.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="min-h-screen bg-stone-50 flex items-center justify-center">{children}</div>;
}
