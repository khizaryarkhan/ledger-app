"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui";
import { fmt, formatDate, sourceLabel, sourceBadgeVariant } from "@/lib/format";
import { AlertCircle } from "lucide-react";
import { SelectField } from "@/components/form-kit";
import { inWindow } from "@/lib/list-period";
import {
  ListSearch, ListPeriodFilter, ListSelectionBar, ListExportButton, usePeriodFilter, useRowSelection,
  exportRowsToExcel, type ExportColumn,
} from "@/components/list-chrome";
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

const BILL_EXPORT: ExportColumn<any>[] = [
  { header: "Bill #", value: (b) => b.billNumber, width: 16 },
  { header: "Supplier", value: (b) => b.supplierName, width: 28 },
  { header: "Bill Date", value: (b) => b.billDate, width: 12 },
  { header: "Due Date", value: (b) => b.dueDate, width: 12 },
  { header: "Accounting", value: (b) => b.accountingStatus, width: 14 },
  { header: "Workflow", value: (b) => b.workflowStatus, width: 18 },
  { header: "Currency", value: (b) => b.currency, width: 9 },
  { header: "Total", value: (b) => Number(b.total ?? 0), width: 14 },
  { header: "Paid", value: (b) => Number(b.amountPaid ?? 0), width: 14 },
  { header: "Balance", value: (b) => Number(b.balance ?? 0), width: 14 },
];

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function BillsPage() {
  const router = useRouter();
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [bulkChanging, setBulkChanging] = useState(false);

  const period = usePeriodFilter("all");

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
    if (!status || count === 0) return;
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
      clearSelection();
    } catch (err: any) {
      setError(err.message || "Failed to update bills");
    } finally {
      setBulkChanging(false);
    }
  }

  useEffect(() => { load(); }, []);

  const enriched = useMemo(() => bills.map(b => ({
    ...b,
    overdue: isOverdue(b),
    daysOvr: daysOverdue(b),
  })), [bills]);

  const filtered = useMemo(() => {
    let rows = enriched;

    // Date filter on billDate
    rows = rows.filter(b => inWindow(b.billDate, period.range));

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(b =>
        (b.billNumber || "").toLowerCase().includes(s) ||
        (b.supplierName || "").toLowerCase().includes(s)
      );
    }
    return rows;
  }, [enriched, period.range, search]);

  const lv = useListView(filtered, BILL_COLS, { storageKey: "payables-bills", defaultSort: "dueDate", defaultDir: "asc", summary: "balance" });

  const { selected, count, isSelected, toggleOne, clear: clearSelection, selection } = useRowSelection<any>(lv.rows);
  const someSelected = count > 0;

  const pageFiltered = !!search;

  return (
    <ListPage>
      <ListPageHeader title="Bills"
        subtitle={<>{lv.rows.length} bill{lv.rows.length !== 1 ? "s" : ""} · Bill date: {period.label}</>}>
        <ListSearch value={search} onChange={setSearch} placeholder="Search bill #, supplier…" />
        <ListPeriodFilter state={period} label="Bill date" capAtToday />
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
        <ListSelectionBar summary={`${count} selected`} onClear={clearSelection}>
          <SelectField value="" disabled={bulkChanging} aria-label="Change status of the selected bills"
            onChange={(e) => { const s = e.target.value; handleBulkStatusChange(s); }}
            className="w-auto min-w-[150px] h-8 text-[12px]">
            <option value="" disabled>{bulkChanging ? "Updating…" : "Change status…"}</option>
            {WORKFLOW_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </SelectField>
        </ListSelectionBar>
      )}

      <ListToolbar lv={lv} noun="bill" selected={count} filtered={pageFiltered}>
        <ListExportButton onClick={() => exportRowsToExcel({
          rows: someSelected ? lv.rows.filter((b: any) => selected.has(b.id)) : lv.rows,
          columns: BILL_EXPORT, sheet: "Bills", filename: "bills.xlsx",
        })} disabled={lv.rows.length === 0} />
      </ListToolbar>
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
            <ListHead lv={lv} selection={selection} />
            <tbody>
              {lv.rows.map((bill: any) => {
                const isSel = isSelected(bill.id);
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
