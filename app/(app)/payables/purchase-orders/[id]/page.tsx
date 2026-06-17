"use client";

import { useState, useEffect, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronRight,
  AlertCircle,
  CloudUpload,
  CheckCircle2,
  XCircle,
  Send,
  Plus,
  Trash2,
  CheckCheck,
  Loader2,
  Building2,
  Calendar,
  FileText,
  X,
} from "lucide-react";
import { Card, Badge, Button } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

type POStatus = "Draft" | "Pending Approval" | "Approved" | "Cancelled" | "Closed";
type POApprovalStatus = "Not Required" | "Pending" | "Approved" | "Rejected";
type POPushStatus = "Not Pushed" | "Pending" | "Pushed" | "Failed";

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

interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierName: string;
  supplierId: string;
  supplierEmail?: string;
  supplierPaymentTerms?: number;
  poDate: string;
  deliveryDate?: string;
  currency: string;
  subtotal: number;
  taxTotal: number;
  total: number;
  status: POStatus;
  approvalStatus: POApprovalStatus;
  pushStatus: POPushStatus;
  pushError?: string;
  qboId?: string;
  xeroId?: string;
  linkedPrNumber?: string;
  linkedPrId?: string;
  linkedBillNumbers?: string[];
  lineItems: LineItem[];
  notes?: string;
  createdAt: string;
  updatedAt?: string;
}

