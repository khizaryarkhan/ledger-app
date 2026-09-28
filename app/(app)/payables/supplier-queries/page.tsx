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
  Input,
  Select,
  Modal,
} from "@/components/ui";
import { formatDate } from "@/lib/format";
import { SelectField, control } from "@/components/form-kit";
import {
  useListView, ListPage, ListPageHeader, ListDivider, ListToolbar, ListChips, ListScroll, ListHead,
  listTable, listRow, listCheckCell, listCheckbox, type ListColumn,
} from "@/components/list-view";

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
// Note: this is a small, purpose-built read/act side panel (view + resolve +
// activity feed) predating the shared Drawer sweep — left as-is here since
// this task's scope is the list/table shell, not drawer consolidation.

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
                  {formatDate(query.createdAt)}
                </p>
              </div>
              {query.resolvedAt && (
                <div>
                  <p className="text-xs font-medium text-stone-500 mb-0.5">
                    Resolved
                  </p>
                  <p className="text-sm text-emerald-400">
                    {formatDate(query.resolvedAt)}
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
                        · {formatDate(entry.createdAt)}
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

// ── Period helpers ─────────────────────────────────────────────────────────────

type PeriodId = "this-month" | "last-month" | "last-3m" | "last-6m" | "all" | "custom";

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
  if (id === "this-month") return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: new Date(now.getFullYear(), now.getMonth() + 1, 0) };
  if (id === "last-month") return { from: new Date(now.getFullYear(), now.getMonth() - 1, 1), to: new Date(now.getFullYear(), now.getMonth(), 0) };
  if (id === "last-3m")   return { from: new Date(now.getFullYear(), now.getMonth() - 3, 1), to: now };
  if (id === "last-6m")   return { from: new Date(now.getFullYear(), now.getMonth() - 6, 1), to: now };
  return { from: new Date(2000, 0, 1), to: now };
}

