"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Search,
  AlertCircle,
  Plus,
  X,
  Loader2,
  HelpCircle,
  MessageSquare,
  CheckCircle2,
  Clock,
} from "lucide-react";
import {
  Badge,
  Button,
  Card,
  Input,
  Select,
  Modal,
  EmptyState,
} from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

type QueryCategory =
  | "Missing PO"
  | "Incorrect Amount"
  | "Duplicate Bill"
  | "Wrong Tax"
  | "Goods Not Received"
  | "Other";

type QueryStatus = "Open" | "Under Review" | "Resolved";

interface SupplierQuery {
  id: string;
  category: QueryCategory;
  supplierName: string;
  supplierId: string;
  relatedBillNumber?: string;
  relatedPoNumber?: string;
  reason: string;
  assignedToName: string;
  assignedToId: string;
  status: QueryStatus;
  createdAt: string;
  resolvedAt?: string;
  activity?: ActivityEntry[];
}

interface ActivityEntry {
  id: string;
  user: string;
  message: string;
  createdAt: string;
}

interface Supplier {
  id: string;
  name: string;
}

interface UserOption {
  id: string;
  name: string;
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

function categoryBadgeColor(cat: QueryCategory): string {
  const map: Record<QueryCategory, string> = {
    "Missing PO": "red",
    "Incorrect Amount": "orange",
    "Duplicate Bill": "red",
    "Wrong Tax": "yellow",
    "Goods Not Received": "orange",
    Other: "neutral",
  };
  return map[cat];
}

function statusBadgeColor(status: QueryStatus): string {
  const map: Record<QueryStatus, string> = {
    Open: "red",
    "Under Review": "yellow",
    Resolved: "green",
  };
  return map[status];
}

function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse bg-stone-800 rounded ${className}`} />;
}

function StatCard({
  label,
  value,
  color,
  icon: Icon,
}: {
  label: string;
  value: number;
  color: string;
  icon: any;
}) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-lg px-4 py-3 flex items-center gap-3">
      <div className={`p-2 rounded-md bg-stone-800 ${color}`}>
        <Icon size={16} />
      </div>
      <div>
        <div className={`text-xl font-bold tabular-nums ${color}`}>{value}</div>
        <div className="text-[11px] text-stone-400 font-medium">{label}</div>
      </div>
    </div>
  );
}

const CATEGORIES: QueryCategory[] = [
  "Missing PO",
  "Incorrect Amount",
  "Duplicate Bill",
  "Wrong Tax",
  "Goods Not Received",
  "Other",
];

const STATUSES: QueryStatus[] = ["Open", "Under Review", "Resolved"];

// ── Raise Query Modal ─────────────────────────────────────────────────────────

interface RaiseQueryModalProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: {
    supplierId: string;
    category: QueryCategory;
    reason: string;
    assignedToId: string;
    relatedBillNumber?: string;
  }) => Promise<void>;
  suppliers: Supplier[];
  users: UserOption[];
}

function RaiseQueryModal({
  open,
  onClose,
  onSubmit,
  suppliers,
  users,
}: RaiseQueryModalProps) {
  const [supplierId, setSupplierId] = useState("");
  const [category, setCategory] = useState<QueryCategory | "">("");
  const [reason, setReason] = useState("");
  const [assignedToId, setAssignedToId] = useState("");
  const [relatedBill, setRelatedBill] = useState("");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (open) {
      setSupplierId("");
      setCategory("");
      setReason("");
      setAssignedToId("");
      setRelatedBill("");
      setErr("");
    }
  }, [open]);

  async function handleSubmit() {
    if (!supplierId || !category || !reason.trim() || !assignedToId) {
      setErr("Please fill in all required fields.");
      return;
    }
    setLoading(true);
    try {
      await onSubmit({
        supplierId,
        category: category as QueryCategory,
        reason,
        assignedToId,
        relatedBillNumber: relatedBill || undefined,
      });
      onClose();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Raise Supplier Query"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading && <Loader2 size={14} className="animate-spin" />}
            Submit Query
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        {err && (
          <div className="flex items-center gap-2 p-2.5 bg-rose-500/10 border border-rose-500/30 rounded-md text-rose-400 text-xs">
            <AlertCircle size={13} /> {err}
          </div>
        )}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">
              Supplier <span className="text-rose-400">*</span>
            </label>
            <Select
              value={supplierId}
              onChange={(e: any) => setSupplierId(e.target.value)}
              placeholder="Select supplier"
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">
              Category <span className="text-rose-400">*</span>
            </label>
            <Select
              value={category}
              onChange={(e: any) => setCategory(e.target.value)}
              placeholder="Select category"
              options={CATEGORIES}
              className="w-full"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">
            Related Bill # <span className="text-stone-600">(optional)</span>
          </label>
          <Input
            value={relatedBill}
            onChange={(e: any) => setRelatedBill(e.target.value)}
            placeholder="e.g. BILL-0042"
            className="w-full"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">
            Reason <span className="text-rose-400">*</span>
          </label>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="Describe the issue in detail…"
            className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">
            Assign To <span className="text-rose-400">*</span>
          </label>
          <Select
            value={assignedToId}
            onChange={(e: any) => setAssignedToId(e.target.value)}
            placeholder="Select team member"
            options={users.map((u) => ({ value: u.id, label: u.name }))}
            className="w-full"
          />
        </div>
      </div>
    </Modal>
  );
}

// ── Detail Drawer ─────────────────────────────────────────────────────────────

interface DetailDrawerProps {
  query: SupplierQuery | null;
  onClose: () => void;
  onResolve: (id: string, resolution: string) => Promise<void>;
}

function DetailDrawer({ query, onClose, onResolve }: DetailDrawerProps) {
  const [resolution, setResolution] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (query) setResolution("");
  }, [query?.id]);

  if (!query) return null;

  async function handleResolve() {
    if (!resolution.trim() || !query) return;
    setLoading(true);
    try {
      await onResolve(query.id, resolution);
      onClose();
    } finally {
      setLoading(false);
    }
  }

  const canResolve =
    query.status === "Open" || query.status === "Under Review";

  return (
    <div className="fixed inset-0 z-50 flex">
      <div
        className="flex-1 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="w-[480px] bg-stone-900 border-l border-stone-800 flex flex-col h-full shadow-2xl">
        {/* Drawer header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-stone-800 shrink-0">
          <div className="flex items-center gap-2">
            <Badge variant={categoryBadgeColor(query.category)}>
              {query.category}
            </Badge>
            <Badge variant={statusBadgeColor(query.status)}>
              {query.status}
            </Badge>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-stone-500 hover:text-stone-200 hover:bg-stone-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Details */}
          <div className="space-y-3">
            <div>
              <p className="text-xs font-medium text-stone-500 mb-0.5">
                Supplier
              </p>
              <p className="text-sm text-white font-medium">
                {query.supplierName}
              </p>
            </div>
            {query.relatedBillNumber && (
              <div>
                <p className="text-xs font-medium text-stone-500 mb-0.5">
                  Related Bill
                </p>
                <p className="text-sm text-violet-400 font-mono">
                  {query.relatedBillNumber}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs font-medium text-stone-500 mb-0.5">
                Reason
              </p>
              <p className="text-sm text-stone-300 leading-relaxed">
                {query.reason}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-medium text-stone-500 mb-0.5">
                  Assigned To
                </p>
                <p className="text-sm text-stone-300">
                  {query.assignedToName}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-stone-500 mb-0.5">
                  Created
                </p>
                <p className="text-sm text-stone-300">
                  {fmtDate(query.createdAt)}
                </p>
              </div>
              {query.resolvedAt && (
                <div>
                  <p className="text-xs font-medium text-stone-500 mb-0.5">
                    Resolved
                  </p>
                  <p className="text-sm text-emerald-400">
                    {fmtDate(query.resolvedAt)}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Resolution input */}
          {canResolve && (
            <div className="border-t border-stone-800 pt-5">
              <p className="text-sm font-medium text-white mb-2">
                Resolution
              </p>
              <textarea
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                rows={3}
                placeholder="Describe how this was resolved…"
                className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none mb-2"
              />
              <button
                onClick={handleResolve}
                disabled={loading || !resolution.trim()}
                className="inline-flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-md bg-emerald-600/20 text-emerald-400 ring-1 ring-emerald-600/40 hover:bg-emerald-600/30 transition-colors disabled:opacity-50"
              >
                {loading ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : (
                  <CheckCircle2 size={13} />
                )}
                Mark Resolved
              </button>
            </div>
          )}

          {/* Activity feed */}
          {query.activity && query.activity.length > 0 && (
            <div className="border-t border-stone-800 pt-5">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide mb-3">
                Activity
              </p>
              <div className="space-y-3">
                {query.activity.map((entry) => (
                  <div key={entry.id} className="flex gap-2.5">
                    <div className="w-6 h-6 rounded-full bg-stone-700 flex items-center justify-center shrink-0 mt-0.5">
                      <MessageSquare size={11} className="text-stone-400" />
                    </div>
                    <div>
                      <p className="text-xs text-stone-400">
                        <span className="text-white font-medium">
                          {entry.user}
                        </span>{" "}
                        · {fmtDate(entry.createdAt)}
                      </p>
                      <p className="text-sm text-stone-300 mt-0.5">
                        {entry.message}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SupplierQueriesPage() {
  const [queries, setQueries] = useState<SupplierQuery[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [selectedQuery, setSelectedQuery] = useState<SupplierQuery | null>(
    null
  );

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [qRes, sRes] = await Promise.all([
        fetch("/api/payables/supplier-queries"),
        fetch("/api/payables/suppliers"),
      ]);
      if (!qRes.ok) throw new Error("Failed to load queries");
      const qData = await qRes.json();
      setQueries(Array.isArray(qData) ? qData : qData.queries ?? []);
      if (sRes.ok) {
        const sData = await sRes.json();
        setSuppliers(
          Array.isArray(sData) ? sData : sData.suppliers ?? []
        );
      }
      // Mock users for assignment
      setUsers([
        { id: "u1", name: "Alice Johnson" },
        { id: "u2", name: "Bob Smith" },
        { id: "u3", name: "Carol White" },
      ]);
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
    let rows = queries;
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (q) =>
          q.supplierName.toLowerCase().includes(s) ||
          q.reason.toLowerCase().includes(s) ||
          q.relatedBillNumber?.toLowerCase().includes(s)
      );
    }
    if (statusFilter) rows = rows.filter((q) => q.status === statusFilter);
    if (categoryFilter)
      rows = rows.filter((q) => q.category === categoryFilter);
    if (supplierFilter)
      rows = rows.filter((q) => q.supplierId === supplierFilter);
    return rows;
  }, [queries, search, statusFilter, categoryFilter, supplierFilter]);

  const stats = useMemo(
    () => ({
      open: queries.filter((q) => q.status === "Open").length,
      underReview: queries.filter((q) => q.status === "Under Review").length,
      resolved: queries.filter((q) => q.status === "Resolved").length,
      total: queries.length,
    }),
    [queries]
  );

  async function handleRaiseQuery(data: {
    supplierId: string;
    category: QueryCategory;
    reason: string;
    assignedToId: string;
    relatedBillNumber?: string;
  }) {
    const res = await fetch("/api/payables/supplier-queries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error("Failed to submit query");
    await load();
  }

  async function handleResolve(id: string, resolution: string) {
    const res = await fetch(`/api/payables/supplier-queries/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Resolved", resolution }),
    });
    if (!res.ok) throw new Error("Failed to resolve query");
    await load();
  }

  const clearFilters =
    search || statusFilter || categoryFilter || supplierFilter;

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold text-white tracking-tight">
          Supplier Queries
        </h1>
        <button
          onClick={() => setRaiseOpen(true)}
          className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
        >
          <Plus size={15} />
          Raise Query
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <StatCard
          label="Open"
          value={stats.open}
          color="text-rose-400"
          icon={AlertCircle}
        />
        <StatCard
          label="Under Review"
          value={stats.underReview}
          color="text-amber-400"
          icon={Clock}
        />
        <StatCard
          label="Resolved"
          value={stats.resolved}
          color="text-emerald-400"
          icon={CheckCircle2}
        />
        <StatCard
          label="Total"
          value={stats.total}
          color="text-stone-300"
          icon={HelpCircle}
        />
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

      <Card padding="none">
        {/* Filters */}
        <div className="px-3 py-2.5 border-b border-stone-800 flex items-center gap-2 flex-wrap">
          <Input
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
            placeholder="Search queries…"
            icon={Search}
            className="w-56"
          />
          <Select
            value={statusFilter}
            onChange={(e: any) => setStatusFilter(e.target.value)}
            placeholder="All statuses"
            options={STATUSES}
          />
          <Select
            value={categoryFilter}
            onChange={(e: any) => setCategoryFilter(e.target.value)}
            placeholder="All categories"
            options={CATEGORIES}
          />
          <Select
            value={supplierFilter}
            onChange={(e: any) => setSupplierFilter(e.target.value)}
            placeholder="All suppliers"
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          />
          {clearFilters && (
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              onClick={() => {
                setSearch("");
                setStatusFilter("");
                setCategoryFilter("");
                setSupplierFilter("");
              }}
            >
              Clear
            </Button>
          )}
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          {loading ? (
            <div className="p-5 space-y-2">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-10 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState
              icon={HelpCircle}
              title="No queries found"
              description={
                queries.length === 0
                  ? "No supplier queries have been raised yet."
                  : "Try adjusting your filters."
              }
              action={
                queries.length === 0 ? (
                  <button
                    onClick={() => setRaiseOpen(true)}
                    className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-violet-600 hover:bg-violet-500 text-white transition-colors"
                  >
                    <Plus size={14} />
                    Raise First Query
                  </button>
                ) : undefined
              }
            />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-stone-800 bg-stone-900/60">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Category
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Supplier
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Related Bill / PO
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Reason
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Assigned To
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Created
                  </th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">
                    Resolved
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q) => (
                  <tr
                    key={q.id}
                    onClick={() => setSelectedQuery(q)}
                    className="border-b border-stone-800 hover:bg-stone-800/50 cursor-pointer transition-colors"
                  >
                    <td className="px-4 py-3">
                      <Badge variant={categoryBadgeColor(q.category)}>
                        {q.category}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 font-medium text-white max-w-[140px] truncate">
                      {q.supplierName}
                    </td>
                    <td className="px-4 py-3 font-mono text-[12px] text-violet-400">
                      {q.relatedBillNumber || q.relatedPoNumber || (
                        <span className="text-stone-600 font-sans not-italic">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-stone-400 text-[13px] max-w-[200px] truncate">
                      {q.reason}
                    </td>
                    <td className="px-4 py-3 text-stone-300 text-[13px]">
                      {q.assignedToName}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={statusBadgeColor(q.status)}>
                        {q.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-stone-400 text-[13px] whitespace-nowrap">
                      {fmtDate(q.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-stone-400 text-[13px] whitespace-nowrap">
                      {q.resolvedAt ? (
                        <span className="text-emerald-400">
                          {fmtDate(q.resolvedAt)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* Raise Query Modal */}
      <RaiseQueryModal
        open={raiseOpen}
        onClose={() => setRaiseOpen(false)}
        onSubmit={handleRaiseQuery}
        suppliers={suppliers}
        users={users}
      />

      {/* Detail Drawer */}
      <DetailDrawer
        query={selectedQuery}
        onClose={() => setSelectedQuery(null)}
        onResolve={handleResolve}
      />
    </div>
  );
}
