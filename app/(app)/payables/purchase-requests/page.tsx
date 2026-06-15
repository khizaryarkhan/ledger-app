"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Search,
  Plus,
  FileText,
  AlertCircle,
  X,
  ChevronRight,
  Loader2,
  ClipboardList,
} from "lucide-react";
import { Card, Badge, Button, Input, Select, Modal, EmptyState } from "@/components/ui";

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
  requesterName: string;
  supplierName?: string;
  estimatedTotal: number;
  currency: string;
  requiredByDate?: string;
  status: PRStatus;
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

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-lg px-4 py-3 flex flex-col gap-1 min-w-[110px]">
      <span className={`text-xl font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-[11px] text-stone-400 font-medium">{label}</span>
    </div>
  );
}

// ── Create PR Modal ───────────────────────────────────────────────────────────

const EMPTY_FORM = {
  title: "",
  description: "",
  businessJustification: "",
  supplierId: "",
  supplierSearch: "",
  requiredByDate: "",
  currency: "USD",
  estimatedTotal: "",
  notes: "",
};

function CreatePRModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [form, setForm] = useState(EMPTY_FORM);
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
    if (!form.supplierSearch.trim()) {
      setSupplierResults([]);
      return;
    }
    const q = form.supplierSearch.toLowerCase();
    setSupplierResults(suppliers.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8));
  }, [form.supplierSearch, suppliers]);

  function set(field: keyof typeof EMPTY_FORM) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.title.trim()) { setError("Title is required."); return; }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/purchase-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title,
          description: form.description || null,
          businessJustification: form.businessJustification || null,
          supplierId: form.supplierId || null,
          requiredByDate: form.requiredByDate || null,
          currency: form.currency,
          estimatedTotal: form.estimatedTotal ? parseFloat(form.estimatedTotal) : null,
          notes: form.notes || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to create request");
      }
      setForm(EMPTY_FORM);
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function selectSupplier(s: Supplier) {
    setForm((prev) => ({ ...prev, supplierId: s.id, supplierSearch: s.name }));
    setShowSupplierDropdown(false);
  }

  if (!open) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Purchase Request"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button
            type="submit"
            onClick={handleSubmit}
            disabled={saving}
            className="bg-violet-600 hover:bg-violet-500 text-white"
          >
            {saving ? <><Loader2 size={14} className="animate-spin" /> Creating…</> : "Create Request"}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="p-5 space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
            <AlertCircle size={15} />
            {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">Title <span className="text-rose-400">*</span></label>
          <input
            value={form.title}
            onChange={set("title")}
            placeholder="e.g. Office Supplies Q3"
            className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">Description</label>
          <textarea
            value={form.description}
            onChange={set("description")}
            rows={3}
            placeholder="What do you need and why?"
            className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">Business Justification</label>
          <textarea
            value={form.businessJustification}
            onChange={set("businessJustification")}
            rows={2}
            placeholder="How does this support business goals?"
            className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="relative">
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Supplier (optional)</label>
            <input
              value={form.supplierSearch}
              onChange={(e) => {
                set("supplierSearch")(e);
                setShowSupplierDropdown(true);
                if (!e.target.value) setForm((prev) => ({ ...prev, supplierId: "" }));
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
                    onClick={() => selectSupplier(s)}
                    className="w-full text-left px-3 py-2 text-sm text-stone-200 hover:bg-stone-700 transition-colors"
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Required By Date</label>
            <input
              type="date"
              value={form.requiredByDate}
              onChange={set("requiredByDate")}
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
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

          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Estimated Total</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.estimatedTotal}
              onChange={set("estimatedTotal")}
              placeholder="0.00"
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">Notes</label>
          <textarea
            value={form.notes}
            onChange={set("notes")}
            rows={2}
            placeholder="Any additional notes…"
            className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none"
          />
        </div>
      </form>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: PRStatus[] = [
  "Draft",
  "Submitted",
  "Pending Review",
  "Pending Approval",
  "Approved",
  "Rejected",
  "Cancelled",
  "Converted to PO",
];

export default function PurchaseRequestsPage() {
  const router = useRouter();
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/purchase-requests");
      if (!res.ok) throw new Error("Failed to load purchase requests");
      const data = await res.json();
      setRequests(Array.isArray(data) ? data : data.purchaseRequests ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let rows = requests;
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.requestNumber.toLowerCase().includes(s) ||
          r.title.toLowerCase().includes(s) ||
          r.requesterName.toLowerCase().includes(s) ||
          (r.supplierName || "").toLowerCase().includes(s)
      );
    }
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    return rows;
  }, [requests, search, statusFilter]);

  const stats = useMemo(() => {
    const count = (s: PRStatus) => requests.filter((r) => r.status === s).length;
    return {
      draft: count("Draft"),
      submitted: count("Submitted"),
      pendingApproval: count("Pending Approval"),
      approved: count("Approved"),
      rejected: count("Rejected"),
    };
  }, [requests]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Purchase Requests</h1>
          <p className="text-sm text-stone-500 mt-1">
            {loading ? "Loading…" : `${filtered.length} request${filtered.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={() => setShowCreate(true)}
          className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
        >
          <Plus size={15} />
          New Request
        </button>
      </div>

      {/* Stats Row */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <StatCard label="Draft" value={stats.draft} color="text-stone-300" />
        <StatCard label="Submitted" value={stats.submitted} color="text-blue-400" />
        <StatCard label="Pending Approval" value={stats.pendingApproval} color="text-orange-400" />
        <StatCard label="Approved" value={stats.approved} color="text-emerald-400" />
        <StatCard label="Rejected" value={stats.rejected} color="text-rose-400" />
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={15} />
          {error}
          <button onClick={load} className="ml-auto text-rose-300 hover:text-white underline text-xs">Retry</button>
        </div>
      )}

      <Card padding="none">
        {/* Filters */}
        <div className="px-3 py-2.5 border-b border-stone-800 flex items-center gap-2 flex-wrap">
          <Input
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
            placeholder="Search requests…"
            icon={Search}
            className="w-72"
          />
          <Select
            value={statusFilter}
            onChange={(e: any) => setStatusFilter(e.target.value)}
            placeholder="All statuses"
            options={STATUS_OPTIONS}
          />
          {(search || statusFilter) && (
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              onClick={() => { setSearch(""); setStatusFilter(""); }}
            >
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
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Request #</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Title</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Requester</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Supplier</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Est. Total</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Required By</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((pr) => (
                  <tr
                    key={pr.id}
                    onClick={() => router.push(`/payables/purchase-requests/${pr.id}`)}
                    className="border-b border-stone-800 hover:bg-stone-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3 font-mono text-[12px] text-violet-400">{pr.requestNumber}</td>
                    <td className="px-4 py-3 font-medium text-white max-w-[200px] truncate">{pr.title}</td>
                    <td className="px-4 py-3 text-stone-300 text-[13px]">{pr.requesterName}</td>
                    <td className="px-4 py-3 text-stone-400 text-[13px]">{pr.supplierName || <span className="text-stone-600 italic">Not specified</span>}</td>
                    <td className="px-4 py-3 text-right text-stone-300 tabular-nums text-[13px]">
                      {pr.estimatedTotal != null ? fmtMoney(pr.estimatedTotal, pr.currency) : "—"}
                    </td>
                    <td className="px-4 py-3 text-stone-400 text-[13px] whitespace-nowrap">{fmtDate(pr.requiredByDate)}</td>
                    <td className="px-4 py-3">
                      <Badge variant={prStatusBadge(pr.status)}>{pr.status}</Badge>
                    </td>
                    <td className="px-4 py-3 text-stone-500 text-[12px] whitespace-nowrap">{fmtDate(pr.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!loading && filtered.length === 0 && (
            <EmptyState
              icon={ClipboardList}
              title="No purchase requests found"
              description={
                requests.length === 0
                  ? "Create your first purchase request to get started."
                  : "Try adjusting your search or filters."
              }
              action={
                requests.length === 0 ? (
                  <button
                    onClick={() => setShowCreate(true)}
                    className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
                  >
                    <Plus size={14} />
                    New Request
                  </button>
                ) : undefined
              }
            />
          )}
        </div>
      </Card>

      <CreatePRModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
    </div>
  );
}