interface ApprovalRecord {
  id: string;
  approverName: string;
  action: string;
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

function poStatusBadge(status: POStatus): string {
  const map: Record<POStatus, string> = {
    Draft: "neutral",
    "Pending Approval": "orange",
    Approved: "green",
    Cancelled: "neutral",
    Closed: "neutral",
  };
  return map[status] ?? "neutral";
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5 border-b border-stone-800/60 last:border-0">
      <span className="text-stone-500">{label}</span>
      <span className="text-stone-200 font-medium text-right">{value}</span>
    </div>
  );
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
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
          <h3 className="text-base font-semibold text-white">Reject Purchase Order</h3>
        </div>
        <div className="p-5">
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
          <Button variant="danger" onClick={() => onConfirm(reason)} disabled={loading || !reason.trim()}>
            {loading ? <><Loader2 size={13} className="animate-spin" /> Rejecting…</> : "Reject"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Line Item Row ─────────────────────────────────────────────────────────────

function LineItemRow({
  item,
  editable,
  currency,
  onChange,
  onRemove,
}: {
  item: LineItem;
  editable: boolean;
  currency: string;
  onChange: (updated: LineItem) => void;
  onRemove: () => void;
}) {
  function field(f: keyof LineItem) {
    return (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = ["quantity", "unitPrice", "taxRate"].includes(f as string)
        ? parseFloat(e.target.value) || 0
        : e.target.value;
      const updated = { ...item, [f]: val };
      updated.subtotal = updated.quantity * updated.unitPrice;
      updated.taxAmount = updated.subtotal * (updated.taxRate / 100);
      updated.total = updated.subtotal + updated.taxAmount;
      onChange(updated);
    };
  }

  if (!editable) {
    return (
      <tr className="border-b border-stone-800 hover:bg-stone-800/30">
        <td className="px-4 py-2.5 text-stone-200 text-sm">{item.description || "—"}</td>
        <td className="px-4 py-2.5 text-center text-stone-300 tabular-nums text-sm">{item.quantity}</td>
        <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums text-sm">{fmtMoney(item.unitPrice, currency)}</td>
        <td className="px-4 py-2.5 text-stone-400 text-sm">{item.accountCode || "—"}</td>
        <td className="px-4 py-2.5 text-right text-stone-400 text-sm">{item.taxRate}%</td>
        <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums text-sm">{fmtMoney(item.subtotal, currency)}</td>
        <td className="px-4 py-2.5 text-right text-stone-400 tabular-nums text-sm">{fmtMoney(item.taxAmount, currency)}</td>
        <td className="px-4 py-2.5 text-right font-semibold text-white tabular-nums text-sm">{fmtMoney(item.total, currency)}</td>
      </tr>
    );
  }

  return (
    <tr className="border-b border-stone-800 bg-stone-900">
      <td className="px-2 py-1.5">
        <input
          value={item.description}
          onChange={field("description")}
          placeholder="Description"
          className="w-full h-8 px-2 text-sm rounded border border-stone-700 bg-stone-800 text-white placeholder-stone-600 focus:border-violet-500 focus:outline-none"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          value={item.quantity}
          onChange={field("quantity")}
          min={0}
          step={1}
          className="w-20 h-8 px-2 text-sm rounded border border-stone-700 bg-stone-800 text-white text-center focus:border-violet-500 focus:outline-none"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          value={item.unitPrice}
          onChange={field("unitPrice")}
          min={0}
          step={0.01}
          className="w-28 h-8 px-2 text-sm rounded border border-stone-700 bg-stone-800 text-white text-right focus:border-violet-500 focus:outline-none"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          value={item.accountCode || ""}
          onChange={field("accountCode")}
          placeholder="Account"
          className="w-28 h-8 px-2 text-sm rounded border border-stone-700 bg-stone-800 text-white placeholder-stone-600 focus:border-violet-500 focus:outline-none"
        />
      </td>
      <td className="px-2 py-1.5">
        <input
          type="number"
          value={item.taxRate}
          onChange={field("taxRate")}
          min={0}
          max={100}
          step={0.1}
          className="w-20 h-8 px-2 text-sm rounded border border-stone-700 bg-stone-800 text-white text-right focus:border-violet-500 focus:outline-none"
        />
      </td>
      <td className="px-2 py-1.5 text-right text-stone-300 tabular-nums text-sm pr-4">{fmtMoney(item.subtotal, currency)}</td>
      <td className="px-2 py-1.5 text-right text-stone-400 tabular-nums text-sm pr-4">{fmtMoney(item.taxAmount, currency)}</td>
      <td className="px-2 py-1.5 text-right font-semibold text-white tabular-nums text-sm pr-2">{fmtMoney(item.total, currency)}</td>
      <td className="px-2 py-1.5 text-center">
        <button onClick={onRemove} className="p-1 rounded hover:bg-rose-500/20 text-stone-600 hover:text-rose-400 transition-colors">
          <Trash2 size={13} />
        </button>
      </td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();

  const [po, setPo] = useState<PurchaseOrder | null>(null);
  const [approvals, setApprovals] = useState<ApprovalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [savingLines, setSavingLines] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [poRes, appRes] = await Promise.all([
        fetch(`/api/payables/purchase-orders/${id}`),
        fetch(`/api/payables/approval-inbox?entityId=${id}`),
      ]);
      if (!poRes.ok) throw new Error("Purchase order not found");
      const poData = await poRes.json();
      const poObj = poData.purchaseOrder ?? poData;
      setPo(poObj);
      setLineItems(poObj.lineItems ?? []);
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

  function addLine() {
    const blank: LineItem = {
      id: `new-${Date.now()}`,
      description: "",
      quantity: 1,
      unitPrice: 0,
      accountCode: "",
      taxRate: 0,
      subtotal: 0,
      taxAmount: 0,
      total: 0,
    };
    setLineItems((prev) => [...prev, blank]);
  }

  async function saveLines() {
    setSavingLines(true);
    try {
      await fetch(`/api/payables/purchase-orders/${id}/line-items`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineItems }),
      });
      await load();
    } catch {
    } finally {
      setSavingLines(false);
    }
  }

  const isEditable = po?.status === "Draft";
  const computedSubtotal = lineItems.reduce((acc, l) => acc + l.subtotal, 0);
  const computedTax = lineItems.reduce((acc, l) => acc + l.taxAmount, 0);
  const computedTotal = lineItems.reduce((acc, l) => acc + l.total, 0);

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

  if (error || !po) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto">
        <div className="flex items-center gap-2 p-4 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400">
          <AlertCircle size={16} /> {error || "Purchase order not found"}
          <button onClick={load} className="ml-auto text-rose-300 hover:text-white underline text-sm">Retry</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-1.5 text-sm text-stone-500 mb-5">
        <Link href="/payables/purchase-orders" className="hover:text-stone-300 transition-colors">Purchase Orders</Link>
        <ChevronRight size={14} />
        <span className="text-stone-300 font-medium">{po.poNumber}</span>
      </nav>

