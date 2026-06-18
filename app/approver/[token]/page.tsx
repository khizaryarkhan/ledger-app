"use client";

import { useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import {
  CheckCircle2, XCircle, Loader2, AlertCircle, MessageCircle,
  Building2, Calendar, ChevronDown, ChevronRight, Send,
  CheckSquare, Square,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Bill {
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
  supplier: { name: string; email?: string } | null;
  lines: {
    id: string;
    description?: string;
    accountName?: string;
    itemName?: string;
    quantity: number;
    unitPrice: number;
    lineSubtotal: number;
    lineTax: number;
    lineTotal: number;
  }[];
}

interface Comment {
  id: string;
  billId: string;
  body: string;
  authorName: string;
  channel: string;
  createdAt: string;
}

interface PortalData {
  org: { name: string; logoUrl?: string };
  token: { approverEmail: string; approverName?: string };
  bills: Bill[];
  comments: Comment[];
}

interface BillDecision {
  action: "approve" | "reject" | null;
  note: string;
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

// ── Bill Decision Card ────────────────────────────────────────────────────────

function BillDecisionCard({
  bill,
  decision,
  selected,
  fieldError,
  comments,
  onToggleSelect,
  onSetDecision,
  onSetNote,
  onPostComment,
}: {
  bill: Bill;
  decision: BillDecision;
  selected: boolean;
  fieldError?: string;
  comments: Comment[];
  onToggleSelect: () => void;
  onSetDecision: (action: "approve" | "reject" | null) => void;
  onSetNote: (note: string) => void;
  onPostComment: (body: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatPosting, setChatPosting] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  async function postMsg() {
    if (!chatInput.trim() || chatPosting) return;
    setChatPosting(true);
    try {
      await onPostComment(chatInput.trim());
      setChatInput("");
    } finally { setChatPosting(false); }
  }
  const ccy = bill.currency;
  const totalSub = bill.lines.reduce((s, l) => s + (l.lineSubtotal ?? 0), 0);
  const getLineTax = (l: Bill["lines"][0]) => {
    if ((l.lineTax ?? 0) > 0) return l.lineTax;
    if (!bill.taxTotal || totalSub === 0) return 0;
    return bill.taxTotal * ((l.lineSubtotal ?? 0) / totalSub);
  };

  const borderCls =
    decision.action === "approve" ? "border-emerald-300" :
    decision.action === "reject"  ? "border-rose-300" :
    selected ? "border-violet-400" : "border-stone-200";

  const bgCls =
    decision.action === "approve" ? "bg-emerald-50/40" :
    decision.action === "reject"  ? "bg-rose-50/40" :
    "bg-white";

  return (
    <div className={`rounded-2xl border-2 shadow-sm overflow-hidden transition-all duration-150 ${borderCls} ${bgCls}`}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-4 py-4">
        {/* Checkbox */}
        <button
          onClick={onToggleSelect}
          className="shrink-0 text-stone-300 hover:text-violet-500 transition-colors"
          aria-label={selected ? "Deselect" : "Select"}
        >
          {selected
            ? <CheckSquare size={18} className="text-violet-600" />
            : <Square size={18} />
          }
        </button>

        {/* Bill summary — clickable to expand */}
        <button
          onClick={() => setExpanded(v => !v)}
          className="flex-1 flex items-center gap-3 text-left min-w-0"
        >
          <div className="w-9 h-9 rounded-xl bg-violet-100 flex items-center justify-center shrink-0">
            <span className="text-violet-700 text-[10px] font-black">#</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-stone-900 font-mono leading-tight">
              {bill.billNumber ?? bill.id.slice(0, 8)}
            </div>
            <div className="text-xs text-stone-400 mt-0.5 flex items-center gap-3 flex-wrap">
              {bill.supplier && (
                <span className="flex items-center gap-1">
                  <Building2 size={10} /> {bill.supplier.name}
                </span>
              )}
              {bill.dueDate && (
                <span className="flex items-center gap-1">
                  <Calendar size={10} /> Due {fmtDate(bill.dueDate)}
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0 ml-2">
            <span className="text-base font-bold text-stone-900 tabular-nums">
              {money(bill.total, ccy)}
            </span>
            {decision.action === "approve" && (
              <span className="hidden sm:flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-100 rounded-full px-2 py-0.5 whitespace-nowrap">
                <CheckCircle2 size={11} /> Approved
              </span>
            )}
            {decision.action === "reject" && (
              <span className="hidden sm:flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-100 rounded-full px-2 py-0.5 whitespace-nowrap">
                <XCircle size={11} /> Rejected
              </span>
            )}
            {expanded
              ? <ChevronDown size={15} className="text-stone-400 shrink-0" />
              : <ChevronRight size={15} className="text-stone-400 shrink-0" />
            }
          </div>
        </button>
      </div>

      {/* Expanded: amounts + line items */}
      {expanded && (
        <div className="border-t border-stone-100">
          {/* Amounts */}
          <div className="px-5 py-3 grid grid-cols-3 gap-4 bg-stone-50/60 text-sm">
            <div>
              <div className="text-xs text-stone-400 mb-0.5">Subtotal</div>
              <div className="font-medium text-stone-700 tabular-nums">{money(totalSub || (bill.total - (bill.taxTotal ?? 0)), ccy)}</div>
            </div>
            <div>
              <div className="text-xs text-stone-400 mb-0.5">Tax</div>
              <div className="font-medium text-stone-700 tabular-nums">{money(bill.taxTotal, ccy)}</div>
            </div>
            <div>
              <div className="text-xs text-stone-400 mb-0.5">Total</div>
              <div className="font-bold text-stone-900 tabular-nums">{money(bill.total, ccy)}</div>
            </div>
          </div>

          {bill.lines.length > 0 && (
            <div className="overflow-x-auto border-t border-stone-100">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-100">
                    {["Description", "Account / Item", "Qty", "Unit Price", "Ex. Tax", "Tax", "Inc. Tax"].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-[11px] font-semibold text-stone-400 uppercase tracking-wide whitespace-nowrap last:text-right">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bill.lines.map((line) => {
                    const lt = getLineTax(line);
                    return (
                      <tr key={line.id} className="border-b border-stone-100 last:border-0">
                        <td className="px-4 py-3 text-stone-700 max-w-[180px]">{line.description || "—"}</td>
                        <td className="px-4 py-3 text-stone-500 text-xs">{line.accountName || line.itemName || "—"}</td>
                        <td className="px-4 py-3 text-stone-600 whitespace-nowrap">{line.quantity}</td>
                        <td className="px-4 py-3 text-stone-600 whitespace-nowrap tabular-nums">{money(line.unitPrice, ccy)}</td>
                        <td className="px-4 py-3 text-stone-700 whitespace-nowrap tabular-nums">{money(line.lineSubtotal, ccy)}</td>
                        <td className="px-4 py-3 text-stone-600 whitespace-nowrap tabular-nums">{money(lt, ccy)}</td>
                        <td className="px-4 py-3 font-medium text-stone-900 whitespace-nowrap tabular-nums text-right">
                          {money((line.lineSubtotal ?? 0) + lt, ccy)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {bill.privateNote && (
            <div className="px-5 py-3 border-t border-stone-100">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                <div className="text-xs font-semibold text-amber-700 mb-1">Note from Finance Team</div>
                <p className="text-sm text-amber-800 whitespace-pre-wrap">{bill.privateNote}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Note + Decision buttons */}
      <div className="px-4 pb-4 pt-3 border-t border-stone-100/80 space-y-3">
        <textarea
          value={decision.note}
          onChange={(e) => onSetNote(e.target.value)}
          rows={2}
          placeholder={decision.action === "reject" ? "Reason for rejection (required)…" : "Add a note (optional)…"}
          className={`w-full px-3 py-2.5 text-sm rounded-xl border text-stone-900 placeholder-stone-400 focus:outline-none resize-none transition-colors ${
            fieldError
              ? "border-rose-300 bg-rose-50/40 focus:ring-2 focus:ring-rose-400/20"
              : "border-stone-200 bg-stone-50 focus:border-violet-400 focus:ring-2 focus:ring-violet-400/20"
          }`}
        />
        {fieldError && (
          <p className="text-xs text-rose-500 -mt-2 flex items-center gap-1">
            <AlertCircle size={11} /> {fieldError}
          </p>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => onSetDecision(decision.action === "approve" ? null : "approve")}
            className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-semibold transition-all ${
              decision.action === "approve"
                ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/25 scale-[0.99]"
                : "bg-stone-100 text-stone-600 hover:bg-emerald-50 hover:text-emerald-700 hover:border-emerald-200"
            }`}
          >
            <CheckCircle2 size={15} />
            Approve
          </button>
          <button
            onClick={() => onSetDecision(decision.action === "reject" ? null : "reject")}
            className={`flex-1 flex items-center justify-center gap-2 h-10 rounded-xl text-sm font-semibold transition-all ${
              decision.action === "reject"
                ? "bg-rose-600 text-white shadow-md shadow-rose-600/25 scale-[0.99]"
                : "bg-stone-100 text-stone-600 hover:bg-rose-50 hover:text-rose-700"
            }`}
          >
            <XCircle size={15} />
            Reject
          </button>
        </div>
      </div>

      {/* Per-bill chat */}
      <div className="border-t border-stone-100">
        <button
          onClick={() => setChatOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-stone-500 hover:bg-stone-50 transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <MessageCircle size={12} />
            {comments.length > 0 ? `Messages (${comments.length})` : "Ask a question"}
          </span>
          {chatOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        {chatOpen && (
          <div className="border-t border-stone-100">
            {comments.length > 0 && (
              <div className="px-4 pt-3 pb-1 space-y-2.5 max-h-44 overflow-y-auto">
                {comments.map((c) => (
                  <div key={c.id} className="flex gap-2">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${CHANNEL_DOT[c.channel] ?? "bg-stone-300"}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="text-[11px] font-semibold text-stone-600">{c.authorName}</span>
                        <span className="text-[10px] text-stone-400">{fmtRelative(c.createdAt)}</span>
                      </div>
                      <p className="text-xs text-stone-700 whitespace-pre-wrap">{c.body}</p>
                    </div>
                  </div>
                ))}
                <div ref={chatBottomRef} />
              </div>
            )}
            <div className="px-4 py-3 flex gap-2">
              <input
                type="text"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); postMsg(); } }}
                placeholder="Ask the finance team about this bill…"
                className="flex-1 px-3 py-1.5 text-sm rounded-xl border border-stone-200 bg-stone-50 text-stone-900 placeholder-stone-400 focus:border-violet-400 focus:outline-none"
              />
              <button
                onClick={postMsg}
                disabled={chatPosting || !chatInput.trim()}
                className="h-8 w-8 flex items-center justify-center rounded-xl bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40 shrink-0"
              >
                {chatPosting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Bulk Reject Modal ─────────────────────────────────────────────────────────

function BulkRejectModal({
  count,
  onClose,
  onConfirm,
}: {
  count: number;
  onClose: () => void;
  onConfirm: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-stone-200">
        <div className="px-6 py-5 border-b border-stone-100">
          <h3 className="text-base font-semibold text-stone-900">Reject {count} Bill{count > 1 ? "s" : ""}</h3>
          <p className="text-sm text-stone-500 mt-1">This reason will apply to all selected bills.</p>
        </div>
        <div className="p-6">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            autoFocus
            placeholder="e.g. Incorrect amount, missing PO reference…"
            className="w-full px-3 py-2.5 text-sm rounded-xl border border-stone-200 bg-stone-50 text-stone-900 placeholder-stone-400 focus:border-rose-400 focus:ring-2 focus:ring-rose-400/20 focus:outline-none resize-none"
          />
        </div>
        <div className="px-6 py-4 border-t border-stone-100 flex justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 text-sm font-medium rounded-lg border border-stone-200 text-stone-700 hover:bg-stone-50">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(note)}
            disabled={!note.trim()}
            className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-lg bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-50"
          >
            <XCircle size={13} /> Reject Selected
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
  const [doneResult, setDoneResult] = useState<{ approved: number; rejected: number } | null>(null);

  // Per-bill decision state
  const [decisions, setDecisions] = useState<Record<string, BillDecision>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Bulk selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showBulkReject, setShowBulkReject] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");

  // Per-bill comments (main portal) + flat comments (already-decided screen)
  const [billComments, setBillComments] = useState<Record<string, Comment[]>>({});
  const [comments, setComments] = useState<Comment[]>([]); // used for already-decided screen
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/approver/${token}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error && !d.alreadyDecided) { setErrorMsg(d.error); return; }
        if (d.alreadyDecided) {
          setAlreadyDecided({ status: d.status, decision: d.decision });
          setComments(d.comments ?? []);
          return;
        }
        setData(d);
        // Group comments by billId for per-bill chat
        const grouped: Record<string, Comment[]> = {};
        for (const c of (d.comments ?? []) as Comment[]) {
          if (!grouped[c.billId]) grouped[c.billId] = [];
          grouped[c.billId].push(c);
        }
        setBillComments(grouped);
        // Init all decisions as null/empty
        const init: Record<string, BillDecision> = {};
        for (const b of d.bills ?? []) init[b.id] = { action: null, note: "" };
        setDecisions(init);
      })
      .catch(() => setErrorMsg("Failed to load. Please check your link or try again."))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [comments]);

  function setDecision(billId: string, action: "approve" | "reject" | null) {
    setDecisions(prev => ({ ...prev, [billId]: { ...prev[billId], action } }));
    if (action !== "reject") setFieldErrors(prev => { const n = { ...prev }; delete n[billId]; return n; });
  }

  function setNote(billId: string, note: string) {
    setDecisions(prev => ({ ...prev, [billId]: { ...prev[billId], note } }));
    if (note.trim()) setFieldErrors(prev => { const n = { ...prev }; delete n[billId]; return n; });
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function toggleSelectAll() {
    if (!data) return;
    setSelected(prev =>
      prev.size === data.bills.length ? new Set() : new Set(data.bills.map(b => b.id))
    );
  }

  function applyBulkApprove() {
    setDecisions(prev => {
      const n = { ...prev };
      selected.forEach(id => { n[id] = { action: "approve", note: n[id]?.note ?? "" }; });
      return n;
    });
    setSelected(new Set());
  }

  function applyBulkReject(note: string) {
    setDecisions(prev => {
      const n = { ...prev };
      selected.forEach(id => { n[id] = { action: "reject", note }; });
      return n;
    });
    setFieldErrors(prev => {
      const n = { ...prev };
      selected.forEach(id => { if (note.trim()) delete n[id]; });
      return n;
    });
    setSelected(new Set());
    setShowBulkReject(false);
  }

  async function submit() {
    if (!data) return;
    // Validate: all bills need a decision
    const undecided = data.bills.filter(b => !decisions[b.id]?.action);
    if (undecided.length > 0) {
      setSubmitError(`${undecided.length} bill${undecided.length > 1 ? "s" : ""} still need a decision.`);
      return;
    }
    // Validate: rejected bills need a note
    const errs: Record<string, string> = {};
    for (const b of data.bills) {
      if (decisions[b.id]?.action === "reject" && !decisions[b.id]?.note?.trim()) {
        errs[b.id] = "A reason is required when rejecting.";
      }
    }
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      setSubmitError("Please add a rejection reason to highlighted bills.");
      return;
    }

    setSubmitting(true);
    setSubmitError("");
    try {
      const billDecisions = data.bills.map(b => ({
        billId: b.id,
        action: decisions[b.id].action,
        comment: decisions[b.id].note ?? "",
      }));
      const res = await fetch(`/api/approver/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decisions: billDecisions }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error ?? "Submission failed");
      setDoneResult({
        approved: billDecisions.filter(d => d.action === "approve").length,
        rejected: billDecisions.filter(d => d.action === "reject").length,
      });
    } catch (e: any) {
      setSubmitError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function postBillComment(billId: string, body: string): Promise<void> {
    const res = await fetch(`/api/approver/${token}/comment`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, billId }),
    });
    if (res.ok) {
      const c: Comment = await res.json();
      setBillComments(prev => ({
        ...prev,
        [billId]: [...(prev[billId] ?? []), c],
      }));
    }
  }

  // ── States ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <Loader2 size={28} className="animate-spin text-violet-500" />
      </div>
    );
  }

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

  if (alreadyDecided) {
    const approved = alreadyDecided.status === "Approved";
    const mixed = alreadyDecided.status === "Partial";
    return (
      <div className="min-h-screen bg-stone-50 p-4">
        <div className="max-w-lg mx-auto pt-8 space-y-4">
          {/* Status card */}
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6 text-center">
            <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${mixed ? "bg-violet-100" : approved ? "bg-emerald-100" : "bg-rose-100"}`}>
              {mixed ? <CheckCircle2 size={22} className="text-violet-600" /> :
               approved ? <CheckCircle2 size={22} className="text-emerald-600" /> :
               <XCircle size={22} className="text-rose-500" />}
            </div>
            <h2 className="text-base font-semibold text-stone-900 mb-1">Already {alreadyDecided.status}</h2>
            <p className="text-sm text-stone-500">This approval request has already been processed. You can still use the chat below.</p>
          </div>

          {/* Activity + chat — visible even after decision so the approver can ask questions */}
          <div className="bg-white rounded-2xl border border-stone-200 shadow-sm">
            <div className="px-5 py-3.5 border-b border-stone-100 flex items-center gap-2">
              <MessageCircle size={14} className="text-stone-400" />
              <span className="text-sm font-semibold text-stone-900">Activity</span>
            </div>
            {comments.length > 0 ? (
              <div className="px-5 py-4 space-y-3 max-h-72 overflow-y-auto border-b border-stone-100">
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
            ) : (
              <div className="px-5 py-4 text-xs text-stone-400 border-b border-stone-100">No messages yet.</div>
            )}
            <div className="px-5 py-4">
              <div className="flex gap-2">
                <textarea
                  value={commentBody}
                  onChange={(e) => setCommentBody(e.target.value)}
                  rows={2}
                  placeholder="Ask the finance team a question…"
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
        </div>
      </div>
    );
  }

  if (doneResult) {
    const allApproved = doneResult.rejected === 0;
    const allRejected = doneResult.approved === 0;
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-10 text-center max-w-sm w-full">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-5 ${allRejected ? "bg-rose-100" : "bg-emerald-100"}`}>
            {allRejected
              ? <XCircle size={30} className="text-rose-500" />
              : <CheckCircle2 size={30} className="text-emerald-600" />
            }
          </div>
          <h2 className="text-xl font-bold text-stone-900 mb-2">
            {allApproved ? "All Bills Approved!" : allRejected ? "All Bills Rejected" : "Decisions Submitted"}
          </h2>
          {!allApproved && !allRejected && (
            <div className="flex items-center justify-center gap-3 my-3">
              <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-700 bg-emerald-100 rounded-full px-3 py-1">
                <CheckCircle2 size={13} /> {doneResult.approved} approved
              </span>
              <span className="flex items-center gap-1.5 text-sm font-semibold text-rose-700 bg-rose-100 rounded-full px-3 py-1">
                <XCircle size={13} /> {doneResult.rejected} rejected
              </span>
            </div>
          )}
          <p className="text-sm text-stone-500 mt-2">
            Your decisions have been recorded. The finance team has been notified.
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { org, bills } = data;
  const isBatch = bills.length > 1;
  const ccy = bills[0]?.currency ?? "USD";
  const grandTotal = bills.reduce((s, b) => s + (b.total ?? 0), 0);
  const decidedCount = bills.filter(b => decisions[b.id]?.action != null).length;
  const allDecided = decidedCount === bills.length;
  const selectionSize = selected.size;
  const allSelected = selectionSize === bills.length;
  const someSelected = selectionSize > 0 && !allSelected;

  return (
    <div className="min-h-screen bg-stone-50">
      {/* Header */}
      <header className="bg-white border-b border-stone-200 px-4 py-4 sticky top-0 z-30">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          {org.logoUrl ? (
            <img src={org.logoUrl} alt={org.name} className="h-8 w-auto object-contain" />
          ) : (
            <div className="w-9 h-9 rounded-lg bg-violet-600 flex items-center justify-center text-white text-sm font-bold">
              {org.name.slice(0, 2).toUpperCase()}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-stone-900">{org.name}</div>
            <div className="text-xs text-stone-500">Bill Approval Portal</div>
          </div>
          {/* Progress pill */}
          {isBatch && (
            <div className={`shrink-0 text-xs font-semibold rounded-full px-3 py-1 ${
              allDecided ? "bg-emerald-100 text-emerald-700" : "bg-stone-100 text-stone-500"
            }`}>
              {decidedCount}/{bills.length} decided
            </div>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* Summary banner */}
        <div className="bg-violet-600 rounded-2xl px-6 py-5 text-white">
          <div className="text-violet-200 text-xs font-semibold uppercase tracking-wide mb-1">
            {isBatch ? `${bills.length} Bills for Approval` : "Bill for Approval"}
          </div>
          <div className="text-3xl font-bold tabular-nums">{money(grandTotal, ccy)}</div>
          {isBatch && (
            <div className="text-violet-300 text-xs mt-1.5 font-mono">
              {bills.map(b => b.billNumber ?? b.id.slice(0, 8)).join(" · ")}
            </div>
          )}
        </div>

        {/* Bulk action bar — appears when bills are selected */}
        {isBatch && selectionSize > 0 && (
          <div className="sticky top-[73px] z-20 bg-violet-700 rounded-2xl px-4 py-3 flex items-center gap-3 shadow-lg shadow-violet-900/20">
            <span className="text-sm font-semibold text-white">{selectionSize} selected</span>
            <div className="flex-1" />
            <button
              onClick={applyBulkApprove}
              className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-emerald-500 hover:bg-emerald-400 text-white transition-colors"
            >
              <CheckCircle2 size={13} /> Approve Selected
            </button>
            <button
              onClick={() => setShowBulkReject(true)}
              className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-rose-500 hover:bg-rose-400 text-white transition-colors"
            >
              <XCircle size={13} /> Reject Selected
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="h-8 px-3 text-xs text-violet-200 hover:text-white transition-colors"
            >
              Clear
            </button>
          </div>
        )}

        {/* Select-all row (batch only) */}
        {isBatch && (
          <div className="flex items-center gap-2 px-1">
            <button onClick={toggleSelectAll} className="flex items-center gap-2 text-sm text-stone-500 hover:text-stone-800 transition-colors">
              {allSelected
                ? <CheckSquare size={16} className="text-violet-600" />
                : someSelected
                  ? <CheckSquare size={16} className="text-violet-400" />
                  : <Square size={16} className="text-stone-300" />
              }
              <span className="text-xs font-medium">{allSelected ? "Deselect all" : "Select all"}</span>
            </button>
            <div className="flex-1" />
            <span className="text-xs text-stone-400">{decidedCount} of {bills.length} decided</span>
          </div>
        )}

        {/* Bill decision cards */}
        {bills.map(bill => (
          <BillDecisionCard
            key={bill.id}
            bill={bill}
            decision={decisions[bill.id] ?? { action: null, note: "" }}
            selected={selected.has(bill.id)}
            fieldError={fieldErrors[bill.id]}
            comments={billComments[bill.id] ?? []}
            onToggleSelect={() => toggleSelect(bill.id)}
            onSetDecision={(action) => setDecision(bill.id, action)}
            onSetNote={(note) => setNote(bill.id, note)}
            onPostComment={(body) => postBillComment(bill.id, body)}
          />
        ))}

        {/* Batch total */}
        {isBatch && (
          <div className="bg-white rounded-2xl border border-stone-200 px-5 py-4 flex items-center justify-between">
            <span className="text-sm font-semibold text-stone-700">Batch Total ({bills.length} bills)</span>
            <span className="text-lg font-bold text-stone-900 tabular-nums">{money(grandTotal, ccy)}</span>
          </div>
        )}

        {/* Submit section */}
        <div className="bg-white rounded-2xl border border-stone-200 shadow-sm p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-stone-900">Submit Decisions</h3>
              <p className="text-xs text-stone-500 mt-0.5">
                Reviewing as <strong>{data.token.approverEmail}</strong> · Decisions are final and logged.
              </p>
            </div>
            {isBatch && (
              <div className="text-right">
                <div className="text-lg font-bold text-stone-900">{decidedCount}/{bills.length}</div>
                <div className="text-xs text-stone-400">bills decided</div>
              </div>
            )}
          </div>

          {/* Progress bar */}
          {isBatch && (
            <div className="h-2 bg-stone-100 rounded-full mb-4 overflow-hidden">
              <div
                className="h-full bg-violet-500 rounded-full transition-all duration-300"
                style={{ width: `${(decidedCount / bills.length) * 100}%` }}
              />
            </div>
          )}

          {submitError && (
            <div className="flex items-center gap-2 px-4 py-3 bg-rose-50 border border-rose-200 rounded-xl text-sm text-rose-700 mb-4">
              <AlertCircle size={15} /> {submitError}
            </div>
          )}

          <button
            onClick={submit}
            disabled={submitting || !allDecided}
            className={`w-full flex items-center justify-center gap-2 h-12 rounded-xl text-sm font-semibold transition-all ${
              allDecided
                ? "bg-violet-600 hover:bg-violet-500 text-white shadow-md shadow-violet-600/20"
                : "bg-stone-100 text-stone-400 cursor-not-allowed"
            }`}
          >
            {submitting
              ? <><Loader2 size={16} className="animate-spin" /> Submitting…</>
              : allDecided
                ? <><CheckCircle2 size={16} /> Submit {bills.length > 1 ? `All ${bills.length} ` : ""}Decision{bills.length > 1 ? "s" : ""}</>
                : `Decide ${bills.length - decidedCount} more bill${bills.length - decidedCount > 1 ? "s" : ""} to submit`
            }
          </button>
        </div>

        <p className="text-center text-xs text-stone-400 pb-8">
          Powered by {org.name} · Secure one-time link
        </p>
      </main>

      {showBulkReject && (
        <BulkRejectModal
          count={selectionSize}
          onClose={() => setShowBulkReject(false)}
          onConfirm={applyBulkReject}
        />
      )}
    </div>
  );
}