// ── Column definitions — sort + funnel filter per column, board-style ─────────
// Status/Category/Supplier used to be header selects; there is no card view
// here, so (as on invoices/page.tsx) they move to column filters only. The
// created-date range stays a header control for the custom-period logic.
const QUERY_COLS: ListColumn<SupplierQuery>[] = [
  { key: "category",       label: "Category",          sort: r => r.category, filter: { kind: "multi", value: r => r.category } },
  { key: "supplierName",   label: "Supplier",          sort: r => r.supplierName, filter: { kind: "multi", value: r => r.supplierName } },
  { key: "relatedRef",     label: "Related Bill / PO", sort: r => r.relatedBillNumber ?? r.relatedPoNumber ?? "" },
  { key: "reason",         label: "Reason",            sort: r => r.reason },
  { key: "assignedToName", label: "Assigned To",       sort: r => r.assignedToName, filter: { kind: "multi", value: r => r.assignedToName } },
  { key: "status",         label: "Status",            sort: r => r.status, filter: { kind: "multi", value: r => r.status } },
  { key: "createdAt",      label: "Created",           sort: r => r.createdAt },
  { key: "resolvedAt",     label: "Resolved",          sort: r => r.resolvedAt },
];

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function SupplierQueriesPage() {
  const [queries, setQueries] = useState<SupplierQuery[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [selectedQuery, setSelectedQuery] = useState<SupplierQuery | null>(null);
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

  const { from: periodFrom, to: periodTo } = useMemo(() => {
    if (period === "custom") return { from: new Date(customFrom + "T00:00:00"), to: new Date(customTo + "T23:59:59") };
    if (period === "all") return { from: new Date(2000, 0, 1), to: new Date(9999, 11, 31) };
    return getPeriodRange(period);
  }, [period, customFrom, customTo]);

  const filtered = useMemo(() => {
    let rows = queries;

    rows = rows.filter((q) => {
      if (!q.createdAt) return true;
      const d = new Date(q.createdAt);
      return d >= periodFrom && d <= periodTo;
    });

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (q) =>
          q.supplierName.toLowerCase().includes(s) ||
          q.reason.toLowerCase().includes(s) ||
          q.relatedBillNumber?.toLowerCase().includes(s)
      );
    }
    return rows;
  }, [queries, search, periodFrom, periodTo]);

  const lv = useListView(filtered, QUERY_COLS, { storageKey: "payables-supplier-queries", defaultSort: "createdAt", defaultDir: "desc" });

  // Prune the selection when filters hide rows (board rule).
  useEffect(() => {
    const visibleIds = new Set(lv.rows.map((q: any) => q.id));
    setSelected(prev => [...prev].some(id => !visibleIds.has(id)) ? new Set([...prev].filter(id => visibleIds.has(id))) : prev);
  }, [lv.rows]);

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

  const allSelected = lv.rows.length > 0 && lv.rows.every((r: any) => selected.has(r.id));
  const toggleAll = () => { setSelected(allSelected ? new Set() : new Set(lv.rows.map((r: any) => r.id))); };
  const toggleOne = (id: string) => setSelected((prev) => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const pageFiltered = !!search;

  return (
    <ListPage>
      <ListPageHeader title="Supplier Queries"
        subtitle={<>{loading ? "Loading…" : `${lv.rows.length} quer${lv.rows.length !== 1 ? "ies" : "y"}`} · {PERIODS.find((p) => p.id === period)?.label ?? "Custom"}</>}>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search queries…"
            className={`${control} h-8 w-56 pl-7 pr-2 text-xs`} />
        </div>
        <SelectField value={period} onChange={(e) => setPeriod(e.target.value as PeriodId)} aria-label="Created date period" className="w-auto h-8 text-xs">
          {PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
        </SelectField>
        {period === "custom" && (
          <>
            <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)}
              aria-label="From" className={`${control} h-8 w-auto text-xs`} />
            <input type="date" value={customTo} min={customFrom} max={todayStr} onChange={e => setCustomTo(e.target.value)}
              aria-label="To" className={`${control} h-8 w-auto text-xs`} />
          </>
        )}
        <ListDivider />
        <Button icon={Plus} size="sm" onClick={() => setRaiseOpen(true)}>Raise Query</Button>
      </ListPageHeader>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-4 py-3 border-b border-stone-800 shrink-0">
        <StatCard label="Open" value={stats.open} color="text-rose-400" icon={AlertCircle} />
        <StatCard label="Under Review" value={stats.underReview} color="text-amber-400" icon={Clock} />
        <StatCard label="Resolved" value={stats.resolved} color="text-emerald-400" icon={CheckCircle2} />
        <StatCard label="Total" value={stats.total} color="text-stone-300" icon={HelpCircle} />
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-stone-800 bg-rose-500/10 text-rose-400 text-sm shrink-0">
          <AlertCircle size={14} /> {error}
          <button onClick={load} className="ml-auto text-rose-300 hover:text-white underline text-xs">Retry</button>
        </div>
      )}

      <ListToolbar lv={lv} noun="query" plural="queries" filtered={pageFiltered} />
      <ListChips lv={lv} />

      {loading ? (
        <div className="flex-1 overflow-auto p-5 space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="animate-pulse bg-stone-800 rounded h-10 w-full" />)}
        </div>
      ) : (
        <ListScroll lv={lv} empty={queries.length === 0 ? "No supplier queries have been raised yet." : "No queries match the current filters."}>
          <table className={listTable}>
            <ListHead lv={lv} selection={{ all: allSelected, some: selected.size > 0, onToggle: toggleAll }} />
            <tbody>
              {lv.rows.map((q: any) => {
                const isSel = selected.has(q.id);
                return (
                  <tr key={q.id} onClick={() => setSelectedQuery(q)} className={`${listRow(isSel)} cursor-pointer`}>
                    <td className={listCheckCell} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleOne(q.id)} className={listCheckbox} aria-label={`Select query for ${q.supplierName}`} />
                    </td>
                    <td className="px-2 py-2"><Badge variant={categoryBadgeColor(q.category)} size="sm">{q.category}</Badge></td>
                    <td className="px-2 py-2 font-medium text-white text-[13px] max-w-[140px] truncate">{q.supplierName}</td>
                    <td className="px-2 py-2 font-mono text-[12px] text-violet-400">
                      {q.relatedBillNumber || q.relatedPoNumber || <span className="text-stone-600 font-sans not-italic">—</span>}
                    </td>
                    <td className="px-2 py-2 text-stone-400 text-[12px] max-w-[200px] truncate">{q.reason}</td>
                    <td className="px-2 py-2 text-stone-300 text-[12px]">{q.assignedToName}</td>
                    <td className="px-2 py-2"><Badge variant={statusBadgeColor(q.status)} size="sm">{q.status}</Badge></td>
                    <td className="px-2 py-2 text-stone-400 text-[12px] whitespace-nowrap">{formatDate(q.createdAt)}</td>
                    <td className="px-2 py-2 text-stone-400 text-[12px] whitespace-nowrap">
                      {q.resolvedAt ? <span className="text-emerald-400">{formatDate(q.resolvedAt)}</span> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ListScroll>
      )}

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
    </ListPage>
  );
}