      {/* Header */}
      <div className="flex items-start justify-between mb-5 gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-white">{po.poNumber}</h1>
              <Badge variant={poStatusBadge(po.status)} size="md">{po.status}</Badge>
            </div>
            <p className="text-sm text-stone-400 mt-0.5">{po.supplierName} · {fmtMoney(po.total, po.currency)}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {po.status === "Draft" && (
            <button
              onClick={() => callAction(`/api/payables/purchase-orders/${id}/submit`)}
              disabled={actionLoading}
              className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
            >
              {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <Send size={14} />}
              Submit for Approval
            </button>
          )}
          {po.status === "Pending Approval" && (
            <>
              <button
                onClick={() => callAction(`/api/payables/purchase-orders/${id}/approve`)}
                disabled={actionLoading}
                className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-emerald-600 hover:bg-emerald-500 text-white transition-colors disabled:opacity-50"
              >
                {actionLoading ? <Loader2 size={13} className="animate-spin" /> : <CheckCheck size={14} />}
                Approve
              </button>
              <Button variant="danger" onClick={() => setShowRejectModal(true)} disabled={actionLoading}>
                <XCircle size={14} /> Reject
              </Button>
            </>
          )}
          {po.status === "Approved" && po.pushStatus !== "Pushed" && (
            <button
              onClick={() => callAction(`/api/payables/purchase-orders/${id}/push`)}
              disabled={actionLoading || po.pushStatus === "Pending"}
              className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
            >
              {actionLoading || po.pushStatus === "Pending" ? <Loader2 size={13} className="animate-spin" /> : <CloudUpload size={14} />}
              Push to Accounting
            </button>
          )}
          {po.pushStatus === "Pushed" && (
            <div className="flex items-center gap-1.5 text-sm text-violet-400">
              <CloudUpload size={15} />
              <span className="font-medium">Pushed to accounting</span>
            </div>
          )}
        </div>
      </div>

