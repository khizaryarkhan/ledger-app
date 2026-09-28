"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  ShoppingCart,
  AlertCircle,
  CloudUpload,
  Loader2,
} from "lucide-react";
import { Badge, Button, Input, Select, Modal } from "@/components/ui";
import { fmt, formatDate } from "@/lib/format";
import { SelectField, control } from "@/components/form-kit";
import {
  useListView, ListPage, ListPageHeader, ListDivider, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, listRow, listCheckCell, listCheckbox, listNumCell, type ListColumn,
} from "@/components/list-view";

// ── Types ─────────────────────────────────────────────────────────────────────

type POStatus = "Draft" | "Pending Approval" | "Approved" | "Cancelled" | "Closed";
type POApprovalStatus = "Not Required" | "Pending" | "Approved" | "Rejected";
type POPushStatus = "Not Pushed" | "Pending" | "Pushed" | "Failed";
type PeriodId = "this-month" | "last-month" | "last-3m" | "last-6m" | "all" | "custom";

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
  currency?: string | null;
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

function StatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-lg px-4 py-3 flex flex-col gap-1 min-w-[120px]">
      <span className={`text-xl font-bold tabular-nums ${color}`}>{value}</span>
      <span className="text-[11px] text-stone-400 font-medium">{label}</span>
    </div>
  );
}

function PushStatusIcon({ status }: { status: POPushStatus }) {
  if (status === "Pushed")
    return <span title="Pushed to accounting"><CloudUpload size={15} className="text-violet-400" /></span>;
  if (status === "Pending")
    return <span title="Push pending"><CloudUpload size={15} className="text-amber-400 animate-pulse" /></span>;
  if (status === "Failed")
    return <span title="Push failed"><CloudUpload size={15} className="text-rose-400" /></span>;
  return <span title="Not pushed"><CloudUpload size={15} className="text-stone-600" style={{ strokeDasharray: "4 2" }} /></span>;
}

// ── Create PO Modal ───────────────────────────────────────────────────────────

const EMPTY_PO_FORM = {
  supplierId: "",
  supplierSearch: "",
  poDate: new Date().toISOString().slice(0, 10),
  currency: "",
  notes: "",
};

const CURRENCIES = ["USD", "EUR", "GBP", "AUD", "CAD", "NZD", "SGD", "HKD", "JPY", "ZAR"];

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
  const [orgCurrency, setOrgCurrency] = useState("USD");

  useEffect(() => {
    if (!open) return;
    setForm(EMPTY_PO_FORM);
    setError(null);
    fetch("/api/payables/suppliers")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => setSuppliers(Array.isArray(data) ? data : data.suppliers ?? []))
      .catch(() => {});
    // Default to the org's own currency, never a hardcoded literal — a
    // supplier picked below overrides this with its own currency if set.
    fetch("/api/org/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((o) => { if (o?.currency) { setOrgCurrency(o.currency); setForm((prev) => ({ ...prev, currency: prev.currency || o.currency })); } })
      .catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!form.supplierSearch.trim()) { setSupplierResults([]); return; }
    const q = form.supplierSearch.toLowerCase();
    setSupplierResults(suppliers.filter((s) => s.name.toLowerCase().includes(q)).slice(0, 8));
  }, [form.supplierSearch, suppliers]);

  async function handleSubmit() {
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
      title="New Purchase Order"
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving && <Loader2 size={13} className="animate-spin" />}
            Create PO
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        {error && (
          <div className="flex items-center gap-2 p-3 bg-rose-500/10 border border-rose-500/30 rounded-lg text-rose-400 text-sm">
            <AlertCircle size={14} /> {error}
          </div>
        )}

        {/* Supplier combobox */}
        <div className="relative">
          <label className="block text-xs font-medium text-stone-400 mb-1.5">
            Supplier <span className="text-rose-400">*</span>
          </label>
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
                    setForm((prev) => ({ ...prev, supplierId: s.id, supplierSearch: s.name, currency: s.currency || orgCurrency }));
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
              onChange={(e) => setForm((prev) => ({ ...prev, poDate: e.target.value }))}
              className="w-full h-9 px-3 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-stone-400 mb-1.5">Currency</label>
            <Select
              value={form.currency}
              onChange={(e: any) => setForm((prev) => ({ ...prev, currency: e.target.value }))}
              options={CURRENCIES}
              className="w-full"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-stone-400 mb-1.5">Notes</label>
          <textarea
            value={form.notes}
            onChange={(e) => setForm((prev) => ({ ...prev, notes: e.target.value }))}
            rows={2}
            className="w-full px-3 py-2 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-white placeholder-stone-500 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none resize-none"
          />
        </div>
      </div>
    </Modal>
  );
}

