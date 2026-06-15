"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft,
  AlertCircle,
  Loader2,
  Plus,
  Search,
  Trash2,
  CheckCircle2,
  XCircle,
  Calendar,
  ClipboardList,
} from "lucide-react";
import { Badge, Button, Card, Input, EmptyState, Modal } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

type RunStatus =
  | "Draft"
  | "Pending Approval"
  | "Approved"
  | "Scheduled"
  | "Posted"
  | "Cancelled";

interface PaymentRunBill {
  id: string;
  billNumber: string;
  supplierName: string;
  dueDate: string;
  amount: number;
  currency: string;
  status: string;
}

interface ApprovalHistoryEntry {
  id: string;
  action: string;
  performedByName: string;
  comment?: string;
  createdAt: string;
}

interface PaymentRun {
  id: string;
  runNumber: string;
  currency: string;
  scheduledDate?: string;
  status: RunStatus;
  totalAmount: number;
  billCount: number;
  createdByName: string;
  approvedByName?: string;
  createdAt: string;
  bills: PaymentRunBill[];
  approvalHistory: ApprovalHistoryEntry[];
}

interface AvailableBill {
  id: string;
  billNumber: string;
  supplierName: string;
  dueDate: string;
  amount: number;
  currency: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

function statusBadge(status: RunStatus): string {
  const map: Record<RunStatus, string> = {
    Draft: "neutral",
    "Pending Approval": "orange",
    Approved: "purple",
    Scheduled: "blue",
    Posted: "green",
    Cancelled: "red",
  };
  return map[status];
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

// ── Bill Picker Modal ─────────────────────────────────────────────────────────

interface BillPickerProps {
  open: boolean;
  onClose: () => void;
  onAdd: (billIds: string[]) => Promise<void>;
  existingBillIds: Set<string>;
}

function BillPickerModal({
  open,
  onClose,
  onAdd,
  existingBillIds,
}: BillPickerProps) {
  const [available, setAvailable] = useState<AvailableBill[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setSelected(new Set());
      setSearch("");
      setErr("");
      fetchAvailable();
    }
  }, [open]);

