"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  AlertCircle,
  CheckCircle2,
  XCircle,
  ArrowRightLeft,
  Send,
  ChevronRight,
  User,
  Calendar,
  DollarSign,
  Building2,
  FileText,
  Clock,
  Loader2,
  MessageSquare,
  CheckCheck,
  Ban,
} from "lucide-react";
import { Card, Badge, Button } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

type PRStatus =
  | "Draft"
  | "Submitted"
  | "Pending Review"
  | "Pending Approval"
  | "Approved"
  | "Rejected"
  | "Cancelled"
  | "Converted to PO";

interface PurchaseRequest {
  id: string;
  requestNumber: string;
  title: string;
  description?: string;
  businessJustification?: string;
  supplierName?: string;
  supplierId?: string;
  requiredByDate?: string;
  estimatedTotal?: number;
  currency: string;
  notes?: string;
  status: PRStatus;
  requesterName: string;
  requesterRole?: string;
  assignedApproverName?: string;
  workflowStatus?: string;
  createdAt: string;
  updatedAt?: string;
  submittedAt?: string;
  approvedAt?: string;
  rejectedAt?: string;
  convertedPoNumber?: string;
}

interface ApprovalRecord {
  id: string;
  approverName: string;
  action: "Approved" | "Rejected" | "Submitted" | "Reviewed" | "On Hold";
  comment?: string;
  createdAt: string;
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

function prStatusBadge(status: PRStatus): string {
  const map: Record<PRStatus, string> = {
    Draft: "neutral",
    Submitted: "blue",
    "Pending Review": "yellow",
    "Pending Approval": "orange",
    Approved: "green",
    Rejected: "red",
    Cancelled: "neutral",
    "Converted to PO": "purple",
  };
  return map[status] ?? "neutral";
}

function approvalActionColor(action: string) {
  if (action === "Approved") return "text-emerald-400";
  if (action === "Rejected") return "text-rose-400";
  if (action === "Submitted") return "text-blue-400";
  if (action === "On Hold") return "text-orange-400";
  return "text-stone-400";
}

function ApprovalActionIcon({ action }: { action: string }) {
  if (action === "Approved") return <CheckCircle2 size={14} className="text-emerald-400 shrink-0" />;
  if (action === "Rejected") return <XCircle size={14} className="text-rose-400 shrink-0" />;
  if (action === "Submitted") return <Send size={14} className="text-blue-400 shrink-0" />;
  return <Clock size={14} className="text-stone-400 shrink-0" />;
}

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
      <div className="bg-stone-900 border border-stone-800 rounded-xl shadow-2xl w-full max-w-md">
        <div className="px-5 py-4 border-b border-stone-800">
          <h3 className="text-base font-semibold text-white">Reject Purchase Request</h3>
        </div>
        <div className="p-5">
          <p className="text-sm text-stone-400 mb-3">Please provide a reason for rejection.</p>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Reason for rejection…"
            className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-rose-500 focus:ring-1 focus:ring-rose-500 focus:outline-none resize-none"
          />
        </div>
        <div className="px-5 py-3.5 border-t border-stone-800 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={loading}>Cancel</Button>
          <Button
            variant="danger"
            onClick={() => onConfirm(reason)}
            disabled={loading || !reason.trim()}
          >
            {loading ? <><Loader2 size={13} className="animate-spin" /> Rejecting…</> : "Reject"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Info Row ──────────────────────────────────────────────────────────────────

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wide">{label}</span>
      <span className="text-sm text-stone-200">{value}</span>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PurchaseRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [pr, setPr] = useState<PurchaseRequest | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [prRes, appRes] = await Promise.all([
        fetch(`/api/payables/purchase-requests/${id}`),
        fetch(`/api/payables/approval-inbox?entityId=${id}`),
      ]);
      if (!prRes.ok) throw new Error("Purchase request not found");
      const prData = await prRes.json();
      setPr(prData.purchaseRequest ?? prData);
      if (appRes.ok) {
        const appData = await appRes.json();
        setApprovals(Array.isArray(appData) ? appData : appData.approvals ?? []);
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

  if (loading) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto">
        <div className="h-6 w-48 bg-stone-800 animate-pulse rounded mb-6" />
        <div className="h-8 w-80 bg-stone-800 animate-pulse rounded mb-4" />
        <div className="grid grid-cols-3 gap-4">
          <div className="col-span-2 space-y-4">
            <div className="h-48 bg-stone-800 animate-pulse rounded-lg" />
            <div className="h-32 bg-stone-800 animate-pulse rounded-lg" />
          </div>
          <div className="h-64 bg-stone-800 animate-pulse rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || !pr) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto">
        <div className="flex items-center gap-2 p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400">
          <AlertCircle size={16} />
          {error || "Purchase request not found"}
          <button onClick={load} className="ml-auto text-rose-300 hover:text-white underline text-sm">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-5">
        <Link href="/payables/purchase-requests" className="hover:text-stone-300 transition-colors">
          Purchase Requests
        </Link>
        <ChevronRight size={14} />
        <span className="text-stone-300 font-medium">{pr.requestNumber}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-semibold text-white tracking-tight">{pr.title}</h1>
          <Badge variant={prStatusBadge(pr.status)} size="md">{pr.status}</Badge>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {pr.status === "Draft" && (
            <button
              onClick={() => callAction(`/api/payables/purchase-requests/${id}/submit`)}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
              Submit for Approval
            </button>
          )}
          {pr.status === "Pending Approval" && (
            <>
              <Button
                variant="secondary"
                onClick={() => callAction(`/api/payables/purchase-requests/${id}/approve`)}
                disabled={actionLoading}
                className="!bg-emerald-600 !text-white hover:!bg-emerald-500 ring-0"
              >
                {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <CheckCheck size={14} />}
                Approve
              </Button>
              <Button
                variant="danger"
                onClick={() => setShowRejectModal(true)}
                disabled={actionLoading}
              >
                <XCircle size={14} />
                Reject
              </Button>
            </>
          )}
          {pr.status === "Approved" && (
            <button
              onClick={() => callAction(`/api/payables/purchase-requests/${id}/convert-to-po`)}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={14} className="animate-spin" /> : <ArrowRightLeft size={14} />}
              Convert to PO
            </button>
          )}
        </div>
      </div>

      {actionError && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={14} />
          {actionError}
          <button onClick={() => setActionError(null)} className="ml-auto"><XCircle size={14} /></button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-5">
        {/* Main Content */}
        <div className="col-span-2 space-y-5">
          {/* Details Card */}
          <Card>
            <h2 className="text-sm font-semibold text-stone-300 mb-4 flex items-center gap-2">
              <FileText size={15} className="text-violet-400" />
              Request Details
            </h2>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4">
              <InfoRow label="Title" value={pr.title} />
              <InfoRow label="Request Number" value={<span className="font-mono text-violet-400">{pr.requestNumber}</span>} />
              {pr.description && (
                <div className="col-span-2">
                  <InfoRow label="Description" value={<span className="whitespace-pre-wrap">{pr.description}</span>} />
                </div>
              )}
              {pr.businessJustification && (
                <div className="col-span-2">
                  <InfoRow label="Business Justification" value={<span className="whitespace-pre-wrap">{pr.businessJustification}</span>} />
                </div>
              )}
              <InfoRow
                label="Supplier"
                value={pr.supplierName || <span className="text-stone-500 italic">Not specified</span>}
              />
              <InfoRow label="Required By" value={fmtDate(pr.requiredByDate)} />
              <InfoRow
                label="Estimated Total"
                value={
                  <span className="font-semibold text-white tabular-nums">
                    {fmtMoney(pr.estimatedTotal, pr.currency)}
                  </span>
                }
              />
              <InfoRow label="Currency" value={pr.currency} />
              {pr.notes && (
                <div className="col-span-2">
                  <InfoRow label="Notes" value={<span className="whitespace-pre-wrap text-stone-400">{pr.notes}</span>} />
                </div>
              )}
            </div>
          </Card>

          {/* Approval History */}
          <Card>
            <h2 className="text-sm font-semibold text-stone-300 mb-4 flex items-center gap-2">
              <CheckCircle2 size={15} className="text-violet-400" />
              Approval History
            </h2>
            {approvals.length === 0 ? (
              <p className="text-sm text-stone-500 italic">No approval actions yet.</p>
            ) : (
              <div className="space-y-3">
                {approvals.map((a) => (
                  <div key={a.id} className="flex items-start gap-3 pl-1">
                    <ApprovalActionIcon action={a.action} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-stone-200">{a.approverName}</span>
                        <span className={`text-xs font-semibold ${approvalActionColor(a.action)}`}>{a.action}</span>
                        <span className="text-[11px] text-stone-500 ml-auto whitespace-nowrap">{fmtDateTime(a.createdAt)}</span>
                      </div>
                      {a.comment && (
                        <p className="text-sm text-stone-400 mt-1">{a.comment}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Activity / Comments */}
          <Card>
            <h2 className="text-sm font-semibold text-stone-300 mb-3 flex items-center gap-2">
              <MessageSquare size={15} className="text-violet-400" />
              Activity
            </h2>
            <p className="text-sm text-stone-500 italic">No comments yet.</p>
          </Card>
        </div>

        {/* Right Panel */}
        <div className="space-y-4">
          {/* Requester */}
          <Card>
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">Requester</h3>
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-violet-600/20 border border-violet-500/30 flex items-center justify-center shrink-0">
                <User size={16} className="text-violet-400" />
              </div>
              <div>
                <p className="text-sm font-medium text-white">{pr.requesterName}</p>
                {pr.requesterRole && <p className="text-xs text-stone-500">{pr.requesterRole}</p>}
              </div>
            </div>
          </Card>

          {/* Assigned Approver */}
          <Card>
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">Assigned Approver</h3>
            {pr.assignedApproverName ? (
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-stone-800 border border-stone-700 flex items-center justify-center shrink-0">
                  <User size={16} className="text-stone-400" />
                </div>
                <p className="text-sm font-medium text-white">{pr.assignedApproverName}</p>
              </div>
            ) : (
              <p className="text-sm text-stone-500 italic">Not assigned</p>
            )}
          </Card>

          {/* Key Dates */}
          <Card>
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">Key Dates</h3>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between text-sm">
                <span className="text-stone-500">Created</span>
                <span className="text-stone-300">{fmtDate(pr.createdAt)}</span>
              </div>
              {pr.submittedAt && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-500">Submitted</span>
                  <span className="text-stone-300">{fmtDate(pr.submittedAt)}</span>
                </div>
              )}
              {pr.requiredByDate && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-500">Required By</span>
                  <span className="text-stone-300">{fmtDate(pr.requiredByDate)}</span>
                </div>
              )}
              {pr.approvedAt && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-500">Approved</span>
                  <span className="text-emerald-400">{fmtDate(pr.approvedAt)}</span>
                </div>
              )}
              {pr.rejectedAt && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-stone-500">Rejected</span>
                  <span className="text-rose-400">{fmtDate(pr.rejectedAt)}</span>
                </div>
              )}
            </div>
          </Card>

          {/* Workflow Status */}
          <Card>
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">Workflow</h3>
            <div className="space-y-2">
              {[
                { label: "Draft", done: true },
                { label: "Submitted", done: pr.status !== "Draft" },
                { label: "Under Review", done: ["Pending Approval", "Approved", "Rejected", "Converted to PO"].includes(pr.status) },
                { label: "Approved", done: ["Approved", "Converted to PO"].includes(pr.status) },
                { label: "Converted to PO", done: pr.status === "Converted to PO" },
              ].map((step) => (
                <div key={step.label} className="flex items-center gap-2 text-sm">
                  <div className={`w-2 h-2 rounded-full shrink-0 ${step.done ? "bg-violet-500" : "bg-stone-700"}`} />
                  <span className={step.done ? "text-stone-200" : "text-stone-600"}>{step.label}</span>
                </div>
              ))}
            </div>
            {pr.convertedPoNumber && (
              <div className="mt-3 pt-3 border-t border-stone-800">
                <Link
                  href={`/payables/purchase-orders`}
                  className="text-xs text-violet-400 hover:text-violet-300 flex items-center gap-1"
                >
                  <ArrowRightLeft size={12} />
                  PO: {pr.convertedPoNumber}
                </Link>
              </div>
            )}
          </Card>
        </div>
      </div>

      <RejectModal
        open={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        loading={actionLoading}
        onConfirm={(reason) => {
          setShowRejectModal(false);
          callAction(`/api/payables/purchase-requests/${id}/reject`, { reason });
        }}
      />
    </div>
  );
}
