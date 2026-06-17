"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Download, Loader2, AlertCircle, CheckCircle2, XCircle,
  PauseCircle, PlayCircle, CreditCard, Eye, CheckCheck, CloudUpload,
  MessageSquare, FileText, X, Plus, Send,
} from "lucide-react";
import { Card, Badge, Button } from "@/components/ui";
import { fmt } from "@/lib/format";

// ── Types ─────────────────────────────────────────────────────────────────────

interface LineItem {
  id: string;
  description?: string;
  quantity: number;
  unitPrice: number;
  accountId?: string;
  taxRateId?: string;
  lineSubtotal: number;
  lineTax: number;
  lineTotal: number;
}

interface Supplier {
  id: string;
  name: string;
  email?: string;
  paymentTerms?: number;
}

interface Query {
  id: string;
  subject: string;
  status: string;
  message?: string;
  createdAt: string;
}

interface Approval {
  id: string;
  approverUserId?: string;
  status: string;
  decision?: string;
  comments?: string;
  createdAt: string;
}

interface Bill {
  id: string;
  billNumber?: string;
  supplierId?: string;
  billDate?: string;
  dueDate?: string;
  currency: string;
  accountingPaymentStatus: string; // Unpaid | Partially Paid | Paid | Voided
  workflowStatus: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  amountPaid: number;
  balance: number;
  source?: string;
  qboId?: string;
  xeroId?: string;
  privateNote?: string;
  createdAt: string;
  lines: LineItem[];
  supplier: Supplier | null;
  openQueries: Query[];
  approvalHistory: Approval[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function acctBadge(s: string) {
  const m: Record<string, string> = {
    Unpaid: "yellow", "Partially Paid": "orange", Paid: "green", Voided: "neutral",
    // legacy QBO/Xero values
    Draft: "neutral", Submitted: "blue", Authorised: "green",
  };
  return m[s] ?? "neutral";
}

function wfBadge(s: string) {
  const m: Record<string, string> = {
    "Pending Review": "yellow", "Pending Approval": "orange", Approved: "green",
    "On Hold": "orange", "Ready for Payment": "purple", Rejected: "red",
    "Synced from Accounting": "blue",
  };
  return m[s] ?? "neutral";
}

function fmtDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function daysUntilDue(d?: string) {
  if (!d) return 0;
  const due = new Date(d); due.setHours(0, 0, 0, 0);
  const now = new Date(); now.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - now.getTime()) / 86400000);
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

// ── Raise Query Modal ─────────────────────────────────────────────────────────

function RaiseQueryModal({ open, onClose, onSubmit, loading }: {
  open: boolean; onClose: () => void;
  onSubmit: (s: string, m: string) => void; loading: boolean;
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-stone-900 border border-stone-800 rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800">
          <h3 className="text-base font-semibold text-white">Raise Supplier Query</h3>
          <button onClick={onClose} className="p-1 rounded text-stone-500 hover:text-white hover:bg-stone-800"><X size={16} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Subject</label>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Query subject…"
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Message</label>
            <textarea value={message} onChange={e => setMessage(e.target.value)} rows={4} placeholder="Describe your query…"
              className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none" />
          </div>
        </div>
        <div className="px-5 py-3.5 border-t border-stone-800 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <button onClick={() => onSubmit(subject, message)} disabled={loading || !subject.trim()}
            className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50">
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Raise Query
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reason Modal (Reject / Hold) ──────────────────────────────────────────────

function ReasonModal({ open, onClose, onConfirm, loading, title, confirmLabel, confirmClass }: {
  open: boolean; onClose: () => void; onConfirm: (r: string) => void;
  loading: boolean; title: string; confirmLabel: string; confirmClass: string;
}) {
  const [reason, setReason] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-stone-900 border border-stone-800 rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-stone-800">
          <h3 className="text-base font-semibold text-white">{title}</h3>
        </div>
        <div className="p-5">
          <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} placeholder="Reason…"
            className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none" />
        </div>
        <div className="px-5 py-3.5 border-t border-stone-800 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <button onClick={() => onConfirm(reason)} disabled={loading || !reason.trim()}
            className={`inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md text-white disabled:opacity-50 ${confirmClass}`}>
            {loading ? <Loader2 size={13} className="animate-spin" /> : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function BillDetailPage() {
  const { id } = useParams<{ id: string }>();

  const [bill, setBill] = useState<Bill | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"overview" | "lines" | "queries" | "history">("overview");
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [pushingNote, setPushingNote] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [showQueryModal, setShowQueryModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/payables/bills/${id}`);
      if (!res.ok) throw new Error("Bill not found");
      const data = await res.json();
      setBill(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function callAction(url: string, body?: object) {
    setActionLoading(true);
    setActionError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || "Action failed");
      }
      await load();
    } catch (e: any) {
      setActionError(e.message);
    } finally {
      setActionLoading(false);
    }
  }

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    try {
      const res = await fetch(`/api/payables/bills/${id}/pdf`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        alert(e.error || "Failed to download PDF");
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Bill-${bill?.billNumber ?? id}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      clearTimeout(timer);
      if (e?.name === "AbortError") alert("PDF download timed out — please try again.");
      else alert("Failed to download PDF");
    } finally {
      setDownloadingPdf(false);
    }
  };

  async function handleRaiseQuery(subject: string, message: string) {
    setShowQueryModal(false);
    setActionLoading(true);
    try {
      await fetch("/api/payables/supplier-queries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ billId: id, subject, message }),
      });
      await load();
    } catch {
    } finally {
      setActionLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto space-y-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-8 w-80" />
        <div className="grid grid-cols-4 gap-3">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  if (error || !bill) {
    return (
      <div className="p-6 max-w-[1400px] mx-auto">
        <div className="flex items-center gap-2 p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400">
          <AlertCircle size={16} /> {error || "Bill not found"}
          <button onClick={load} className="ml-auto text-rose-300 hover:text-white underline text-sm">Retry</button>
        </div>
      </div>
    );
  }

  const daysDiff = daysUntilDue(bill.dueDate);
  const isOverdue = daysDiff < 0 && bill.accountingPaymentStatus !== "Paid" && bill.accountingPaymentStatus !== "Voided";

  // Per-line tax: QBO stores tax at bill level (bill.taxTotal), not per line.
  // Prorate it across lines by each line's share of subtotal.
  const totalSubtotal = lines.reduce((a, l) => a + (l.lineSubtotal ?? 0), 0);
  const getLineTax = (item: LineItem) => {
    if ((item.lineTax ?? 0) > 0) return item.lineTax;
    if (!bill.taxTotal || totalSubtotal === 0) return 0;
    return bill.taxTotal * ((item.lineSubtotal ?? 0) / totalSubtotal);
  };
  const getLineIncTax = (item: LineItem) => (item.lineSubtotal ?? 0) + getLineTax(item);
  const canDownloadPdf = !!(bill.qboId || bill.xeroId);
  const wf = bill.workflowStatus;
  const lines = bill.lines ?? [];
  const queries = bill.openQueries ?? [];
  const history = bill.approvalHistory ?? [];

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Back */}
      <Link href="/payables/bills" className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-200 mb-4">
        <ArrowLeft size={14} /> Back to bills
      </Link>

      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <h1 className="text-2xl font-semibold text-white tracking-tight font-mono">
              {bill.billNumber || "No #"}
            </h1>
            <Badge variant={acctBadge(bill.accountingPaymentStatus)} size="md">{bill.accountingPaymentStatus}</Badge>
            <Badge variant={wfBadge(bill.workflowStatus)} size="md">{bill.workflowStatus}</Badge>
          </div>
          <div className="flex items-center gap-2 text-sm text-stone-400">
            {bill.supplier ? (
              <Link href={`/payables/suppliers/${bill.supplier.id}`} className="hover:text-white hover:underline">
                {bill.supplier.name}
              </Link>
            ) : (
              <span>Unknown supplier</span>
            )}
            {bill.source && (
              <>
                <span className="text-stone-600">·</span>
                <span className="text-stone-500">{bill.source}</span>
              </>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {canDownloadPdf && (
            <Button variant="secondary" onClick={handleDownloadPdf} disabled={downloadingPdf}>
              {downloadingPdf
                ? <span className="flex items-center gap-1.5"><Loader2 size={14} className="animate-spin" />Downloading…</span>
                : <span className="flex items-center gap-1.5"><Download size={14} />Download PDF</span>}
            </Button>
          )}
          {(wf === "Synced from Accounting" || wf === "Pending Review") && (
            <button
              onClick={() => callAction(`/api/payables/bills/${id}/mark-reviewed`)}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <Eye size={14} />}
              Mark as Reviewed
            </button>
          )}
          {wf === "Pending Approval" && (
            <>
              <button
                onClick={() => callAction(`/api/payables/bills/${id}/approve`)}
                disabled={actionLoading}
                className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-50"
              >
                {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <CheckCheck size={14} />}
                Approve
              </button>
              <Button variant="danger" onClick={() => setShowRejectModal(true)} disabled={actionLoading}>
                <XCircle size={14} /> Reject
              </Button>
              <button
                onClick={() => setShowHoldModal(true)}
                disabled={actionLoading}
                className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-stone-800 hover:bg-stone-700 text-stone-200 ring-1 ring-stone-700 disabled:opacity-50"
              >
                <PauseCircle size={14} /> Put On Hold
              </button>
            </>
          )}
          {wf === "Approved" && (
            <button
              onClick={() => callAction(`/api/payables/bills/${id}/ready-for-payment`)}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <CreditCard size={14} />}
              Mark Ready for Payment
            </button>
          )}
          {wf === "On Hold" && (
            <button
              onClick={() => callAction(`/api/payables/bills/${id}/resume`)}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={14} />}
              Resume
            </button>
          )}
          {wf === "Ready for Payment" && (
            <button
              onClick={() => callAction(`/api/payables/bills/${id}/add-to-payment-run`)}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <CreditCard size={14} />}
              Add to Payment Run
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={14} /> {actionError}
          <button onClick={() => setActionError(null)} className="ml-auto"><X size={13} /></button>
        </div>
      )}

      {/* KPI Cards — mirrors AR invoice detail */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Total</div>
          <div className="text-xl font-semibold text-white tabular-nums">{fmt.money(bill.total, bill.currency)}</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Paid</div>
          <div className="text-xl font-semibold text-emerald-400 tabular-nums">{fmt.money(bill.amountPaid ?? 0, bill.currency)}</div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Balance</div>
          <div className={`text-xl font-semibold tabular-nums ${isOverdue ? "text-rose-400" : "text-white"}`}>
            {fmt.money(bill.balance, bill.currency)}
          </div>
        </Card>
        <Card padding="md">
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Due</div>
          <div className="text-xl font-semibold text-white tabular-nums">{fmtDate(bill.dueDate)}</div>
          {isOverdue && (
            <div className="text-[11px] text-rose-400 font-medium mt-1">{Math.abs(daysDiff)} days overdue</div>
          )}
          {!isOverdue && daysDiff >= 0 && daysDiff <= 7 && (
            <div className="text-[11px] text-amber-400 font-medium mt-1">{daysDiff} days left</div>
          )}
        </Card>
      </div>

      {/* Tabs */}
      <div className="border-b border-stone-800 mb-5">
        <div className="flex items-center gap-1">
          {[
            { id: "overview", label: "Overview" },
            { id: "lines",    label: `Line Items (${lines.length})` },
            { id: "queries",  label: `Queries (${queries.length})` },
            { id: "history",  label: `Approval History (${history.length})` },
          ].map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id as any)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tab === t.id
                  ? "border-violet-400 text-white"
                  : "border-transparent text-stone-500 hover:text-stone-200"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Overview Tab ──────────────────────────────────────────────────────── */}
      {tab === "overview" && (
        <div className="grid grid-cols-3 gap-5">
          <Card className="col-span-2">
            <h3 className="text-sm font-semibold text-white mb-4">Bill Details</h3>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm text-stone-200">
              <div>
                <dt className="text-xs text-stone-500 mb-0.5">Bill date</dt>
                <dd>{fmtDate(bill.billDate)}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500 mb-0.5">Due date</dt>
                <dd className={isOverdue ? "text-rose-400" : ""}>{fmtDate(bill.dueDate)}</dd>
              </div>
              {bill.supplier?.paymentTerms != null && (
                <div>
                  <dt className="text-xs text-stone-500 mb-0.5">Payment terms</dt>
                  <dd>Net {bill.supplier.paymentTerms}</dd>
                </div>
              )}
              <div>
                <dt className="text-xs text-stone-500 mb-0.5">Currency</dt>
                <dd>{bill.currency}</dd>
              </div>
              <div>
                <dt className="text-xs text-stone-500 mb-0.5">Source</dt>
                <dd>{bill.source || "Manual"}</dd>
              </div>
              {bill.qboId && (
                <div>
                  <dt className="text-xs text-stone-500 mb-0.5">QBO ID</dt>
                  <dd className="font-mono text-xs text-stone-400">{bill.qboId}</dd>
                </div>
              )}
              {bill.xeroId && (
                <div>
                  <dt className="text-xs text-stone-500 mb-0.5">Xero ID</dt>
                  <dd className="font-mono text-xs text-stone-400">{bill.xeroId}</dd>
                </div>
              )}
            </dl>
            {bill.notes && (
              <div className="mt-4 pt-4 border-t border-stone-800">
                <div className="text-xs text-stone-500 mb-1">Notes</div>
                <div className="text-sm text-stone-300 whitespace-pre-wrap">{bill.notes}</div>
              </div>
            )}
          </Card>

          <Card>
            <h3 className="text-sm font-semibold text-white mb-4">Supplier</h3>
            {bill.supplier ? (
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-9 h-9 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center text-violet-300 text-sm font-semibold shrink-0">
                    {bill.supplier.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <Link
                      href={`/payables/suppliers/${bill.supplier.id}`}
                      className="text-sm font-medium text-white hover:text-violet-400 hover:underline truncate block"
                    >
                      {bill.supplier.name}
                    </Link>
                    {bill.supplier.email && (
                      <div className="text-[11px] text-stone-500 truncate">{bill.supplier.email}</div>
                    )}
                  </div>
                </div>
                {bill.supplier.paymentTerms != null && (
                  <div className="text-xs text-stone-500">Payment terms: Net {bill.supplier.paymentTerms}</div>
                )}
              </div>
            ) : (
              <div className="text-sm text-stone-500 italic">No supplier linked</div>
            )}
          </Card>
        </div>
      )}

      {/* ── Line Items Tab ────────────────────────────────────────────────────── */}
      {tab === "lines" && (
        <Card padding="none">
          <div className="px-4 py-3 border-b border-stone-800 flex items-center gap-2">
            <FileText size={14} className="text-violet-400" />
            <span className="text-sm font-semibold text-stone-300">Line Items</span>
            <span className="text-xs text-stone-600 ml-1">Synced from accounting · read-only</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-4 py-2 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Description</th>
                  <th className="px-4 py-2 text-center text-xs font-semibold text-stone-400 uppercase tracking-wide">Qty</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Unit Price</th>
                  <th className="px-4 py-2 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Account</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Ex. Tax</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Tax</th>
                  <th className="px-4 py-2 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Inc. Tax</th>
                </tr>
              </thead>
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-4 py-8 text-center text-stone-500 text-sm italic">No line items available.</td>
                  </tr>
                ) : (
                  lines.map(item => (
                    <tr key={item.id} className="border-b border-stone-800 hover:bg-stone-800/30">
                      <td className="px-4 py-2.5 text-stone-200">{item.description || "—"}</td>
                      <td className="px-4 py-2.5 text-center text-stone-300 tabular-nums">{item.quantity}</td>
                      <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{fmt.money(item.unitPrice, bill.currency)}</td>
                      <td className="px-4 py-2.5 text-stone-400 text-xs font-mono">{item.accountId || "—"}</td>
                      <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{fmt.money(item.lineSubtotal, bill.currency)}</td>
                      <td className="px-4 py-2.5 text-right text-stone-400 tabular-nums">{fmt.money(getLineTax(item), bill.currency)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-white tabular-nums">{fmt.money(getLineIncTax(item), bill.currency)}</td>
                    </tr>
                  ))
                )}
              </tbody>
              {lines.length > 0 && (
                <tfoot>
                  <tr className="border-t border-stone-700 bg-stone-900/80">
                    <td colSpan={4} className="px-4 py-2.5 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Totals</td>
                    <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums font-semibold">
                      {fmt.money(bill.subtotal, bill.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right text-stone-400 tabular-nums font-semibold">
                      {fmt.money(bill.taxTotal, bill.currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right font-bold text-white tabular-nums">
                      {fmt.money(bill.total, bill.currency)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Card>
      )}

      {/* ── Queries Tab ───────────────────────────────────────────────────────── */}
      {tab === "queries" && (
        <Card>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-stone-300 flex items-center gap-2">
              <MessageSquare size={14} className="text-violet-400" />
              Supplier Queries
              {queries.filter(q => q.status === "Open").length > 0 && (
                <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold">
                  {queries.filter(q => q.status === "Open").length}
                </span>
              )}
            </h2>
            <button
              onClick={() => setShowQueryModal(true)}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded bg-stone-800 hover:bg-stone-700 text-stone-300"
            >
              <Plus size={12} /> Raise Query
            </button>
          </div>
          {queries.length === 0 ? (
            <p className="text-sm text-stone-500 italic">No queries raised for this bill.</p>
          ) : (
            <div className="space-y-3">
              {queries.map(q => (
                <div key={q.id} className="p-3 bg-stone-800/50 rounded-lg border border-stone-700/50">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-stone-200">{q.subject}</span>
                    <Badge variant={q.status === "Open" ? "yellow" : "green"}>{q.status}</Badge>
                  </div>
                  {q.message && <p className="text-xs text-stone-400">{q.message}</p>}
                  <p className="text-[11px] text-stone-600 mt-1">{fmtDate(q.createdAt)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ── Approval History Tab ──────────────────────────────────────────────── */}
      {tab === "history" && (
        <Card>
          <h2 className="text-sm font-semibold text-stone-300 mb-4 flex items-center gap-2">
            <CheckCircle2 size={14} className="text-violet-400" />
            Approval History
          </h2>
          {history.length === 0 ? (
            <p className="text-sm text-stone-500 italic">No approval actions yet.</p>
          ) : (
            <div className="relative">
              <div className="absolute left-[5px] top-2 bottom-2 w-px bg-stone-800" />
              <div className="space-y-4 pl-5">
                {history.map(a => {
                  const isApproved = a.decision === "Approved" || a.status === "Approved";
                  const isRejected = a.decision === "Rejected" || a.status === "Rejected";
                  return (
                    <div key={a.id} className="relative">
                      <div className={`absolute -left-5 top-0.5 w-2.5 h-2.5 rounded-full border-2 border-stone-900 ${isApproved ? "bg-emerald-500" : isRejected ? "bg-rose-500" : "bg-stone-500"}`} />
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-stone-200">{a.approverUserId ? `User ${a.approverUserId.slice(0, 8)}…` : "System"}</span>
                        <span className={`text-xs font-semibold ${isApproved ? "text-emerald-400" : isRejected ? "text-rose-400" : "text-stone-400"}`}>
                          {a.decision || a.status}
                        </span>
                        <span className="text-[11px] text-stone-500 ml-auto">{fmtDateTime(a.createdAt)}</span>
                      </div>
                      {a.comments && <p className="text-sm text-stone-400 mt-0.5">{a.comments}</p>}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {(wf === "Approved" || wf === "Ready for Payment") && (
            <div className="mt-4 pt-4 border-t border-stone-800">
              <button
                onClick={() => {
                  setPushingNote(true);
                  fetch(`/api/payables/bills/${id}/push-approval-note`, { method: "POST" })
                    .then(() => load()).catch(() => {}).finally(() => setPushingNote(false));
                }}
                disabled={pushingNote}
                className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-stone-800 hover:bg-stone-700 text-stone-200 ring-1 ring-stone-700 disabled:opacity-50"
              >
                {pushingNote ? <Loader2 size={13} className="animate-spin" /> : <CloudUpload size={14} />}
                Push Approval Note to Accounting
              </button>
            </div>
          )}
        </Card>
      )}

      {/* Modals */}
      <ReasonModal
        open={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        loading={actionLoading}
        title="Reject Bill"
        confirmLabel="Reject"
        confirmClass="bg-rose-600 hover:bg-rose-500"
        onConfirm={reason => { setShowRejectModal(false); callAction(`/api/payables/bills/${id}/reject`, { reason }); }}
      />
      <ReasonModal
        open={showHoldModal}
        onClose={() => setShowHoldModal(false)}
        loading={actionLoading}
        title="Put Bill On Hold"
        confirmLabel="Put On Hold"
        confirmClass="bg-orange-600 hover:bg-orange-500"
        onConfirm={reason => { setShowHoldModal(false); callAction(`/api/payables/bills/${id}/hold`, { reason }); }}
      />
      <RaiseQueryModal
        open={showQueryModal}
        onClose={() => setShowQueryModal(false)}
        loading={actionLoading}
        onSubmit={handleRaiseQuery}
      />
    </div>
  );
}