  async function fetchAvailable() {
    setLoading(true);
    try {
      const res = await fetch(
        "/api/payables/bills?workflowStatus=Ready+for+Payment&notInRun=true"
      );
      if (!res.ok) throw new Error("Failed to load available bills");
      const data = await res.json();
      const bills: AvailableBill[] = Array.isArray(data)
        ? data
        : data.bills ?? [];
      setAvailable(bills.filter((b) => !existingBillIds.has(b.id)));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  const filtered = useMemo(() => {
    if (!search) return available;
    const s = search.toLowerCase();
    return available.filter(
      (b) =>
        b.billNumber.toLowerCase().includes(s) ||
        b.supplierName.toLowerCase().includes(s)
    );
  }, [available, search]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleAdd() {
    if (selected.size === 0) return;
    setAdding(true);
    try {
      await onAdd(Array.from(selected));
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setAdding(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add Bills to Payment Run"
      size="lg"
      footer={
        <>
          <span className="text-xs text-stone-400 mr-auto">
            {selected.size} bill{selected.size !== 1 ? "s" : ""} selected
          </span>
          <Button variant="ghost" onClick={onClose} disabled={adding}>
            Cancel
          </Button>
          <Button onClick={handleAdd} disabled={adding || selected.size === 0}>
            {adding && <Loader2 size={14} className="animate-spin" />}
            Add Selected
          </Button>
        </>
      }
    >
      <div className="p-5">
        {err && (
          <div className="mb-3 flex items-center gap-2 p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-md text-rose-400 text-xs">
            <AlertCircle size={13} /> {err}
          </div>
        )}
        <Input
          value={search}
          onChange={(e: any) => setSearch(e.target.value)}
          placeholder="Search bills…"
          icon={Search}
          className="w-full mb-3"
        />
        {loading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <p className="text-center text-stone-500 text-sm py-8">
            No bills available for payment.
          </p>
        ) : (
          <div className="max-h-80 overflow-y-auto divide-y divide-stone-800 rounded-lg border border-stone-800">
            {filtered.map((bill) => {
              const checked = selected.has(bill.id);
              return (
                <label
                  key={bill.id}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-stone-800/50 cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(bill.id)}
                    className="w-4 h-4 rounded border-stone-600 bg-stone-800 text-violet-500 focus:ring-violet-500 focus:ring-offset-stone-900"
                  />
                  <div className="flex-1 min-w-0">
                    <span className="font-mono text-[12px] text-violet-400">
                      {bill.billNumber}
                    </span>
                    <span className="ml-2 text-sm text-white">
                      {bill.supplierName}
                    </span>
                  </div>
                  <span className="text-xs text-stone-400 whitespace-nowrap">
                    Due {fmtDate(bill.dueDate)}
                  </span>
                  <span className="text-sm font-semibold text-white tabular-nums">
                    {fmtMoney(bill.amount, bill.currency)}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PaymentRunDetailPage() {
  const params = useParams();
  const router = useRouter();
  const runId = params.id as string;

  const [run, setRun] = useState<PaymentRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [billPickerOpen, setBillPickerOpen] = useState(false);
  const [removingBill, setRemovingBill] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/payables/payment-runs/${runId}`);
      if (!res.ok) throw new Error("Failed to load payment run");
      const data = await res.json();
      setRun(data.run ?? data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [runId]);

  async function performAction(action: string) {
    setActionLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/payables/payment-runs/${runId}/${action}`, {
        method: "POST",
      });
      if (!res.ok) throw new Error(`Failed: ${action}`);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActionLoading(false);
    }
  }

  async function handleAddBills(billIds: string[]) {
    const res = await fetch(`/api/payables/payment-runs/${runId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ billIds }),
    });
    if (!res.ok) throw new Error("Failed to add bills");
    await load();
  }

  async function handleRemoveBill(billId: string) {
    setRemovingBill(billId);
    try {
      const res = await fetch(
        `/api/payables/payment-runs/${runId}/bills/${billId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Failed to remove bill");
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRemovingBill(null);
    }
  }

  const currencyBreakdown = useMemo(() => {
    if (!run) return {};
    const map: Record<string, number> = {};
    for (const bill of run.bills) {
      map[bill.currency] = (map[bill.currency] ?? 0) + bill.amount;
    }
    return map;
  }, [run]);

  const existingBillIds = useMemo(
    () => new Set(run?.bills.map((b) => b.id) ?? []),
    [run]
  );

  if (loading) {
    return (
      <div className="p-6 max-w-[1100px] mx-auto space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error && !run) {
    return (
      <div className="p-6 max-w-[1100px] mx-auto">
        <div className="flex items-center gap-2 p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400">
          <AlertCircle size={16} /> {error}
          <button
            onClick={load}
            className="ml-auto text-rose-300 hover:text-white underline text-sm"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!run) return null;

  const isDraft = run.status === "Draft";
  const isPendingApproval = run.status === "Pending Approval";
  const isApproved = run.status === "Approved";

  return (
    <div className="p-6 max-w-[1100px] mx-auto space-y-5">
      {/* Back */}
      <button
        onClick={() => router.push("/payables/payment-runs")}
        className="inline-flex items-center gap-1.5 text-sm text-stone-400 hover:text-white transition-colors"
      >
        <ArrowLeft size={15} />
        Payment Runs
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-semibold text-white tracking-tight font-mono">
              {run.runNumber}
            </h1>
            <Badge variant={statusBadge(run.status)} size="md">
              {run.status}
            </Badge>
            <span className="text-stone-500 text-sm font-medium">
              {run.currency}
            </span>
          </div>
          <p className="text-3xl font-bold text-white tabular-nums">
            {fmtMoney(run.totalAmount, run.currency)}
          </p>
          <p className="text-sm text-stone-400 mt-1">
            {run.billCount} bill{run.billCount !== 1 ? "s" : ""} · Created by{" "}
            {run.createdByName}
            {run.scheduledDate && ` · Scheduled ${fmtDate(run.scheduledDate)}`}
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {isDraft && (
            <button
              onClick={() => performAction("submit")}
              disabled={actionLoading || run.bills.length === 0}
              className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
            >
              {actionLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ClipboardList size={15} />
              )}
              Submit for Approval
            </button>
          )}
          {isPendingApproval && (
            <>
              <button
                onClick={() => performAction("approve")}
                disabled={actionLoading}
                className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
              >
                {actionLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={15} />
                )}
                Approve
              </button>
              <button
                onClick={() => performAction("cancel")}
                disabled={actionLoading}
                className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-rose-600/20 text-rose-400 ring-1 ring-rose-600/40 hover:bg-rose-600/30 transition-colors disabled:opacity-50"
              >
                <XCircle size={15} />
                Cancel Run
              </button>
            </>
          )}
          {isApproved && (
            <>
              <button
                onClick={() => performAction("schedule")}
                disabled={actionLoading}
                className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-blue-600 hover:bg-blue-500 text-white transition-colors disabled:opacity-50"
              >
                {actionLoading ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Calendar size={15} />
                )}
                Mark as Scheduled
              </button>
              <button
                onClick={() => performAction("cancel")}
                disabled={actionLoading}
                className="inline-flex items-center gap-2 h-9 px-4 text-sm font-medium rounded-md bg-rose-600/20 text-rose-400 ring-1 ring-rose-600/40 hover:bg-rose-600/30 transition-colors disabled:opacity-50"
              >
                <XCircle size={15} />
                Cancel Run
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={14} /> {error}
        </div>
      )}

      {/* Add Bills (Draft only) */}
      {isDraft && (
        <Card padding="none">
          <div className="flex items-center justify-between px-4 py-3 border-b border-stone-800">
            <h2 className="text-sm font-semibold text-white">Bills</h2>
            <button
              onClick={() => setBillPickerOpen(true)}
              className="inline-flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-md bg-violet-600/20 text-violet-400 ring-1 ring-violet-600/40 hover:bg-violet-600/30 transition-colors"
            >
              <Plus size={13} />
              Add Bills
            </button>
          </div>
          <BillsTable
            bills={run.bills}
            isDraft={isDraft}
            removingBill={removingBill}
            onRemove={handleRemoveBill}
          />
        </Card>
      )}

      {/* Bills (non-draft) */}
      {!isDraft && (
        <Card padding="none">
          <div className="px-4 py-3 border-b border-stone-800">
            <h2 className="text-sm font-semibold text-white">Bills</h2>
          </div>
          <BillsTable
            bills={run.bills}
            isDraft={false}
            removingBill={null}
            onRemove={() => {}}
          />
        </Card>
      )}

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <p className="text-xs font-medium text-stone-400 mb-1">Total Bills</p>
          <p className="text-2xl font-bold text-white tabular-nums">
            {run.bills.length}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-stone-400 mb-1">
            Total Amount
          </p>
          <p className="text-2xl font-bold text-white tabular-nums">
            {fmtMoney(run.totalAmount, run.currency)}
          </p>
        </Card>
        <Card>
          <p className="text-xs font-medium text-stone-400 mb-2">
            By Currency
          </p>
          {Object.keys(currencyBreakdown).length === 0 ? (
            <p className="text-stone-600 text-sm">—</p>
          ) : (
            <div className="space-y-1">
              {Object.entries(currencyBreakdown).map(([cur, amt]) => (
                <div key={cur} className="flex items-center justify-between">
                  <span className="text-xs font-medium text-stone-400">
                    {cur}
                  </span>
                  <span className="text-sm font-semibold text-white tabular-nums">
                    {fmtMoney(amt, cur)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Approval History */}
      <Card>
        <h2 className="text-sm font-semibold text-white mb-4">
          Approval History
        </h2>
        {run.approvalHistory.length === 0 ? (
          <p className="text-stone-500 text-sm">No approval actions yet.</p>
        ) : (
          <div className="space-y-3">
            {run.approvalHistory.map((entry) => (
              <div
                key={entry.id}
                className="flex items-start gap-3 pb-3 border-b border-stone-800 last:border-0 last:pb-0"
              >
                <div className="w-7 h-7 rounded-full bg-stone-800 flex items-center justify-center shrink-0 mt-0.5">
                  <ClipboardList size={13} className="text-stone-400" />
                </div>
                <div className="flex-1">
                  <p className="text-sm text-stone-300">
                    <span className="text-white font-medium">
                      {entry.performedByName}
                    </span>{" "}
                    <span className="text-stone-400">{entry.action}</span>
                  </p>
                  {entry.comment && (
                    <p className="text-xs text-stone-500 mt-0.5">
                      {entry.comment}
                    </p>
                  )}
                  <p className="text-xs text-stone-600 mt-0.5">
                    {fmtDate(entry.createdAt)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Bill Picker Modal */}
      <BillPickerModal
        open={billPickerOpen}
        onClose={() => setBillPickerOpen(false)}
        onAdd={handleAddBills}
        existingBillIds={existingBillIds}
      />
    </div>
  );
}

// ── Bills Table ───────────────────────────────────────────────────────────────

function BillsTable({
  bills,
  isDraft,
  removingBill,
  onRemove,
}: {
  bills: PaymentRunBill[];
  isDraft: boolean;
  removingBill: string | null;
  onRemove: (id: string) => void;
}) {
  if (bills.length === 0) {
    return (
      <EmptyState
        icon={ClipboardList}
        title="No bills added"
        description={
          isDraft
            ? "Click \"Add Bills\" to include bills in this payment run."
            : "This payment run has no bills."
        }
      />
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-stone-800 bg-stone-900/40">
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
              Supplier
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
              Bill #
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
              Due Date
            </th>
            <th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">
              Amount
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
              Currency
            </th>
            <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
              Status
            </th>
            {isDraft && <th className="px-4 py-2.5 w-10" />}
          </tr>
        </thead>
        <tbody>
          {bills.map((bill) => (
            <tr
              key={bill.id}
              className="border-b border-stone-800 last:border-0 hover:bg-stone-800/30 transition-colors"
            >
              <td className="px-4 py-3 font-medium text-white max-w-[160px] truncate">
                {bill.supplierName}
              </td>
              <td className="px-4 py-3 font-mono text-[12px] text-violet-400">
                {bill.billNumber}
              </td>
              <td className="px-4 py-3 text-stone-400 text-[13px] whitespace-nowrap">
                {bill.dueDate
                  ? new Date(bill.dueDate).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })
                  : "—"}
              </td>
              <td className="px-4 py-3 text-right font-semibold text-white tabular-nums text-[13px]">
                {new Intl.NumberFormat("en-US", {
                  style: "currency",
                  currency: bill.currency,
                  minimumFractionDigits: 2,
                }).format(bill.amount)}
              </td>
              <td className="px-4 py-3 text-stone-300 text-[13px]">
                {bill.currency}
              </td>
              <td className="px-4 py-3">
                <span className="inline-flex items-center gap-1 rounded-md ring-1 ring-inset font-medium text-[11px] px-2 py-0.5 bg-stone-800 text-stone-300 ring-stone-700">
                  {bill.status}
                </span>
              </td>
              {isDraft && (
                <td className="px-4 py-3">
                  <button
                    onClick={() => onRemove(bill.id)}
                    disabled={removingBill === bill.id}
                    className="p-1.5 rounded-md text-stone-600 hover:text-rose-400 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                  >
                    {removingBill === bill.id ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Trash2 size={13} />
                    )}
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
