"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  AlertCircle,
  X,
  Loader2,
  ClipboardList,
} from "lucide-react";
import { Card, Badge, Button, Input, Select, Modal, EmptyState } from "@/components/ui";
import { useDataTable, ColHeader, ActiveFiltersBar, type ColDef } from "@/components/data-table";
import { fmt, formatDate } from "@/lib/format";

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

type PeriodId = "this-month" | "last-month" | "last-3m" | "last-6m" | "all" | "custom";

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

// ── Period helpers ─────────────────────────────────────────────────────────────

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "this-month", label: "This Month" },
  { id: "last-month", label: "Last Month" },
  { id: "last-3m",    label: "Last 3M" },
  { id: "last-6m",    label: "Last 6M" },
  { id: "all",        label: "All Time" },
  { id: "custom",     label: "Custom" },
];

function getPeriodRange(id: PeriodId): { from: Date; to: Date } {
  const now = new Date();
  if (id === "this-month")
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0) };
  if (id === "last-month")
    return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 0) };
  if (id === "last-3m")
    return { from: new Date(now.getFullYear(), now.getMonth() - 3, 1), to: now };
  if (id === "last-6m")
    return { from: new Date(now.getFullYear(), now.getMonth() - 6, 1), to: now };
  return { from: new Date(2000, 0, 1), to: now };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

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

const CURRENCIES = ["USD", "EUR", "GBP", "AUD", "CAD", "NZD", "SGD", "HKD", "JPY", "ZAR"];

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
    setForm(EMPTY_FORM);
    setError(null);
    fetch("/api/payables/suppliers")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setSuppliers(Array.isArray(data) ? data : data.suppliers ?? []))
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!form.supplierSearch.trim()) { setSupplierResults([]); return; }
    const q = form.supplierSearch.toLowerCase();
    setSupplierResults(suppliers.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8));
  }, [form.supplierSearch, suppliers]);

  function setField(field: keyof typeof EMPTY_FORM) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));
  }

  async function handleSubmit() {
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
      onCreated();
      onClose();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New Purchase Request"
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 size={14} className="animate-spin" />}
            Create Request
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
            <AlertCircle size={15} /> {error}
          </div>
        )}

        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">
            Title <span className="text-rose-400">*</span>
          </label>
          <Input
            value={form.title}
            onChange={setField("title")}
            placeholder="e.g. Office Supplies Q3"
            className="w-full"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">Description</label>
          <textarea
            value={form.description}
            onChange={setField("description")}
            rows={3}
            placeholder="What do you need and why?"
            className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">Business Justification</label>
          <textarea
            value={form.businessJustification}
            onChange={setField("businessJustification")}
            rows={2}
            placeholder="How does this support business goals?"
            className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          {/* Supplier combobox */}
          <div className="relative">
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Supplier <span className="text-stone-600">(optional)</span></label>
            <Input
              value={form.supplierSearch}
              onChange={(e: any) => {
                setForm((prev) => ({ ...prev, supplierSearch: e.target.value, supplierId: "" }));
                setShowSupplierDropdown(true);
              }}
              onFocus={() => setShowSupplierDropdown(true)}
              placeholder="Search suppliers…"
              icon={Search}
              className="w-full"
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

          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Required By Date</label>
            <input
              type="date"
              value={form.requiredByDate}
              onChange={setField("requiredByDate")}
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Currency</label>
            <Select
              value={form.currency}
              onChange={setField("currency")}
              options={CURRENCIES}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Estimated Total</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={form.estimatedTotal}
              onChange={setField("estimatedTotal")}
              placeholder="0.00"
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">Notes</label>
          <textarea
            value={form.notes}
            onChange={setField("notes")}
            rows={2}
            placeholder="Any additional notes…"
            className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none"
          />
        </div>
      </div>
    </Modal>
  );
}

// ── Column definitions ─────────────────────────────────────────────────────────