      {/* Push error */}
      {po.pushStatus === "Failed" && po.pushError && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={14} />
          Push failed: {po.pushError}
        </div>
      )}

      {actionError && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={14} /> {actionError}
          <button onClick={() => setActionError(null)} className="ml-auto"><X size={13} /></button>
        </div>
      )}

      {/* External ID badge */}
      {(po.qboId || po.xeroId) && (
        <div className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 bg-violet-500/10 border border-violet-500/30 rounded-lg text-violet-300 text-sm">
          <CheckCircle2 size={14} className="text-violet-400" />
          {po.qboId ? `QBO ID: ${po.qboId}` : `Xero ID: ${po.xeroId}`}
        </div>
      )}

      <div className="grid grid-cols-3 gap-5">
        {/* Line Items */}
        <div className="col-span-2 space-y-5">
          <Card padding="none">
            <div className="px-4 py-3 border-b border-stone-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-stone-300 flex items-center gap-2">
                <FileText size={14} className="text-violet-400" />
                Line Items
              </h2>
              {isEditable && (
                <div className="flex items-center gap-2">
                  <button
                    onClick={addLine}
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded bg-stone-800 hover:bg-stone-700 text-stone-300 transition-colors"
                  >
                    <Plus size={12} /> Add Line
                  </button>
                  <button
                    onClick={saveLines}
                    disabled={savingLines}
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
                  >
                    {savingLines ? <Loader2 size={12} className="animate-spin" /> : null}
                    Save
                  </button>
                </div>
              )}
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
                    {isEditable && <th className="px-2 py-2 w-8" />}
                  </tr>
                </thead>
                <tbody>
                  {lineItems.length === 0 ? (
                    <tr>
                      <td colSpan={isEditable ? 9 : 8} className="px-4 py-8 text-center text-stone-500 text-sm italic">
                        No line items yet.{isEditable && " Click \"Add Line\" to start."}
                      </td>
                    </tr>
                  ) : (
                    lineItems.map((item, idx) => (
                      <LineItemRow
                        key={item.id}
                        item={item}
                        editable={isEditable}
                        currency={po.currency}
                        onChange={(updated) => setLineItems((prev) => prev.map((l, i) => i === idx ? updated : l))}
                        onRemove={() => setLineItems((prev) => prev.filter((_, i) => i !== idx))}
                      />
                    ))
                  )}
                </tbody>
                {lineItems.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-stone-700 bg-stone-900/80">
                      <td colSpan={isEditable ? 5 : 4} className="px-4 py-2.5 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Subtotal</td>
                      <td className="px-4 py-2.5 text-right text-stone-300 tabular-nums font-semibold">{fmtMoney(computedSubtotal, po.currency)}</td>
                      <td className="px-4 py-2.5 text-right text-stone-400 tabular-nums">{fmtMoney(computedTax, po.currency)}</td>
                      <td className="px-4 py-2.5 text-right font-bold text-white tabular-nums">{fmtMoney(computedTotal, po.currency)}</td>
                      {isEditable && <td />}
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
              <div className="space-y-3">
                {approvals.map((a) => (
                  <div key={a.id} className="flex items-start gap-3">
                    <div className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${a.action === "Approved" ? "bg-emerald-500" : a.action === "Rejected" ? "bg-rose-500" : "bg-stone-500"}`} />
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-stone-200">{a.approverName}</span>
                        <span className={`text-xs font-semibold ${a.action === "Approved" ? "text-emerald-400" : a.action === "Rejected" ? "text-rose-400" : "text-stone-400"}`}>{a.action}</span>
                        <span className="text-[11px] text-stone-500 ml-auto">{fmtDateTime(a.createdAt)}</span>
                      </div>
                      {a.comment && <p className="text-sm text-stone-400 mt-1">{a.comment}</p>}
                    </div>
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
                <p className="text-sm font-medium text-white">{po.supplierName}</p>
                {po.supplierEmail && <p className="text-xs text-stone-500">{po.supplierEmail}</p>}
              </div>
            </div>
            {po.supplierPaymentTerms != null && (
              <p className="text-xs text-stone-500">Payment terms: Net {po.supplierPaymentTerms}</p>
            )}
          </Card>

          {/* PO Dates */}
          <Card>
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Dates</h3>
            <InfoRow label="PO Date" value={fmtDate(po.poDate)} />
            <InfoRow label="Delivery Date" value={fmtDate(po.deliveryDate)} />
            <InfoRow label="Created" value={fmtDate(po.createdAt)} />
          </Card>

          {/* Linked Bills */}
          {po.linkedBillNumbers && po.linkedBillNumbers.length > 0 && (
            <Card>
              <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Linked Bills</h3>
              <div className="space-y-1">
                {po.linkedBillNumbers.map((bn, i) => (
                  <div key={i} className="text-sm text-stone-300 flex items-center gap-2">
                    <FileText size={13} className="text-stone-500 shrink-0" />
                    {bn}
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Totals */}
          <Card>
            <h3 className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-2">Totals</h3>
            <div className="space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-stone-400">Subtotal</span>
                <span className="text-stone-200 tabular-nums">{fmtMoney(computedSubtotal || po.subtotal, po.currency)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-stone-400">Tax</span>
                <span className="text-stone-200 tabular-nums">{fmtMoney(computedTax || po.taxTotal, po.currency)}</span>
              </div>
              <div className="flex justify-between text-sm pt-1.5 border-t border-stone-800 font-semibold">
                <span className="text-stone-200">Total</span>
                <span className="text-white tabular-nums">{fmtMoney(computedTotal || po.total, po.currency)}</span>
              </div>
            </div>
          </Card>
        </div>
      </div>

      <RejectModal
        open={showRejectModal}
        onClose={() => setShowRejectModal(false)}
        loading={actionLoading}
        onConfirm={(reason) => {
          setShowRejectModal(false);
          callAction(`/api/payables/purchase-orders/${id}/reject`, { reason });
        }}
      />
    </div>
  );
}
