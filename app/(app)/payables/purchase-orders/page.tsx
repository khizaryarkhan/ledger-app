"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Search,
  Plus,
  ShoppingCart,
  AlertCircle,
  X,
  CloudUpload,
  Loader2,
} from "lucide-react";
import { Card, Badge, Button, Input, Select, EmptyState } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

type POStatus = "Draft" | "Pending Approval" | "Approved" | "Cancelled" | "Closed";
type POApprovalStatus = "Not Required" | "Pending" | "Approved" | "Rejected";
type POPushStatus = "Not Pushed" | "Pending" | "Pushed" | "Failed";

interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierName: string;
  supplierId: string;
  poDate: string;
  total: number;
  currency: string;
  status: POStatus;
  approvalStatus: POApprovalStatus;
  pushStatus: POPushStatus;
  createdAt: string;
}

interface Supplier {
  id: string;
  name: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d?: string) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtMoney(amount: number, currency = "USD") {
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

function approvalStatusBadge(status: POApprovalStatus): string {
  const map: Record<POApprovalStatus, string> = {
    "Not Required": "neutral",
    Pending: "yellow",
    Approved: "green",
    Rejected: "red",
  };
  return map[status] ?? "neutral";
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-lg px-4 py-3 flex flex-col gap-1 min-w-[120px]">
      <span className={`text-xl font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-[11px] text-stone-400 font-medium">{label}</span>
    </div>
  );
}

// ── Push Status Icon ──────────────────────────────────────────────────────────

function PushStatusIcon({ status }: { status: POPushStatus }) {
  if (status === "Pushed") {
    return <CloudUpload size={15} className="text-violet-400" title="Pushed to accounting" />;
  }
  if (status === "Pending") {
    return <CloudUpload size={15} className="text-amber-400 animate-pulse" title="Push pending" />;
  }
  if (status === "Failed") {
    return <CloudUpload size={15} className="text-rose-400" title="Push failed" />;
  }
  return (
    <CloudUpload
      size={15}
      className="text-stone-600"
      style={{ strokeDasharray: "4 2" }}
      title="Not pushed"
    />
  );
}

// ── Create PO Modal ───────────────────────────────────────────────────────────

const EMPTY_PO_FORM = {
  supplierId: "",
  supplierSearch: "",
  poDate: new Date().toISOString().slice(0, 10),
  currency: "USD",
  notes: "",
};

function CreatePOModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState(EMPTY_PO_FORM);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [supplierResults, setSupplierResults] = useState<Supplier[]>([]);
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);

  useEffect(() => {
    if (!open) return;
    fetch("/api/payables/suppliers")
      .then((r) => r.ok ? r.json() : [])
      .then((data) => setSuppliers(Array.isArray(data) ? data : data.suppliers ?? []))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!form.supplierSearch.trim()) { setSupplierResults([]); return; }
    const q = form.supplierSearch.toLowerCase();
    setSupplierResults(suppliers.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8));
  }, [form.supplierSearch, suppliers]);

  function set(field: keyof typeof EMPTY_PO_FORM) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.supplierId) { setError("Please select a supplier."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplierId: form.supplierId,
          poDate: form.poDate,
          currency: form.currency,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to create purchase order");
      }
      setForm(EMPTY_PO_FORM);
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-stone-900 border border-stone-800 rounded-xl shadow-2xl w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800">
          <h3 className="text-base font-semibold text-white">New Purchase Order</h3>
          <button onClick={onClose} className="p-1 rounded-md text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition-colors">
            <X size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
              <AlertCircle size={14} /> {error}
            </div>
          )}
          <div className="relative">
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Supplier <span className="text-rose-400">*</span></label>
            <input
              value={form.supplierSearch}
              onChange={(e) => {
                setForm((prev) => ({ ...prev, supplierSearch: e.target.value, supplierId: "" }));
                setShowSupplierDropdown(true);
              }}
              onFocus={() => setShowSupplierDropdown(true)}
              placeholder="Search suppliers…"
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none"
            />
            {showSupplierDropdown && supplierResults.length > 0 && (
              <div className="absolute top-full left-0 right-0 z-10 mt-1 bg-stone-800 border border-stone-700 rounded-lg shadow-lg overflow-hidden">
                {supplierResults.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setForm((prev) => ({ ...prev, supplierId: s.id, supplierSearch: s.name }));
                      setShowSupplierDropdown(false);
                    }}
                    className="w-full text-left px-3 py-2 text-sm text-stone-200 hover:bg-stone-700 transition-colors"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1.5">PO Date</label>
              <input
                type="date"
                value={form.poDate}
                onChange={set("poDate")}
                className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-stone-400 mb-1.5">Currency</label>
              <select
                value={form.currency}
                onChange={set("currency")}
                className="w-full h-9 px-3 pr-8 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-violet-500 focus:outline-none appearance-none"
                style={{ backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundPosition: "right 0.5rem center", backgroundSize: "12px" }}
              >
                {["USD", "EUR", "GBP", "AUD", "CAD", "NZD", "SGD", "HKD", "JPY", "ZAR"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Notes</label>
            <textarea
              value={form.notes}
              onChange={set("notes")}
              rows={2}
              className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none"
            />
          </div>
        </form>
        <div className="px-5 py-3.5 border-t border-stone-800 flex items-center justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors disabled:opacity-50"
          >
            {saving ? <><Loader2 size={13} className="animate-spin" /> Creating…</> : "Create PO"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: POStatus[] = ["Draft", "Pending Approval", "Approved", "Cancelled", "Closed"];

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [poRes, supRes] = await Promise.all([
        fetch("/api/payables/purchase-orders"),
        fetch("/api/payables/suppliers"),
      ]);
      if (!poRes.ok) throw new Error("Failed to load purchase orders");
      const poData = await poRes.json();
      setOrders(Array.isArray(poData) ? poData : poData.purchaseOrders ?? []);
      if (supRes.ok) {
        const supData = await supRes.json();
        setSuppliers(Array.isArray(supData) ? supData : supData.suppliers ?? []);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let rows = orders;
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.poNumber.toLowerCase().includes(s) ||
          r.supplierName.toLowerCase().includes(s)
      );
    }
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    if (supplierFilter) rows = rows.filter((r) => r.supplierId === supplierFilter);
    return rows;
  }, [orders, search, statusFilter, supplierFilter]);

  const stats = useMemo(() => ({
    draft: orders.filter((o) => o.status === "Draft").length,
    pendingApproval: orders.filter((o) => o.status === "Pending Approval").length,
    approved: orders.filter((o) => o.status === "Approved").length,
    pushedToAccounting: orders.filter((o) => o.pushStatus === "Pushed").length,
  }), [orders]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Purchase Orders</h1>
          <p className="text-sm text-stone-500 mt-1">
            {loading ? "Loading…" : `${filtered.length} order${filtered.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
        >
          <Plus size={15} />
          New PO
        </button>
      </div>

      {/* Stats Row */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <StatCard label="Draft" value={stats.draft} color="text-stone-300" />
        <StatCard label="Pending Approval" value={stats.pendingApproval} color="text-orange-400" />
        <StatCard label="Approved" value={stats.approved} color="text-emerald-400" />
        <StatCard label="Pushed to Accounting" value={stats.pushedToAccounting} color="text-violet-400" />
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={14} /> {error}
          <button onClick={load} className="ml-auto text-rose-300 hover:text-white underline text-xs">Retry</button>
        </div>
      )}

      <Card padding="none">
        {/* Filters */}
        <div className="px-3 py-2.5 border-b border-stone-800 flex items-center gap-2 flex-wrap">
          <Input
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
            placeholder="Search PO # or supplier…"
            icon={Search}
            className="w-72"
          />
          <Select
            value={statusFilter}
            onChange={(e: any) => setStatusFilter(e.target.value)}
            placeholder="All statuses"
            options={STATUS_OPTIONS}
          />
          <Select
            value={supplierFilter}
            onChange={(e: any) => setSupplierFilter(e.target.value)}
            placeholder="All suppliers"
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          />
          {(search || statusFilter || supplierFilter) && (
            <Button variant="ghost" size="sm" icon={X} onClick={() => { setSearch(""); setStatusFilter(""); setSupplierFilter(""); }}>
              Clear
            </Button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5 space-y-2">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">PO #</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Supplier</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">PO Date</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Total</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Approval</th>
                  <th className="px-4 py-2.5 text-center text-xs font-semibold text-stone-400 uppercase tracking-wide">Push</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((po) => (
                  <tr
                    key={po.id}
                    onClick={() => router.push(`/payables/purchase-orders/${po.id}`)}
                    className="border-b border-stone-800 hover:bg-stone-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-[12px] text-violet-400">{po.poNumber}</td>
                    <td className="px-4 py-3 font-medium text-white">{po.supplierName}</td>
                    <td className="px-4 py-3 text-stone-400 text-[13px] whitespace-nowrap">{fmtDate(po.poDate)}</td>
                    <td className="px-4 py-3 text-right text-stone-300 tabular-nums text-[13px] font-semibold">{fmtMoney(po.total, po.currency)}</td>
                    <td className="px-4 py-3"><Badge variant={poStatusBadge(po.status)}>{po.status}</Badge></td>
                    <td className="px-4 py-3"><Badge variant={approvalStatusBadge(po.approvalStatus)}>{po.approvalStatus}</Badge></td>
                    <td className="px-4 py-3 text-center"><PushStatusIcon status={po.pushStatus} /></td>
                    <td className="px-4 py-3 text-stone-500 text-[12px] whitespace-nowrap">{fmtDate(po.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {!loading && filtered.length === 0 && (
            <EmptyState
              icon={ShoppingCart}
              title="No purchase orders found"
              description={
                orders.length === 0
                  ? "Create your first purchase order to get started."
                  : "Try adjusting your filters."
              }
              action={
                orders.length === 0 ? (
                  <button
                    onClick={() => setShowCreate(true)}
                    className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
                  >
                    <Plus size={14} />
                    New PO
                  </button>
                ) : undefined
              }
            />
          )}
        </div>
      </Card>

      <CreatePOModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
    </div>
  );
}
