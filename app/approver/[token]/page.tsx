"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import {
  CheckCircle2, XCircle, Loader2, AlertCircle, MessageCircle,
  Building2, Calendar, Hash, Send, X,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface PortalData {
  org: { name: string; logoUrl?: string };
  token: { approverEmail: string; approverName?: string };
  bill: {
    id: string;
    billNumber?: string;
    billDate?: string;
    dueDate?: string;
    currency: string;
    subtotal: number;
    taxTotal: number;
    total: number;
    balance: number;
    privateNote?: string;
    workflowStatus: string;
  };
  supplier: { name: string; email?: string } | null;
  lines: {
    id: string;
    description?: string;
    quantity: number;
    unitPrice: number;
    accountId?: string;
    lineSubtotal: number;
    lineTax: number;
    lineTotal: number;
  }[];
  comments: {
    id: string;
    body: string;
    authorName: string;
    channel: string;
    createdAt: string;
  }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function money(amount: number | null | undefined, currency: string) {
  if (amount == null) return "—";
  const sym = currency === "GBP" ? "£" : currency === "EUR" ? "€" : "$";
  return `${sym}${Math.abs(amount).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtRelative(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const CHANNEL_DOT: Record<string, string> = {
  approver: "bg-violet-400",
  system: "bg-blue-400",
  email: "bg-amber-400",
};

// ── Reject Modal ──────────────────────────────────────────────────────────────

function RejectModal({
  open,
  onClose,
  onConfirm,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  loading: boolean;
}) {
  const [reason, setReason] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-stone-200">
        <div className="px-6 py-5 border-b border-stone-100">
          <h3 className="text-base font-semibold text-stone-900">Reason for Rejection</h3>
          <p className="text-sm text-stone-500 mt-1">Please provide a reason so the finance team can follow up.</p>
        </div>
        <div className="p-6">
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={4}
            placeholder="e.g. Incorrect amount, missing PO reference, goods not received…"
            className="w-full px-3 py-2.5 text-sm rounded-xl border border-stone-200 bg-stone-50 text-stone-900 placeholder-stone-400 focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 focus:outline-none resize-none"
          />
        </div>
        <div className="px-6 py-4 border-t border-stone-100 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            disabled={loading}
            className="h-9 px-4 text-sm font-medium rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-50 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={loading || !reason.trim()}
            className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-lg bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <XCircle size={13} />}
            Reject Bill
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Portal Page ──────────────────────────────────────────────────────────

export default function ApproverPortalPage() {
  const { token } = useParams<{ token: string }>();

  const [data, setData] = useState<PortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [alreadyDecided, setAlreadyDecided] = useState<{ status: string; decision?: string } | null>(null);
  const [done, setDone] = useState<"approved" | "rejected" | null>(null);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [showReject, setShowReject] = useState(false);

  const [comments, setComments] = useState<PortalData["comments"]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [posting, setPosting] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/approver/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error && !d.alreadyDecided) { setErrorMsg(d.error); return; }
        if (d.alreadyDecided) { setAlreadyDecided({ status: d.status, decision: d.decision }); return; }
        setData(d);
        setComments(d.comments ?? []);
      })
      .catch(() => setErrorMsg("Failed to load. Please check your link or try again."))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  async function submit(action: "approve" | "reject", comment = "") {
    setSubmitting(true);
    setSubmitError("");
    try {
      const res = await fetch(`/api/approver/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Failed");
      setDone(action);
    } catch (e: any) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function postComment() {
    if (!commentBody.trim()) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/approver/${token}/comment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentBody.trim() }),
      });
      if (res.ok) {
        const c = await res.json();
        setComments((prev) => [...prev, c]);
        setCommentBody("");
      }
    } finally { setPosting(false); }
  }

  // ── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-violet-500" />
      </div>
    );
  }

  // ── Error ──────────────────────────────────────────────────────────────────
  if (errorMsg) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8 text-center max-w-sm w-full">
          <div className="w-12 h-12 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={22} className="text-rose-500" />
          </div>
          <h2 className="text-lg font-semibold text-stone-900 mb-2">Link Unavailable</h2>
          <p className="text-sm text-stone-500">{errorMsg}</p>
        </div>
      </div>
    );
  }

  // ── Already Decided ────────────────────────────────────────────────────────
  if (alreadyDecided) {
    const approved = alreadyDecided.status === "Approved";
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-8 text-center max-w-sm w-full">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4 ${approved ? "bg-emerald-100" : "bg-rose-100"}`}>
            {approved
              ? <CheckCircle2 size={22} className="text-emerald-600" />
              : <XCircle size={22} className="text-rose-500" />
            }
          </div>
          <h2 className="text-lg font-semibold text-stone-900 mb-2">
            Bill Already {alreadyDecided.status}
          </h2>
          {alreadyDecided.decision && (
            <p className="text-sm text-stone-500 mt-2 italic">"{alreadyDecided.decision}"</p>
          )}
        </div>
      </div>
    );
  }

  // ── Done ───────────────────────────────────────────────────────────────────
  if (done) {
    const approved = done === "approved";
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-10 text-center max-w-sm w-full">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 ${approved ? "bg-emerald-100" : "bg-rose-100"}`}>
            {approved
              ? <CheckCircle2 size={30} className="text-emerald-600" />
              : <XCircle size={30} className="text-rose-500" />
            }
          </div>
          <h2 className="text-xl font-bold text-stone-900 mb-2">
            {approved ? "Bill Approved!" : "Bill Rejected"}
          </h2>
          <p className="text-sm text-stone-500">
            {approved
              ? "Your approval has been recorded. The finance team will process the payment."
              : "Your response has been recorded. The finance team has been notified."}
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;
  const { org, bill, supplier, lines } = data;

  // Tax proration (same as bill detail page)
  const totalSub = lines.reduce((a, l) => a + (l.lineSubtotal ?? 0), 0);
  const getLineTax = (l: typeof lines[0]) => {
    if ((l.lineTax ?? 0) > 0) return l.lineTax;
    if (!bill.taxTotal || totalSub === 0) return 0;
    return bill.taxTotal * ((l.lineSubtotal ?? 0) / totalSub);
  };

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 px-4 py-4">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          {org.logoUrl ? (
            <img src={org.logoUrl} alt={org.name} className="h-8 w-auto object-contain" />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-violet-600 flex items-center justify-center text-white text-sm font-bold">
              {org.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div>
            <div className="text-sm font-semibold text-stone-900">{org.name}</div>
            <div className="text-xs text-stone-500">Bill Approval Portal</div>
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-8 space-y-5">
        {/* Bill overview card */}
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
          <div className="bg-violet-600 px-6 py-5">
            <div className="text-violet-200 text-xs font-semibold uppercase tracking-wide mb-1">Bill for Approval</div>
            <div className="text-white text-2xl font-bold tabular-nums">{money(bill.total, bill.currency)}</div>
            {bill.billNumber && (
              <div className="text-violet-200 text-sm mt-1 font-mono">{bill.billNumber}</div>
            )}
          </div>
          <div className="p-6">
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm mb-5">
              {supplier && (
                <div>
                  <div className="text-xs text-stone-400 mb-0.5 flex items-center gap-1">
                    <Building2 size={11} /> Supplier
                  </div>
                  <div className="font-semibold text-stone-900">{supplier.name}</div>
                </div>
              )}
              {bill.dueDate && (
                <div>
                  <div className="text-xs text-stone-400 mb-0.5 flex items-center gap-1">
                    <Calendar size={11} /> Due Date
                  </div>
                  <div className="font-semibold text-stone-900">{fmtDate(bill.dueDate)}</div>
                </div>
              )}
              {bill.billDate && (
                <div>
                  <div className="text-xs text-stone-400 mb-0.5">Bill Date</div>
                  <div className="text-stone-700">{fmtDate(bill.billDate)}</div>
                </div>
              )}
              <div>
                <div className="text-xs text-stone-400 mb-0.5">Currency</div>
                <div className="text-stone-700">{bill.currency}</div>
              </div>
            </div>

            {/* Amounts summary */}
            <div className="border-t border-stone-100 pt-4 space-y-1.5">
              <div className="flex justify-between text-sm text-stone-600">
                <span>Subtotal (Ex. Tax)</span>
                <span className="tabular-nums">{money(bill.subtotal, bill.currency)}</span>
              </div>
              <div className="flex justify-between text-sm text-stone-600">
                <span>Tax</span>
                <span className="tabular-nums">{money(bill.taxTotal, bill.currency)}</span>
              </div>
              <div className="flex justify-between text-base font-bold text-stone-900 pt-1 border-t border-stone-100">
                <span>Total</span>
                <span className="tabular-nums">{money(bill.total, bill.currency)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Line items */}
        {lines.length > 0 && (
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-stone-100">
              <h3 className="text-sm font-semibold text-stone-900">Line Items</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-100">
                    {["Description", "Qty", "Unit Price", "Ex. Tax", "Tax", "Inc. Tax"].map((h) => (
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-stone-400 uppercase tracking-wide whitespace-nowrap last:text-right">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => {
                    const lt = getLineTax(line);
                    return (
                      <tr key={line.id} className="border-b border-stone-100 last:border-0">
                        <td className="px-4 py-3 text-stone-700 max-w-[200px]">{line.description || "—"}</td>
                        <td className="px-4 py-3 text-stone-600 whitespace-nowrap">{line.quantity}</td>
                        <td className="px-4 py-3 text-stone-600 whitespace-nowrap tabular-nums">{money(line.unitPrice, bill.currency)}</td>
                        <td className="px-4 py-3 text-stone-700 whitespace-nowrap tabular-nums">{money(line.lineSubtotal, bill.currency)}</td>
                        <td className="px-4 py-3 text-stone-600 whitespace-nowrap tabular-nums">{money(lt, bill.currency)}</td>
                        <td className="px-4 py-3 font-medium text-stone-900 whitespace-nowrap tabular-nums text-right">{money((line.lineSubtotal ?? 0) + lt, bill.currency)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Note from requester */}
        {bill.privateNote && (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
            <div className="text-xs font-semibold text-amber-700 mb-1">Note from Finance Team</div>
            <p className="text-sm text-amber-800 whitespace-pre-wrap">{bill.privateNote}</p>
          </div>
        )}

        {/* Comments / Activity */}
        {comments.length > 0 && (
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm">
            <div className="px-6 py-4 border-b border-stone-100">
              <h3 className="text-sm font-semibold text-stone-900 flex items-center gap-2">
                <MessageCircle size={15} className="text-stone-400" /> Activity
              </h3>
            </div>
            <div className="px-6 py-4 space-y-3 max-h-64 overflow-y-auto">
              {comments.map((c) => (
                <div key={c.id} className="flex gap-3">
                  <div className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 ${CHANNEL_DOT[c.channel] ?? "bg-stone-300"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-semibold text-stone-600">{c.authorName}</span>
                      <span className="text-[10px] text-stone-400">{fmtRelative(c.createdAt)}</span>
                    </div>
                    <p className="text-sm text-stone-700 whitespace-pre-wrap">{c.body}</p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            {/* Add comment (approver) */}
            <div className="px-6 pb-5">
              <div className="flex gap-2">
                <textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  rows={2}
                  placeholder="Add a comment or question…"
                  className="flex-1 px-3 py-2 text-sm rounded-xl border border-stone-200 bg-stone-50 text-stone-900 placeholder-stone-400 focus:border-violet-500 focus:outline-none resize-none"
                />
                <button
                  onClick={postComment}
                  disabled={posting || !commentBody.trim()}
                  className="self-end h-9 w-9 flex items-center justify-center rounded-xl bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40"
                >
                  {posting ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Submit error */}
        {submitError && (
          <div className="flex items-center gap-2 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700">
            <AlertCircle size={15} /> {submitError}
          </div>
        )}

        {/* Action buttons */}
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <h3 className="text-sm font-semibold text-stone-900 mb-1">Your Decision</h3>
          <p className="text-xs text-stone-500 mb-5">
            Reviewing as <strong>{data.token.approverEmail}</strong>.
            This action is final and will be logged.
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => submit("approve")}
              disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 h-12 px-5 text-sm font-semibold rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50 transition-colors"
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
              Approve Bill
            </button>
            <button
              onClick={() => setShowReject(true)}
              disabled={submitting}
              className="flex-1 inline-flex items-center justify-center gap-2 h-12 px-5 text-sm font-semibold rounded-xl border-2 border-rose-200 text-rose-600 hover:bg-rose-50 disabled:opacity-50 transition-colors"
            >
              <XCircle size={16} />
              Reject
            </button>
          </div>
        </div>

        <p className="text-center text-xs text-stone-400 pb-8">
          Powered by {org.name} · Secure one-time link
        </p>
      </main>

      <RejectModal
        open={showReject}
        onClose={() => setShowReject(false)}
        onConfirm={(reason) => { setShowReject(false); submit("reject", reason); }}
        loading={submitting}
      />
    </div>
  );
}