const PR_COLS: ColDef[] = [
  { key: "requestNumber", label: "Request #",   sortValue: (r) => r.requestNumber },
  { key: "title",         label: "Title",        sortValue: (r) => r.title ?? "" },
  { key: "requesterName", label: "Requester",    sortValue: (r) => r.requesterName ?? "", filterLabel: (r) => r.requesterName ?? "—" },
  { key: "supplierName",  label: "Supplier",     sortValue: (r) => r.supplierName ?? "", filterLabel: (r) => r.supplierName ?? "Not specified" },
  { key: "estimatedTotal",label: "Est. Total",   sortValue: (r) => r.estimatedTotal ?? 0, align: "right" as const, noFilter: true },
  { key: "requiredByDate",label: "Required By",  sortValue: (r) => r.requiredByDate ?? "", noFilter: true },
  { key: "status",        label: "Status",       sortValue: (r) => r.status ?? "", filterLabel: (r) => r.status ?? "" },
  { key: "createdAt",     label: "Created",      sortValue: (r) => r.createdAt ?? "", noFilter: true },
];

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
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const todayStr = new Date().toISOString().slice(0, 10);
  const lastMonthStart = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })();
  const [period, setPeriod] = useState<PeriodId>("all");
  const [customFrom, setCustomFrom] = useState(lastMonthStart);
  const [customTo, setCustomTo]   = useState(todayStr);

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

  const { from: periodFrom, to: periodTo } = useMemo(() => {
    if (period === "custom") return { from: new Date(customFrom + "T00:00:00"), to: new Date(customTo + "T23:59:59") };
    if (period === "all") return { from: new Date(2000, 0, 1), to: new Date(9999, 11, 31) };
    return getPeriodRange(period);
  }, [period, customFrom, customTo]);

  const baseFiltered = useMemo(() => {
    let rows = requests;

    rows = rows.filter((r) => {
      if (!r.createdAt) return true;
      const d = new Date(r.createdAt + "T00:00:00");
      return d >= periodFrom && d <= periodTo;
    });

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
  }, [requests, search, statusFilter, periodFrom, periodTo]);

  const dt = useDataTable(baseFiltered, PR_COLS, { defaultSort: "createdAt", defaultDir: "desc" });

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

  const allSelected = dt.rows.length > 0 && dt.rows.every((r) => selected.has(r.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(dt.rows.map((r) => r.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Purchase Requests</h1>
          <p className="text-sm text-stone-500 mt-1">
            {loading ? "Loading…" : `${dt.rows.length} request${dt.rows.length !== 1 ? "s" : ""}`}
            <span className="text-stone-400"> · {PERIODS.find((p) => p.id === period)?.label ?? "Custom"}</span>
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
        <StatCard label="Draft"            value={stats.draft}          color="text-stone-300" />
        <StatCard label="Submitted"        value={stats.submitted}      color="text-blue-400" />
        <StatCard label="Pending Approval" value={stats.pendingApproval} color="text-orange-400" />
        <StatCard label="Approved"         value={stats.approved}       color="text-emerald-400" />
        <StatCard label="Rejected"         value={stats.rejected}       color="text-rose-400" />
      </div>

      {error && (
        <div className="mb-4 flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
          <AlertCircle size={15} /> {error}
          <button onClick={load} className="ml-auto text-rose-300 hover:text-white underline text-xs">Retry</button>
        </div>
      )}

      <Card padding="none">
        {/* Period tabs */}
        <div className="flex items-center gap-0 border-b border-stone-800 px-3 pt-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              onClick={() => setPeriod(p.id)}
              className={`px-3 py-2 text-xs font-medium transition-colors border-b-2 -mb-px ${
                period === p.id
                  ? "border-violet-500 text-violet-400"
                  : "border-transparent text-stone-500 hover:text-stone-300"
              }`}
            >
              {p.label}
            </button>
          ))}
          {period === "custom" && (
            <div className="ml-3 flex items-center gap-2">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="h-7 px-2 text-xs rounded border border-stone-700 bg-stone-800 text-stone-300 focus:border-violet-500 focus:outline-none"
              />
              <span className="text-stone-600 text-xs">→</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="h-7 px-2 text-xs rounded border border-stone-700 bg-stone-800 text-stone-300 focus:border-violet-500 focus:outline-none"
              />
            </div>
          )}
        </div>

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
            <Button variant="ghost" size="sm" icon={X} onClick={() => { setSearch(""); setStatusFilter(""); }}>
              Clear
            </Button>
          )}
        </div>

        <ActiveFiltersBar dt={dt} cols={PR_COLS} />

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5 space-y-2">
              {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : dt.rows.length === 0 ? (
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
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-4 py-2.5 w-10">
                    <input
                      type="checkbox"
                      checked={allSelected}
                      onChange={toggleAll}
                      className="rounded border-stone-600 text-violet-500 focus:ring-violet-500"
                    />
                  </th>
                  {PR_COLS.map((col) => (
                    <ColHeader key={col.key} col={col} dt={dt} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {dt.rows.map((pr) => (
                  <tr
                    key={pr.id}
                    onClick={() => router.push(`/payables/purchase-requests/${pr.id}`)}
                    className={`border-b border-stone-800 cursor-pointer transition-colors ${
                      selected.has(pr.id) ? "bg-violet-500/10" : "hover:bg-stone-800/50"
                    }`}
                  >
                    <td className="px-4 py-3" onClick={(e) => { e.stopPropagation(); toggleOne(pr.id); }}>
                      <input
                        type="checkbox"
                        checked={selected.has(pr.id)}
                        onChange={() => toggleOne(pr.id)}
                        className="rounded border-stone-600 text-violet-500 focus:ring-violet-500"
                      />
                    </td>
                    <td className="px-3 py-3 font-mono text-[12px] text-violet-400">{pr.requestNumber}</td>
                    <td className="px-3 py-3 font-medium text-white max-w-[200px] truncate">{pr.title}</td>
                    <td className="px-3 py-3 text-stone-300 text-[13px]">{pr.requesterName}</td>
                    <td className="px-3 py-3 text-stone-400 text-[13px]">
                      {pr.supplierName || <span className="text-stone-600 italic">Not specified</span>}
                    </td>
                    <td className="px-3 py-3 text-right text-stone-300 tabular-nums text-[13px]">
                      {pr.estimatedTotal != null ? fmt.money(pr.estimatedTotal, pr.currency) : "—"}
                    </td>
                    <td className="px-3 py-3 text-stone-400 text-[13px] whitespace-nowrap">{formatDate(pr.requiredByDate)}</td>
                    <td className="px-3 py-3">
                      <Badge variant={prStatusBadge(pr.status)}>{pr.status}</Badge>
                    </td>
                    <td className="px-3 py-3 text-stone-500 text-[12px] whitespace-nowrap">{formatDate(pr.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      <CreatePRModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
    </div>
  );
}