// ── Column definitions — sort + funnel filter per column, board-style ─────────
// Status/Supplier used to be header selects; there is no card view here to
// justify keeping them as selects too, so (as on invoices/page.tsx) they move
// to column filters only. The PO-date range stays a header control — it needs
// the same custom period logic invoices.tsx keeps for invoice date.
const PO_COLS: ListColumn<PurchaseOrder>[] = [
  { key: "poNumber",       label: "PO #",      sort: r => r.poNumber },
  { key: "supplierName",   label: "Supplier",  sort: r => r.supplierName, filter: { kind: "multi", value: r => r.supplierName } },
  { key: "poDate",         label: "PO Date",   sort: r => r.poDate },
  { key: "total",          label: "Total",     sort: r => Number(r.total ?? 0), descFirst: true, align: "right",
    money: r => ({ amount: Number(r.total ?? 0), currency: r.currency }) },
  { key: "status",         label: "Status",    sort: r => r.status, filter: { kind: "multi", value: r => r.status } },
  { key: "approvalStatus", label: "Approval",  sort: r => r.approvalStatus, filter: { kind: "multi", value: r => r.approvalStatus } },
  { key: "pushStatus",     label: "Push",      sort: r => r.pushStatus, align: "center", filter: { kind: "multi", value: r => r.pushStatus } },
  { key: "createdAt",      label: "Created",   sort: r => r.createdAt },
];

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PurchaseOrdersPage() {
  const router = useRouter();
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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
      const poRes = await fetch("/api/payables/purchase-orders");
      if (!poRes.ok) throw new Error("Failed to load purchase orders");
      const poData = await poRes.json();
      setOrders(Array.isArray(poData) ? poData : poData.purchaseOrders ?? []);
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
    let rows = orders;

    // Date filter on PO date
    rows = rows.filter((o) => {
      if (!o.poDate) return true;
      const d = new Date(o.poDate + "T00:00:00");
      return d >= periodFrom && d <= periodTo;
    });

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.poNumber.toLowerCase().includes(s) ||
          r.supplierName.toLowerCase().includes(s)
      );
    }
    return rows;
  }, [orders, search, periodFrom, periodTo]);

  const lv = useListView(baseFiltered, PO_COLS, { storageKey: "payables-purchase-orders", defaultSort: "poDate", defaultDir: "desc", summary: "total" });

  // Prune the selection when filters hide rows (board rule).
  useEffect(() => {
    const visibleIds = new Set(lv.rows.map((r: any) => r.id));
    setSelected(prev => [...prev].some(id => !visibleIds.has(id)) ? new Set([...prev].filter(id => visibleIds.has(id))) : prev);
  }, [lv.rows]);

  const stats = useMemo(() => ({
    draft: orders.filter((o) => o.status === "Draft").length,
    pendingApproval: orders.filter((o) => o.status === "Pending Approval").length,
    approved: orders.filter((o) => o.status === "Approved").length,
    pushedToAccounting: orders.filter((o) => o.pushStatus === "Pushed").length,
  }), [orders]);

  const allSelected = lv.rows.length > 0 && lv.rows.every((r: any) => selected.has(r.id));
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set(lv.rows.map((r: any) => r.id)));
  };
  const toggleOne = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const pageFiltered = !!search;

  return (
    <ListPage>
      <ListPageHeader title="Purchase Orders"
        subtitle={<>{loading ? "Loading…" : `${lv.rows.length} order${lv.rows.length !== 1 ? "s" : ""}`} · PO date: {PERIODS.find(p => p.id === period)?.label ?? "Custom"}</>}>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search PO # or supplier…"
            className={`${control} h-8 w-60 pl-7 pr-2 text-xs`} />
        </div>
        <SelectField value={period} onChange={(e) => setPeriod(e.target.value as PeriodId)} aria-label="PO date period" className="w-auto h-8 text-xs">
          {PERIODS.map(p => <option key={p.id} value={p.id}>PO date: {p.label}</option>)}
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
        <Button icon={Plus} size="sm" onClick={() => setShowCreate(true)}>New PO</Button>
      </ListPageHeader>

      {/* Stats Row */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-800 flex-wrap shrink-0">
        <StatCard label="Draft"              value={stats.draft}              color="text-stone-300" />
        <StatCard label="Pending Approval"   value={stats.pendingApproval}    color="text-orange-400" />
        <StatCard label="Approved"           value={stats.approved}           color="text-emerald-400" />
        <StatCard label="Pushed to Accounting" value={stats.pushedToAccounting} color="text-violet-400" />
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-stone-800 bg-rose-500/10 text-rose-400 text-sm shrink-0">
          <AlertCircle size={14} /> {error}
          <button onClick={load} className="ml-auto text-rose-300 hover:text-white underline text-xs">Retry</button>
        </div>
      )}

      <ListToolbar lv={lv} noun="order" plural="orders" filtered={pageFiltered} />
      <ListChips lv={lv} />

      {loading ? (
        <div className="flex-1 overflow-auto p-5 space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="animate-pulse bg-stone-800 rounded h-10 w-full" />)}
        </div>
      ) : (
        <ListScroll lv={lv} empty={orders.length === 0 ? "No purchase orders yet — create one to get started." : "No purchase orders match the current filters."}>
          <table className={listTable}>
            <ListHead lv={lv} selection={{ all: allSelected, some: selected.size > 0, onToggle: toggleAll }} />
            <tbody>
              {lv.rows.map((po: any) => {
                const isSel = selected.has(po.id);
                return (
                  <tr key={po.id} onClick={() => router.push(`/payables/purchase-orders/${po.id}`)} className={`${listRow(isSel)} cursor-pointer`}>
                    <td className={listCheckCell} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleOne(po.id)} className={listCheckbox} aria-label={`Select PO ${po.poNumber}`} />
                    </td>
                    <td className="px-2 py-2 font-mono text-[12px] text-violet-400 whitespace-nowrap">{po.poNumber}</td>
                    <td className="px-2 py-2 font-medium text-white text-[13px]">{po.supplierName}</td>
                    <td className="px-2 py-2 text-stone-400 text-[12px] whitespace-nowrap">{formatDate(po.poDate)}</td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-stone-300 text-[13px] font-semibold border-l border-stone-800">{fmt.money(po.total, po.currency)}</td>
                    <td className="px-2 py-2"><Badge variant={poStatusBadge(po.status)} size="sm">{po.status}</Badge></td>
                    <td className="px-2 py-2"><Badge variant={approvalStatusBadge(po.approvalStatus)} size="sm">{po.approvalStatus}</Badge></td>
                    <td className="px-2 py-2 text-center"><PushStatusIcon status={po.pushStatus} /></td>
                    <td className={`${listNumCell} text-stone-500 text-[12px]`}>{formatDate(po.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
            {lv.rows.length > 0 && <ListFoot lv={lv} noun="order" plural="orders" selectable />}
          </table>
        </ListScroll>
      )}

      <CreatePOModal open={showCreate} onClose={() => setShowCreate(false)} onCreated={load} />
    </ListPage>
  );
}
