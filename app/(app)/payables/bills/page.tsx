"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { fmt, formatDate, sourceLabel, sourceBadgeVariant } from "@/lib/format";
import { Search, AlertCircle, X } from "lucide-react";
import { SelectField, control } from "@/components/form-kit";
import {
  useListView, ListPage, ListPageHeader, ListDivider, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, listRow, listCheckCell, listCheckbox, listMoneyCell, type ListColumn,
} from "@/components/list-view";

const WORKFLOW_STATUSES = [
  "Pending Review",
  "Pending Approval",
  "Approved",
  "On Hold",
  "Ready for Payment",
  "Rejected",
];

// ── Date period helpers ────────────────────────────────────────────────────────
type PeriodId = "this-month" | "last-month" | "last-3m" | "last-6m" | "all" | "custom";

const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "this-month", label: "This Month" },
  { id: "last-month", label: "Last Month" },
  { id: "last-3m",    label: "Last 3M"    },
  { id: "last-6m",    label: "Last 6M"    },
  { id: "all",        label: "All Time"   },
  { id: "custom",     label: "Custom"     },
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

// ── Types ─────────────────────────────────────────────────────────────────────
type AccountingStatus = "Unpaid" | "Partially Paid" | "Paid" | "Voided";
type WorkflowStatus =
  | "Synced from Accounting"
  | "Pending Review"
  | "Pending Approval"
  | "Approved"
  | "On Hold"
  | "Ready for Payment"
  | "Rejected"
  | "Scheduled"
  | "Paid";

interface Bill {
  id: string;
  billNumber: string | null;
  supplierId: string | null;
  supplierName: string | null;
  billDate: string | null;
  dueDate: string | null;
  currency: string;
  total: number;
  amountPaid: number;
  balance: number;
  accountingStatus: AccountingStatus;
  workflowStatus: WorkflowStatus;
  qboId: string | null;
  xeroId: string | null;
  source?: string;
  createdAt: string;
}

// ── Badge helpers ─────────────────────────────────────────────────────────────
function accountingBadge(s: AccountingStatus): string {
  const m: Record<AccountingStatus, string> = {
    "Unpaid":         "yellow",
    "Partially Paid": "blue",
    "Paid":           "green",
    "Voided":         "neutral",
  };
  return m[s] ?? "neutral";
}

function workflowBadge(s: WorkflowStatus): string {
  const m: Record<WorkflowStatus, string> = {
    "Synced from Accounting": "neutral",
    "Pending Review":         "yellow",
    "Pending Approval":       "orange",
    "Approved":               "green",
    "On Hold":                "orange",
    "Ready for Payment":      "purple",
    "Rejected":               "red",
    "Scheduled":              "blue",
    "Paid":                   "green",
  };
  return m[s] ?? "neutral";
}

function isOverdue(bill: Bill): boolean {
  if (!bill.dueDate) return false;
  if (bill.balance <= 0) return false;
  if (bill.accountingStatus === "Paid" || bill.accountingStatus === "Voided") return false;
  if (bill.workflowStatus === "Paid" || bill.workflowStatus === "Approved" || bill.workflowStatus === "Ready for Payment") return false;
  return new Date(bill.dueDate + "T00:00:00") < new Date();
}

function daysOverdue(bill: Bill): number {
  if (!isOverdue(bill)) return 0;
  const diff = new Date().getTime() - new Date(bill.dueDate! + "T00:00:00").getTime();
  return Math.floor(diff / 86_400_000);
}

