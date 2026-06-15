"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
  AlertCircle,
  CheckCircle2,
  XCircle,
  PauseCircle,
  PlayCircle,
  CreditCard,
  Eye,
  CheckCheck,
  CloudUpload,
  MessageSquare,
  Building2,
  Calendar,
  FileText,
  X,
  Loader2,
  Plus,
  Clock,
  Send,
} from "lucide-react";
import { Card, Badge, Button } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

type BillAccountingStatus = "Draft" | "Submitted" | "Authorised" | "Paid" | "Voided";
type BillWorkflowStatus =
  | "Pending Review"
  | "Pending Approval"
  | "Approved"
  | "On Hold"
  | "Ready for Payment"
  | "Rejected";

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  accountCode?: string;
  taxRate: number;
  subtotal: number;
  taxAmount: number;
  total: number;
}

interface Bill {
  id: string;
  billNumber: string;
  supplierName: string;
  supplierEmail?: string;
  supplierPaymentTerms?: number;
  supplierId: string;
  billDate: string;
  dueDate: string;
  total: number;
  balance: number;
  currency: string;
  accountingStatus: BillAccountingStatus;
  workflowStatus: BillWorkflowStatus;
  assignedApproverName?: string;
  linkedPoNumber?: string;
  linkedPoId?: string;
  source?: "QBO" | "Xero" | "Manual";
  externalId?: string;
  lineItems: LineItem[];
  createdAt: string;
  approvedAt?: string;
}

interface ApprovalRecord {
  id: string;
  approverName: string;
  action: string;
  comment?: string;
  createdAt: string;
}

