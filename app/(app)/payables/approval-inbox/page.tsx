"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Inbox,
  AlertCircle,
  CheckCircle2,
  XCircle,
  Eye,
  Loader2,
  RefreshCw,
  MessageSquare,
  X,
} from "lucide-react";
import { Badge, Button, Card, Modal, EmptyState } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

type EntityType = "PR" | "PO" | "Bill" | "PaymentRun";
type ApprovalStatus = "Pending" | "Approved" | "Rejected";

interface ApprovalItem {
  id: string;
  entityType: EntityType;
  referenceNumber: string;
  title: string;
  requesterName: string;
  amount: number;
  currency: string;
  createdAt: string;
  status: ApprovalStatus;
  detailPath: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function daysWaiting(createdAt: string): number {
  const diff = Date.now() - new Date(createdAt).getTime();
  return Math.floor(diff / (1000 * 60 * 60 * 24));
}

function entityColor(type: EntityType): string {
  const map: Record<EntityType, string> = {
    PR: "blue",
    PO: "purple",
    Bill: "orange",
    PaymentRun: "green",
  };
  return map[type];
}

function detailPath(item: ApprovalItem): string {
  const paths: Record<EntityType, string> = {
    PR: `/payables/purchase-requests/${item.id}`,
    PO: `/payables/purchase-orders/${item.id}`,
    Bill: `/payables/bills/${item.id}`,
    PaymentRun: `/payables/payment-runs/${item.id}`,
  };
  return paths[item.entityType];
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

const TABS: { label: string; filter: EntityType | "All" }[] = [
  { label: "All", filter: "All" },
  { label: "Purchase Requests", filter: "PR" },
  { label: "Purchase Orders", filter: "PO" },
  { label: "Bills", filter: "Bill" },
  { label: "Payment Runs", filter: "PaymentRun" },
];

// ── Confirm Modal ─────────────────────────────────────────────────────────────

interface ConfirmModalProps {
  open: boolean;
  action: "approve" | "reject" | null;
  item: ApprovalItem | null;
  onClose: () => void;
  onConfirm: (comment: string) => Promise<void>;
}

function ConfirmModal({ open, action, item, onClose, onConfirm }: ConfirmModalProps) {
  const [comment, setComment] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) setComment("");
  }, [open]);

  async function handleConfirm() {
    setLoading(true);
    try {
      await onConfirm(comment);
    } finally {
      setLoading(false);
    }
  }

  if (!open || !item) return null;

  const isApprove = action === "approve";
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isApprove ? "Confirm Approval" : "Confirm Rejection"}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <button
            onClick={handleConfirm}
            disabled={loading}
            className={`inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md transition-colors disabled:opacity-50 ${
              isApprove
                ? "bg-emerald-600 hover:bg-emerald-500 text-white"
                : "bg-rose-600 hover:bg-rose-500 text-white"
            }`}
          >
            {loading && <Loader2 size={14} className="animate-spin" />}
            {isApprove ? "Approve" : "Reject"}
          </button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        <div className="p-3 bg-stone-800 rounded-lg text-sm">
          <p className="text-stone-300 font-medium">{item.referenceNumber}</p>
          <p className="text-stone-400 mt-0.5">{item.title}</p>
          <p className="text-white font-semibold mt-1">
            {fmtMoney(item.amount, item.currency)}
          </p>
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">
            Comment <span className="text-stone-600">(optional)</span>
          </label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            placeholder={
              isApprove ? "Add approval notes…" : "Reason for rejection…"
            }
            className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none"
          />
        </div>
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ApprovalInboxPage() {
  const router = useRouter();
  const [items, setItems] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<EntityType | "All">("All");
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    action: "approve" | "reject" | null;
    item: ApprovalItem | null;
  }>({ open: false, action: null, item: null });
  const [processing, setProcessing] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/approval-inbox");
      if (!res.ok) throw new Error("Failed to load approvals");
      const data = await res.json();
      setItems(Array.isArray(data) ? data : data.items ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filtered = useMemo(() => {
    if (activeTab === "All") return items;
    return items.filter((i) => i.entityType === activeTab);
  }, [items, activeTab]);

  const pendingFiltered = filtered.filter((i) => i.status === "Pending");

  const tabCounts = useMemo(() => {
    const pending = items.filter((i) => i.status === "Pending");
    return {
      All: pending.length,
      PR: pending.filter((i) => i.entityType === "PR").length,
      PO: pending.filter((i) => i.entityType === "PO").length,
      Bill: pending.filter((i) => i.entityType === "Bill").length,
      PaymentRun: pending.filter((i) => i.entityType === "PaymentRun").length,
    };
  }, [items]);

  function openConfirm(action: "approve" | "reject", item: ApprovalItem) {
    setConfirmModal({ open: true, action, item });
  }

  async function handleConfirm(comment: string) {
    const { action, item } = confirmModal;
    if (!item || !action) return;
    setProcessing((prev) => new Set(prev).add(item.id));
    setConfirmModal({ open: false, action: null, item: null });
    try {
      const endpoint =
        action === "approve"
          ? `/api/payables/approval-inbox/${item.id}/approve`
          : `/api/payables/approval-inbox/${item.id}/reject`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      if (!res.ok) throw new Error(`Failed to ${action}`);
      setItems((prev) =>
        prev.map((i) =>
          i.id === item.id
            ? { ...i, status: action === "approve" ? "Approved" : "Rejected" }
            : i
        )
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setProcessing((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    }
  }

  const totalPending = items.filter((i) => i.status === "Pending").length;

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-white tracking-tight">
            Approval Inbox
          </h1>
          {totalPending > 0 && (
            <span className="inline-flex items-center justify-center min-w-[22px] h-5.5 px-1.5 rounded-full text-xs font-bold bg-violet-500 text-white">
              {totalPending}
            </span>
          )}
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-stone-800 hover:bg-stone-700 text-stone-200 ring-1 ring-stone-700 transition-colors disabled:opacity-50"
        >
          {loading ? (
            <Loader2 size={14} className="animate-spin" />
          ) : (
            <RefreshCw size={14} />
          )}
          Refresh
        </button>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 mb-4 border-b border-stone-800">
        {TABS.map((tab) => {
          const count = tabCounts[tab.filter];
          const active = activeTab === tab.filter;
          return (
            <button
              key={tab.filter}
              onClick={() => setActiveTab(tab.filter)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
                active
                  ? "border-violet-500 text-violet-400"
                  : "border-transparent text-stone-400 hover:text-stone-200"
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span
                  className={`inline-flex items-center justify-center min-w-[18px] h-4.5 px-1 rounded-full text-[10px] font-bold ${
                    active
                      ? "bg-violet-500/20 text-violet-300"
                      : "bg-stone-700 text-stone-400"
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={14} /> {error}
          <button
            onClick={load}
            className="ml-auto text-rose-300 hover:text-white underline text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* List */}
      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-16 w-full" />
            ))}
          </div>
        ) : pendingFiltered.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No pending approvals"
            description="You're all caught up! Nothing waiting for your review."
          />
        ) : (
          <div className="divide-y divide-stone-800">
            {pendingFiltered.map((item) => {
              const days = daysWaiting(item.createdAt);
              const busy = processing.has(item.id);
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-4 px-4 py-3.5 hover:bg-stone-800/40 transition-colors"
                >
                  {/* Entity chip */}
                  <Badge variant={entityColor(item.entityType)} size="md">
                    {item.entityType}
                  </Badge>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[12px] text-violet-400">
                        {item.referenceNumber}
                      </span>
                      <span className="text-sm font-medium text-white truncate">
                        {item.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5 text-xs text-stone-400">
                      <span>Requested by {item.requesterName}</span>
                      <span className="text-stone-600">·</span>
                      <span
                        className={
                          days > 3 ? "text-orange-400" : "text-stone-400"
                        }
                      >
                        {days === 0
                          ? "Today"
                          : `${days} day${days !== 1 ? "s" : ""} waiting`}
                      </span>
                    </div>
                  </div>

                  {/* Amount */}
                  <span className="text-sm font-semibold text-white tabular-nums whitespace-nowrap">
                    {fmtMoney(item.amount, item.currency)}
                  </span>

                  {/* Actions */}
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() =>
                        router.push(detailPath(item))
                      }
                      className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium rounded-md text-stone-400 hover:text-white hover:bg-stone-700 transition-colors"
                    >
                      <Eye size={13} />
                      View
                    </button>
                    <button
                      onClick={() => openConfirm("approve", item)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium rounded-md bg-emerald-600/20 text-emerald-400 ring-1 ring-emerald-600/40 hover:bg-emerald-600/30 transition-colors disabled:opacity-50"
                    >
                      {busy ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        <CheckCircle2 size={13} />
                      )}
                      Approve
                    </button>
                    <button
                      onClick={() => openConfirm("reject", item)}
                      disabled={busy}
                      className="inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium rounded-md bg-rose-600/20 text-rose-400 ring-1 ring-rose-600/40 hover:bg-rose-600/30 transition-colors disabled:opacity-50"
                    >
                      <XCircle size={13} />
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Confirm Modal */}
      <ConfirmModal
        open={confirmModal.open}
        action={confirmModal.action}
        item={confirmModal.item}
        onClose={() => setConfirmModal({ open: false, action: null, item: null })}
        onConfirm={handleConfirm}
      />
    </div>
  );
}