// ── Column definitions — sort + funnel filter per column, board-style ─────────
// Workflow/Accounting status used to be header selects; there is no card view
// here, so (as on invoices/page.tsx) they move to column filters only. Bill
// date keeps its own header period control, same custom-range logic as
// invoices.tsx's invoice-date filter.
const BILL_COLS: ListColumn<any>[] = [
  { key: "billNumber", label: "Bill #",     sort: r => r.billNumber ?? "", filter: { kind: "text", value: r => r.billNumber } },
  { key: "supplier",   label: "Supplier",   sort: r => r.supplierName ?? "", filter: { kind: "multi", value: r => r.supplierName } },
  { key: "billDate",   label: "Bill Date",  sort: r => r.billDate },
  { key: "dueDate",    label: "Due Date",   sort: r => r.dueDate },
  { key: "accounting", label: "Accounting", sort: r => r.accountingStatus, filter: { kind: "multi", value: r => r.accountingStatus } },
  { key: "workflow",   label: "Workflow",   sort: r => r.workflowStatus, filter: { kind: "multi", value: r => r.workflowStatus } },
  { key: "total",      label: "Total",      sort: r => Number(r.total ?? 0), descFirst: true, align: "right",
    money: r => ({ amount: Number(r.total ?? 0), currency: r.currency }) },
  { key: "balance",    label: "Balance",    sort: r => Number(r.balance ?? 0), descFirst: true, align: "right",
    money: r => ({ amount: Number(r.balance ?? 0), currency: r.currency }) },
];

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BillsPage() {
  const router = useRouter();
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkChanging, setBulkChanging] = useState(false);

  const todayStr = new Date().toISOString().slice(0, 10);
  const lastMonthStart = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); })();
  const [period, setPeriod] = useState<PeriodId>("all");
  const [customFrom, setCustomFrom] = useState(lastMonthStart);
  const [customTo, setCustomTo] = useState(todayStr);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/bills");
      if (!res.ok) throw new Error("Failed to load bills");
      const data = await res.json();
      setBills(Array.isArray(data) ? data : data.bills ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleBulkStatusChange(status: string) {
    if (!status || selected.size === 0) return;
    setBulkChanging(true);
    try {
      await Promise.all(
        Array.from(selected).map((id) =>
          fetch(`/api/payables/bills/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ workflowStatus: status }),
          })
        )
      );
      await load();
      setSelected(new Set());
    } catch (err: any) {
      setError(err.message || "Failed to update bills");
    } finally {
      setBulkChanging(false);
    }
  }

  useEffect(() => { load(); }, []);

  const { from: periodFrom, to: periodTo } = useMemo(() => {
    if (period === "custom")
      return { from: new Date(customFrom + "T00:00:00"), to: new Date(customTo + "T23:59:59") };
    if (period === "all")
      return { from: new Date(2000, 0, 1), to: new Date(9999, 11, 31) };
    return getPeriodRange(period);
  }, [period, customFrom, customTo]);

  const enriched = useMemo(() => bills.map(b => ({
    ...b,
    overdue: isOverdue(b),
    daysOvr: daysOverdue(b),
  })), [bills]);

  const filtered = useMemo(() => {
    let rows = enriched;

    // Date filter on billDate
    rows = rows.filter(b => {
      if (!b.billDate) return true;
      const d = new Date(b.billDate + "T00:00:00");
      return d >= periodFrom && d <= periodTo;
    });

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(b =>
        (b.billNumber || "").toLowerCase().includes(s) ||
        (b.supplierName || "").toLowerCase().includes(s)
      );
    }
    return rows;
  }, [enriched, periodFrom, periodTo, search]);

  const lv = useListView(filtered, BILL_COLS, { storageKey: "payables-bills", defaultSort: "dueDate", defaultDir: "asc", summary: "balance" });

  // Prune the selection when filters hide rows (board rule).
  useEffect(() => {
    const visibleIds = new Set(lv.rows.map((b: any) => b.id));
    setSelected(prev => [...prev].some(id => !visibleIds.has(id)) ? new Set([...prev].filter(id => visibleIds.has(id))) : prev);
  }, [lv.rows]);

  const allSelected = lv.rows.length > 0 && lv.rows.every((b: any) => selected.has(b.id));
  const someSelected = selected.size > 0;
  const toggleAll = () => allSelected ? setSelected(new Set()) : setSelected(new Set(lv.rows.map((b: any) => b.id)));
  const toggleOne = (id: string) => setSelected(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const pageFiltered = !!search;

  return (
    <ListPage>
      <ListPageHeader title="Bills"
        subtitle={<>{lv.rows.length} bill{lv.rows.length !== 1 ? "s" : ""} · Bill date: {PERIODS.find(p => p.id === period)?.label ?? "Custom"}</>}>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search bill #, supplier…"
            className={`${control} h-8 w-60 pl-7 pr-2 text-xs`} />
        </div>
        <SelectField value={period} onChange={(e) => setPeriod(e.target.value as PeriodId)} aria-label="Bill date period" className="w-auto h-8 text-xs">
          {PERIODS.map(p => <option key={p.id} value={p.id}>Bill date: {p.label}</option>)}
        </SelectField>
        {period === "custom" && (
          <>
            <input type="date" value={customFrom} max={customTo} onChange={e => setCustomFrom(e.target.value)}
              aria-label="From" className={`${control} h-8 w-auto text-xs`} />
            <input type="date" value={customTo} min={customFrom} max={todayStr} onChange={e => setCustomTo(e.target.value)}
              aria-label="To" className={`${control} h-8 w-auto text-xs`} />
          </>
        )}
      </ListPageHeader>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-stone-800 bg-rose-500/10 text-rose-400 text-sm shrink-0">
          <AlertCircle size={14} />
          {error}
          <button onClick={load} className="ml-auto text-rose-300 hover:text-white underline text-xs">Retry</button>
        </div>
      )}

      {/* Bulk action bar */}
      {someSelected && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-stone-900 text-white border-b border-stone-800 flex-wrap shrink-0">
          <span className="text-[13px] font-medium">{selected.size} selected</span>
          <div className="flex-1" />
          <SelectField value="" disabled={bulkChanging} aria-label="Change status of the selected bills"
            onChange={(e) => { const s = e.target.value; handleBulkStatusChange(s); }}
            className="w-auto min-w-[150px] h-8 text-[12px]">
            <option value="" disabled>{bulkChanging ? "Updating…" : "Change status…"}</option>
            {WORKFLOW_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </SelectField>
          <button onClick={() => setSelected(new Set())} className="text-stone-400 hover:text-white p-1" aria-label="Clear selection"><X size={15} /></button>
        </div>
      )}

      <ListToolbar lv={lv} noun="bill" selected={selected.size} filtered={pageFiltered} />
      <ListChips lv={lv} />

      {loading ? (
        <div className="flex-1 overflow-auto p-5 space-y-2">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-10 bg-stone-800 rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <ListScroll lv={lv} empty={bills.length === 0 ? "Use the Sync button in the top bar (or Settings → Integrations) to import bills." : "No bills match the current filters."}>
          <table className={listTable}>
            <ListHead lv={lv} selection={{ all: allSelected, some: someSelected, onToggle: toggleAll }} />
            <tbody>
              {lv.rows.map((bill: any) => {
                const isSel = selected.has(bill.id);
                return (
                  <tr key={bill.id} onClick={() => router.push(`/payables/bills/${bill.id}`)} className={`${listRow(isSel)} cursor-pointer`}>
                    <td className={listCheckCell} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleOne(bill.id)} className={listCheckbox} aria-label={`Select bill ${bill.billNumber ?? bill.id}`} />
                    </td>
                    <td className="px-2 py-2 font-mono text-[12px] whitespace-nowrap">
                      <span className="inline-flex items-center gap-1.5 text-violet-400">
                        {bill.billNumber || <span className="text-stone-600 italic">No #</span>}
                        <Badge variant={sourceBadgeVariant(bill.source)} size="sm">{sourceLabel(bill.source)}</Badge>
                      </span>
                    </td>
                    <td className="px-2 py-2 font-medium text-white text-[13px] max-w-[180px] truncate" title={bill.supplierName ?? ""}>
                      {bill.supplierName || <span className="text-stone-500 italic">Unknown</span>}
                    </td>
                    <td className="px-2 py-2 text-stone-400 text-[12px] whitespace-nowrap">
                      {bill.billDate ? formatDate(bill.billDate, "DD MMM YYYY") : "—"}
                    </td>
                    <td className="px-2 py-2 text-[12px] whitespace-nowrap">
                      <span className={bill.overdue ? "text-rose-400 font-medium" : "text-stone-300"}>
                        {bill.dueDate ? formatDate(bill.dueDate, "DD MMM YYYY") : "—"}
                      </span>
                      {bill.overdue && bill.daysOvr > 0 && (
                        <span className="ml-1 text-[11px] text-rose-600 font-medium">+{bill.daysOvr}d</span>
                      )}
                    </td>
                    <td className="px-2 py-2"><Badge variant={accountingBadge(bill.accountingStatus)} size="sm">{bill.accountingStatus}</Badge></td>
                    <td className="px-2 py-2"><Badge variant={workflowBadge(bill.workflowStatus)} size="sm">{bill.workflowStatus}</Badge></td>
                    <td className="px-2 py-2 text-right tabular-nums whitespace-nowrap text-stone-400 text-[12px]">{fmt.money(bill.total, bill.currency)}</td>
                    <td className={listMoneyCell}><span className="font-medium text-stone-300 text-[13px]">{fmt.money(bill.balance, bill.currency)}</span></td>
                  </tr>
                );
              })}
            </tbody>
            {lv.rows.length > 0 && <ListFoot lv={lv} noun="bill" selectable />}
          </table>
        </ListScroll>
      )}
    </ListPage>
  );
}