interface SupplierQuery {
  id: string;
  subject: string;
  status: "Open" | "Resolved";
  createdAt: string;
  message?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtDateTime(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function fmtMoney(amount?: number, currency = "USD") {
  if (amount == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: 2 }).format(amount);
}

function daysUntilDue(dueDate?: string): number {
  if (!dueDate) return 0;
  const due = new Date(dueDate);
  const now = new Date();
  due.setHours(0, 0, 0, 0);
  now.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function workflowStatusBadge(status: BillWorkflowStatus): string {
  const map: Record<BillWorkflowStatus, string> = {
    "Pending Review": "yellow",
    "Pending Approval": "orange",
    Approved: "green",
    "On Hold": "orange",
    "Ready for Payment": "purple",
    Rejected: "red",
  };
  return map[status] ?? "neutral";
}

function accountingStatusBadge(status: BillAccountingStatus): string {
  const map: Record<BillAccountingStatus, string> = {
    Draft: "neutral",
    Submitted: "blue",
    Authorised: "green",
    Paid: "green",
    Voided: "neutral",
  };
  return map[status] ?? "neutral";
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5 border-b border-stone-800/60 last:border-0">
      <span className="text-stone-500">{label}</span>
      <span className="text-stone-200 font-medium text-right max-w-[60%] truncate">{value}</span>
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

// ── Raise Query Modal ─────────────────────────────────────────────────────────

function RaiseQueryModal({
  open,
  onClose,
  onSubmit,
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (subject: string, message: string) => void;
  loading: boolean;
}) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-stone-900 border border-stone-800 rounded-xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800">
          <h3 className="text-base font-semibold text-white">Raise Supplier Query</h3>
          <button onClick={onClose} className="p-1 rounded text-stone-500 hover:text-white hover:bg-stone-800 transition-colors">
            <X size={16} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Subject</label>
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Query subject…"
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              placeholder="Describe your query…"
              className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none"
            />
          </div>
        </div>
        <div className="px-5 py-3.5 border-t border-stone-800 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <button
            onClick={() => onSubmit(subject, message)}
            disabled={loading || !subject.trim()}
            className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            Raise Query
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Reject / Hold Modal ───────────────────────────────────────────────────────

function ReasonModal({
  open,
  onClose,
  onConfirm,
  loading,
  title,
  confirmLabel,
  confirmClass,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  loading: boolean;
  title: string;
  confirmLabel: string;
  confirmClass: string;
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
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Reason…"
            className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none"
          />
        </div>
        <div className="px-5 py-3.5 border-t border-stone-800 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <button
            onClick={() => onConfirm(reason)}
            disabled={loading || !reason.trim()}
            className={`inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md text-white transition-colors disabled:opacity-50 ${confirmClass}`}
          >
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
  const router = useRouter();

  const [bill, setBill] = useState<Bill | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [queries, setQueries] = useState<SupplierQuery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pushingNote, setPushingNote] = useState(false);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [showHoldModal, setShowHoldModal] = useState(false);
  const [showQueryModal, setShowQueryModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [billRes, appRes, qryRes] = await Promise.all([
        fetch(`/api/payables/bills/${id}`),
        fetch(`/api/payables/approval-inbox?entityId=${id}`),
        fetch(`/api/payables/supplier-queries?billId=${id}`),
      ]);
      if (!billRes.ok) throw new Error("Bill not found");
      const billData = await billRes.json();
      setBill(billData.bill ?? billData);
      if (appRes.ok) {
        const appData = await appRes.json();
        setApprovals(Array.isArray(appData) ? appData : appData.approvals ?? []);
      }
      if (qryRes.ok) {
        const qryData = await qryRes.json();
        setQueries(Array.isArray(qryData) ? qryData : qryData.queries ?? []);
      }
    } catch (err: any) {
      setError(err.message);
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
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handlePushNote() {
    setPushingNote(true);
    try {
      const res = await fetch(`/api/payables/bills/${id}/push-approval-note`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to push approval note");
      await load();
    } catch (err: any) {
      setActionError(err.message);
    } finally {
      setPushingNote(false);
    }
  }

  async function handleRaiseQuery(subject: string, message: string) {
    setShowQueryModal(false);
    setActionLoading(true);
    try {
      await fetch(`/api/payables/supplier-queries`, {
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
      <div className="p-6 max-w-[1200px] mx-auto space-y-4">
        <Skeleton className="h-5 w-48" />
        <Skeleton className="h-8 w-80" />
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-4">
            <Skeleton className="h-64" />
            <Skeleton className="h-32" />
          </div>
          <Skeleton className="h-64" />
        </div>
      </div>
    );
  }

  if (error || !bill) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto">
        <div className="flex items-center gap-2 p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400">
          <AlertCircle size={16} /> {error || "Bill not found"}
          <button onClick={load} className="ml-auto text-rose-300 hover:text-white underline text-sm">Retry</button>
        </div>
      </div>
    );
  }

  const daysDiff = daysUntilDue(bill.dueDate);
  const overdue = daysDiff < 0 && bill.workflowStatus !== "Approved" && bill.workflowStatus !== "Ready for Payment";

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-5">
        <Link href="/payables/bills" className="hover:text-stone-300 transition-colors">Bills</Link>
        <ChevronRight size={14} />
        <span className="text-stone-300 font-medium">{bill.billNumber}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-semibold text-white">{bill.billNumber}</h1>
            <Badge variant={accountingStatusBadge(bill.accountingStatus)} size="md">{bill.accountingStatus}</Badge>
            <Badge variant={workflowStatusBadge(bill.workflowStatus)} size="md">{bill.workflowStatus}</Badge>
            {bill.workflowStatus === "Ready for Payment" && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 rounded-md">
                <CheckCircle2 size={12} /> Ready
              </span>
            )}
          </div>
          <p className="text-sm text-stone-400 mt-0.5">
            {bill.supplierName} · {fmtMoney(bill.total, bill.currency)} · Balance {fmtMoney(bill.balance, bill.currency)}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {bill.workflowStatus === "Pending Review" && (
            <button
              onClick={() => callAction(`/api/payables/bills/${id}/mark-reviewed`)}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <Eye size={14} />}
              Mark as Reviewed
            </button>
          )}
          {bill.workflowStatus === "Pending Approval" && (
            <>
              <button
                onClick={() => callAction(`/api/payables/bills/${id}/approve`)}
                disabled={actionLoading}
                className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
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
                className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-stone-800 hover:bg-stone-700 text-stone-200 ring-1 ring-stone-700 transition-colors disabled:opacity-50"
              >
                <PauseCircle size={14} /> Put On Hold
              </button>
            </>
          )}
          {bill.workflowStatus === "Approved" && (
            <button
              onClick={() => callAction(`/api/payables/bills/${id}/mark-ready-for-payment`)}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <CreditCard size={14} />}
              Mark Ready for Payment
            </button>
          )}
          {bill.workflowStatus === "On Hold" && (
            <button
              onClick={() => callAction(`/api/payables/bills/${id}/resume`)}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <PlayCircle size={14} />}
              Resume
            </button>
          )}
          {bill.workflowStatus === "Ready for Payment" && (
            <button
              onClick={() => callAction(`/api/payables/bills/${id}/add-to-payment-run`)}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
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

      <div className="grid grid-cols-3 gap-5">
        {/* Main Content */}
        <div className="col-span-2 space-y-5">
          {/* Line Items */}
          <Card padding="none">
            <div className="px-4 py-3 border-b border-stone-800">
              <h2 className="text-sm font-semibold text-stone-300 flex items-center gap-2">
                <FileText size={14} className="text-violet-400" />
                Line Items
                <span className="text-stone-600 text-xs font-normal ml-1">Synced from accounting · read-only</span>
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-stone-800 bg-stone-900/60">
                    <th className="px-4 py-2 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Description</th>
                    <th className="px-4 py-2 text-center text-xs font-semibold text-stone-400 uppercase tracking-wide">Qty</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Unit Price</th>
                    <th className="px-4 py-2 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Account</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Tax %</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Subtotal</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Tax</th>
                    <th className="px-4 py-2 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {bill.lineItems.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-8 text-center text-stone-500 text-sm italic">No line items available.</td>
                    </tr>
                  ) : (
                    bill.lineItems.map((item) => (
                      <tr key={item.id} className="border-b border-stone-800 hover:bg-stone-800/30">
                        <td className="px-4 py-2.5 text-stone-200">{item.description || "—"}</td>
                        <td className="px-4 py-2.5 text-center text-stone-300 tabular-nums">{item.quantity}</td>
                        <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{fmtMoney(item.unitPrice, bill.currency)}</td>
                        <td className="px-4 py-2.5 text-stone-400">{item.accountCode || "—"}</td>
                        <td className="px-4 py-2.5 text-right text-stone-400 tabular-nums">{item.taxRate}%</td>
                        <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums">{fmtMoney(item.subtotal, bill.currency)}</td>
                        <td className="px-4 py-2.5 text-right text-stone-400 tabular-nums">{fmtMoney(item.taxAmount, bill.currency)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-white tabular-nums">{fmtMoney(item.total, bill.currency)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {bill.lineItems.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-stone-700 bg-stone-900/80">
                      <td colSpan={5} className="px-4 py-2.5 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Total</td>
                      <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums font-semibold">
                        {fmtMoney(bill.lineItems.reduce((a, l) => a + l.subtotal, 0), bill.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right text-stone-400 tabular-nums">
                        {fmtMoney(bill.lineItems.reduce((a, l) => a + l.taxAmount, 0), bill.currency)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-white tabular-nums">
                        {fmtMoney(bill.total, bill.currency)}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>

          {/* Approval History */}
          <Card>
            <h2 className="text-sm font-semibold text-stone-300 mb-4 flex items-center gap-2">
              <CheckCircle2 size={14} className="text-violet-400" />
              Approval History
            </h2>
            {approvals.length === 0 ? (
              <p className="text-sm text-stone-500 italic">No approval actions yet.</p>
            ) : (
              <div className="relative">
                <div className="absolute left-[5px] top-2 bottom-2 w-px bg-stone-800" />
                <div className="space-y-4 pl-5">
                  {approvals.map((a) => (
                    <div key={a.id} className="relative">
                      <div className={`absolute -left-5 top-0.5 w-2.5 h-2.5 rounded-full border-2 border-stone-900 ${a.action === "Approved" ? "bg-emerald-500" : a.action === "Rejected" ? "bg-rose-500" : "bg-stone-500"}`} />
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-stone-200">{a.approverName}</span>
                        <span className={`text-xs font-semibold ${a.action === "Approved" ? "text-emerald-400" : a.action === "Rejected" ? "text-rose-400" : "text-stone-400"}`}>{a.action}</span>
                        <span className="text-[11px] text-stone-500 ml-auto">{fmtDateTime(a.createdAt)}</span>
                      </div>
                      {a.comment && <p className="text-sm text-stone-400 mt-0.5">{a.comment}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Push Approval Note */}
            {(bill.workflowStatus === "Approved" || bill.workflowStatus === "Ready for Payment") && (
              <div className="mt-4 pt-4 border-t border-stone-800">
                <button
                  onClick={handlePushNote}
                  disabled={pushingNote}
                  className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-stone-800 hover:bg-stone-700 text-stone-200 ring-1 ring-stone-700 transition-colors disabled:opacity-50"
                >
                  {pushingNote ? <Loader2 size={13} className="animate-spin" /> : <CloudUpload size={14} />}
                  Push Approval Note to Accounting
                </button>
              </div>
            )}
          </Card>

          {/* Supplier Queries */}
          <Card>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-stone-300 flex items-center gap-2">
                <MessageSquare size={14} className="text-violet-400" />
                Supplier Queries
                {queries.filter((q) => q.status === "Open").length > 0 && (
                  <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-500/20 text-amber-400 text-[10px] font-bold">
                    {queries.filter((q) => q.status === "Open").length}
                  </span>
                )}
              </h2>
              <button
                onClick={() => setShowQueryModal(true)}
                className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded bg-stone-800 hover:bg-stone-700 text-stone-300 transition-colors"
              >
                <Plus size={12} /> Raise Query
              </button>
            </div>
            {queries.length === 0 ? (
              <p className="text-sm text-stone-500 italic">No queries raised for this bill.</p>
            ) : (
              <div className="space-y-3">
                {queries.map((q) => (
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
        </div>

        {/* Right Panel */}
        <div className="space-y-4">
          {/* Supplier */}
          <Card>
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">Supplier</h3>
            <div className="flex items-center gap-3 mb-3">
              <div className="w-9 h-9 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center shrink-0">
                <Building2 size={16} className="text-violet-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">{bill.supplierName}</p>
                {bill.supplierEmail && <p className="text-xs text-stone-500">{bill.supplierEmail}</p>}
              </div>
            </div>
            {bill.supplierPaymentTerms != null && (
              <p className="text-xs text-stone-500">Payment terms: Net {bill.supplierPaymentTerms}</p>
            )}
          </Card>

          {/* Bill Details */}
          <Card>
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Bill Details</h3>
            <InfoRow label="Bill Date" value={fmtDate(bill.billDate)} />
            <InfoRow label="Due Date" value={
              <span className={overdue ? "text-rose-400 font-semibold" : ""}>
                {fmtDate(bill.dueDate)}
                {overdue && <span className="ml-1 text-[10px]">(+{Math.abs(daysDiff)}d overdue)</span>}
                {!overdue && daysDiff >= 0 && daysDiff <= 7 && (
                  <span className="ml-1 text-[10px] text-amber-400">({daysDiff}d left)</span>
                )}
              </span>
            } />
            <InfoRow label="Total" value={fmtMoney(bill.total, bill.currency)} />
            <InfoRow label="Balance" value={
              <span className="font-semibold text-white">{fmtMoney(bill.balance, bill.currency)}</span>
            } />
            {bill.linkedPoNumber && bill.linkedPoId && (
              <div className="mt-2 pt-2 border-t border-stone-800">
                <Link
                  href={`/payables/purchase-orders/${bill.linkedPoId}`}
                  className="flex items-center gap-1.5 text-xs text-violet-400 hover:text-violet-300"
                >
                  <FileText size={12} /> Linked PO: {bill.linkedPoNumber}
                </Link>
              </div>
            )}
          </Card>

          {/* Source */}
          <Card>
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Accounting Source</h3>
            <div className="flex items-center gap-2">
              <Badge variant="blue" size="md">{bill.source || "Unknown"}</Badge>
              {bill.externalId && (
                <span className="text-xs text-stone-500 font-mono">{bill.externalId}</span>
              )}
            </div>
            <InfoRow label="Accounting Status" value={<Badge variant={accountingStatusBadge(bill.accountingStatus)}>{bill.accountingStatus}</Badge>} />
          </Card>

          {/* Assigned Approver */}
          <Card>
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Assigned Approver</h3>
            {bill.assignedApproverName ? (
              <p className="text-sm text-stone-200">{bill.assignedApproverName}</p>
            ) : (
              <p className="text-sm text-stone-500 italic">Not assigned</p>
            )}
          </Card>
        </div>
      </div>

      <ReasonModal
        open={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        loading={actionLoading}
        title="Reject Bill"
        confirmLabel="Reject"
        confirmClass="bg-rose-600 hover:bg-rose-500"
        onConfirm={(reason) => {
          setShowRejectModal(false);
          callAction(`/api/payables/bills/${id}/reject`, { reason });
        }}
      />

      <ReasonModal
        open={showHoldModal}
        onClose={() => setShowHoldModal(false)}
        loading={actionLoading}
        title="Put Bill On Hold"
        confirmLabel="Put On Hold"
        confirmClass="bg-orange-600 hover:bg-orange-500"
        onConfirm={(reason) => {
          setShowHoldModal(false);
          callAction(`/api/payables/bills/${id}/hold`, { reason });
        }}
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
