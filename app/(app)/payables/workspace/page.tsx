"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Search,
  AlertCircle,
  RefreshCw,
  MessageCircle,
  Calendar,
  Columns,
} from "lucide-react";
import { Badge, Input } from "@/components/ui";

// ── Types ────────────────────────────────────────────────────────────────────

type WorkflowStatus =
  | "Synced"
  | "PendingReview"
  | "PendingApproval"
  | "Approved"
  | "OnHold"
  | "ReadyForPayment";

interface Bill {
  id: string;
  supplierName: string;
  billNumber: string;
  dueDate: string;
  amount: number;
  currency: string;
  workflowStatus: WorkflowStatus;
  assignedTo?: string;
  hasOpenQuery?: boolean;
}

// ── Column config ─────────────────────────────────────────────────────────────

interface ColumnDef {
  id: WorkflowStatus;
  label: string;
  headerColor: string;
  badgeClass: string;
}

const COLUMNS: ColumnDef[] = [
  {
    id: "Synced",
    label: "Synced from Accounting",
    headerColor: "border-t-stone-500",
    badgeClass: "bg-stone-700 text-stone-300",
  },
  {
    id: "PendingReview",
    label: "Pending Review",
    headerColor: "border-t-blue-500",
    badgeClass: "bg-blue-500/15 text-blue-400",
  },
  {
    id: "PendingApproval",
    label: "Pending Approval",
    headerColor: "border-t-amber-500",
    badgeClass: "bg-amber-500/15 text-amber-400",
  },
  {
    id: "Approved",
    label: "Approved",
    headerColor: "border-t-emerald-500",
    badgeClass: "bg-emerald-500/15 text-emerald-400",
  },
  {
    id: "OnHold",
    label: "On Hold",
    headerColor: "border-t-orange-500",
    badgeClass: "bg-orange-500/15 text-orange-400",
  },
  {
    id: "ReadyForPayment",
    label: "Ready for Payment",
    headerColor: "border-t-violet-500",
    badgeClass: "bg-violet-500/15 text-violet-400",
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMoney(amount: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

function fmtDate(dateStr?: string) {
  if (!dateStr) return "—";
  return new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function isOverdue(dateStr?: string) {
  if (!dateStr) return false;
  return new Date(dateStr + "T00:00:00") < new Date();
}

function daysOverdue(dateStr?: string) {
  if (!dateStr) return 0;
  const diff = Date.now() - new Date(dateStr + "T00:00:00").getTime();
  return Math.floor(diff / 86400000);
}

// ── Bill Card ─────────────────────────────────────────────────────────────────

function BillCard({ bill }: { bill: Bill }) {
  const overdue = isOverdue(bill.dueDate);
  const days = daysOverdue(bill.dueDate);

  return (
    <div className="bg-stone-900 border border-stone-800 rounded-lg p-3.5 hover:border-stone-700 transition-colors cursor-pointer group">
      {/* Supplier name */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="font-semibold text-sm text-white leading-tight truncate">
          {bill.supplierName}
        </span>
        {bill.hasOpenQuery && (
          <span title="Open supplier query" className="flex-shrink-0">
            <MessageCircle size={13} className="text-rose-400 mt-0.5" />
          </span>
        )}
      </div>

      {/* Bill number */}
      <div className="font-mono text-[11px] text-stone-500 mb-2.5">
        {bill.billNumber}
      </div>

      {/* Due date row */}
      <div className="flex items-center gap-1.5 mb-2.5 text-[11px]">
        <Calendar size={11} className="text-stone-500 flex-shrink-0" />
        <span className={overdue ? "text-rose-400 font-medium" : "text-stone-400"}>
          {fmtDate(bill.dueDate)}
        </span>
        {overdue && days > 0 && (
          <span className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-semibold bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/30">
            +{days}d
          </span>
        )}
      </div>

      {/* Amount */}
      <div className="font-semibold text-white tabular-nums text-sm mb-2.5">
        {fmtMoney(bill.amount, bill.currency)}
      </div>

      {/* Assigned to */}
      {bill.assignedTo && (
        <div className="flex items-center gap-1.5 text-[11px] text-stone-400">
          <div className="w-4 h-4 rounded-full bg-violet-600 flex items-center justify-center flex-shrink-0">
            <span className="text-[9px] text-white font-bold">
              {bill.assignedTo.charAt(0).toUpperCase()}
            </span>
          </div>
          <span className="truncate">{bill.assignedTo}</span>
        </div>
      )}
    </div>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function ColumnSkeleton() {
  return (
    <div className="space-y-2">
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="animate-pulse bg-stone-900 border border-stone-800 rounded-lg p-3.5 space-y-2"
        >
          <div className="h-3.5 bg-stone-800 rounded w-3/4" />
          <div className="h-2.5 bg-stone-800 rounded w-1/3" />
          <div className="h-3 bg-stone-800 rounded w-1/2" />
          <div className="h-4 bg-stone-800 rounded w-2/3" />
        </div>
      ))}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PayablesWorkspacePage() {
  const [bills, setBills] = useState<Bill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState<WorkflowStatus | "">("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/bills");
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      const json = await res.json();
      setBills(Array.isArray(json) ? json : json.bills ?? []);
    } catch (e: any) {
      setError(e.message || "Failed to load bills");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  const filteredBills = useMemo(() => {
    let rows = bills;
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (b) =>
          b.supplierName.toLowerCase().includes(s) ||
          b.billNumber.toLowerCase().includes(s)
      );
    }
    if (filterStatus) {
      rows = rows.filter((b) => b.workflowStatus === filterStatus);
    }
    return rows;
  }, [bills, search, filterStatus]);

  const billsByColumn = useMemo(() => {
    const map: Record<WorkflowStatus, Bill[]> = {
      Synced: [],
      PendingReview: [],
      PendingApproval: [],
      Approved: [],
      OnHold: [],
      ReadyForPayment: [],
    };
    for (const bill of filteredBills) {
      if (map[bill.workflowStatus]) {
        map[bill.workflowStatus].push(bill);
      }
    }
    return map;
  }, [filteredBills]);

  return (
    <div className="p-6 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 shrink-0">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">
            AP Workspace
          </h1>
          <p className="text-sm text-stone-500 mt-1">
            {loading
              ? "Loading…"
              : `${filteredBills.length} bill${filteredBills.length !== 1 ? "s" : ""} across ${COLUMNS.length} stages`}
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="inline-flex items-center gap-1.5 text-sm text-stone-400 hover:text-stone-200 transition-colors disabled:opacity-50 px-3 py-2 rounded-md hover:bg-stone-800"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-2 mb-5 shrink-0">
        <Input
          value={search}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
            setSearch(e.target.value)
          }
          placeholder="Search supplier, bill #…"
          icon={Search}
          className="w-72"
        />
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value as WorkflowStatus | "")}
          className="h-9 px-3 pr-8 text-sm rounded-md border border-stone-700 bg-stone-800/60 text-stone-200 focus:border-violet-500 focus:ring-1 focus:ring-violet-500 focus:outline-none appearance-none"
          style={{
            backgroundImage: `url("data:image/svg+xml;charset=US-ASCII,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2378716c' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
            backgroundRepeat: "no-repeat",
            backgroundPosition: "right 0.5rem center",
            backgroundSize: "12px",
          }}
        >
          <option value="">All stages</option>
          {COLUMNS.map((col) => (
            <option key={col.id} value={col.id}>
              {col.label}
            </option>
          ))}
        </select>
        {(search || filterStatus) && (
          <button
            onClick={() => {
              setSearch("");
              setFilterStatus("");
            }}
            className="text-xs text-stone-400 hover:text-stone-200 px-2.5 py-1.5 rounded-md hover:bg-stone-800 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 shrink-0 flex items-center gap-2 px-4 py-3 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-400 text-sm">
          <AlertCircle size={16} />
          {error}
          <button
            onClick={load}
            className="ml-auto underline hover:no-underline text-rose-300"
          >
            Retry
          </button>
        </div>
      )}

      {/* Empty overall state */}
      {!loading && !error && bills.length === 0 && (
        <div className="flex flex-col items-center justify-center flex-1 text-center py-20">
          <div className="w-12 h-12 rounded-full bg-stone-800 flex items-center justify-center mb-4">
            <Columns size={20} className="text-stone-500" />
          </div>
          <p className="text-sm font-semibold text-white mb-1">No bills yet</p>
          <p className="text-sm text-stone-500">
            Sync your accounting system to see bills here.
          </p>
        </div>
      )}

      {/* Kanban board */}
      {(loading || bills.length > 0) && (
        <div className="flex gap-4 overflow-x-auto pb-4 flex-1 min-h-0">
          {COLUMNS.map((col) => {
            const colBills = billsByColumn[col.id] ?? [];
            return (
              <div
                key={col.id}
                className="flex-shrink-0 w-64 flex flex-col"
              >
                {/* Column header */}
                <div
                  className={`bg-stone-900 border border-stone-800 border-t-2 ${col.headerColor} rounded-lg px-3 py-2.5 mb-2.5 flex items-center justify-between`}
                >
                  <span className="text-xs font-semibold text-stone-200 leading-tight">
                    {col.label}
                  </span>
                  {!loading && (
                    <span
                      className={`inline-flex items-center justify-center min-w-[20px] h-5 rounded-full text-[10px] font-bold px-1.5 ${col.badgeClass}`}
                    >
                      {colBills.length}
                    </span>
                  )}
                </div>

                {/* Column body */}
                <div className="flex flex-col gap-2 overflow-y-auto flex-1">
                  {loading ? (
                    <ColumnSkeleton />
                  ) : colBills.length === 0 ? (
                    <div className="border border-dashed border-stone-800 rounded-lg py-8 text-center text-xs text-stone-600">
                      No bills
                    </div>
                  ) : (
                    colBills.map((bill) => (
                      <BillCard key={bill.id} bill={bill} />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
