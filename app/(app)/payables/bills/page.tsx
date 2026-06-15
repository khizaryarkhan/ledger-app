"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  AlertCircle,
  X,
  RefreshCw,
  Receipt,
  Loader2,
} from "lucide-react";
import { Card, Badge, Button, Input, Select, EmptyState } from "@/components/ui";

// ── Types ─────────────────────────────────────────────────────────────────────

type BillAccountingStatus =
  | "Draft"
  | "Submitted"
  | "Authorised"
  | "Paid"
  | "Voided";

type BillWorkflowStatus =
  | "Pending Review"
  | "Pending Approval"
  | "Approved"
  | "On Hold"
  | "Ready for Payment"
  | "Rejected";

interface Bill {
  id: string;
  billNumber: string;
  supplierName: string;
  supplierId: string;
  billDate: string;
  dueDate: string;
  total: number;
  balance: number;
  currency: string;
  accountingStatus: BillAccountingStatus;
  workflowStatus: BillWorkflowStatus;
  assignedApproverName?: string;
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

function isOverdue(dueDate?: string, workflowStatus?: BillWorkflowStatus): boolean {
  if (!dueDate) return false;
  if (workflowStatus === "Approved" || workflowStatus === "Ready for Payment") return false;
  return new Date(dueDate) < new Date();
}

function accountingStatusBadge(status: BillAccountingStatus): string {
  const map: Record<BillAccountingStatus, string> = {
    Draft: "neutral",
    Submitted: "blue",
    Authorised: "green",
    Paid: "green",
    Voided: "neutral",
  };
  return map[status] ?? "neutral";
}

function workflowStatusBadge(status: BillWorkflowStatus): string {
  const map: Record<BillWorkflowStatus, string> = {
    "Pending Review": "yellow",
    "Pending Approval": "orange",
    Approved: "green",
    "On Hold": "orange",
    "Ready for Payment": "purple",
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

// ── Main Page ─────────────────────────────────────────────────────────────────

const WORKFLOW_OPTIONS: BillWorkflowStatus[] = [
  "Pending Review",
  "Pending Approval",
  "Approved",
  "On Hold",
  "Ready for Payment",
  "Rejected",
];

export default function BillsPage() {
  const router = useRouter();
  const [bills, setBills] = useState<Bill[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [workflowFilter, setWorkflowFilter] = useState("");
  const [supplierFilter, setSupplierFilter] = useState("");
  const [dueDateFrom, setDueDateFrom] = useState("");
  const [dueDateTo, setDueDateTo] = useState("");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [billsRes, supRes] = await Promise.all([
        fetch("/api/payables/bills"),
        fetch("/api/payables/suppliers"),
      ]);
      if (!billsRes.ok) throw new Error("Failed to load bills");
      const billsData = await billsRes.json();
      setBills(Array.isArray(billsData) ? billsData : billsData.bills ?? []);
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

  async function handleSync() {
    setSyncing(true);
    try {
      const res = await fetch("/api/payables/bills/sync", { method: "POST" });
      if (!res.ok) throw new Error("Sync failed");
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSyncing(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let rows = bills;
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (b) =>
          b.billNumber.toLowerCase().includes(s) ||
          b.supplierName.toLowerCase().includes(s)
      );
    }
    if (workflowFilter) rows = rows.filter((b) => b.workflowStatus === workflowFilter);
    if (supplierFilter) rows = rows.filter((b) => b.supplierId === supplierFilter);
    if (dueDateFrom) rows = rows.filter((b) => b.dueDate >= dueDateFrom);
    if (dueDateTo) rows = rows.filter((b) => b.dueDate <= dueDateTo);
    return rows;
  }, [bills, search, workflowFilter, supplierFilter, dueDateFrom, dueDateTo]);

  const stats = useMemo(() => ({
    pendingReview: bills.filter((b) => b.workflowStatus === "Pending Review").length,
    pendingApproval: bills.filter((b) => b.workflowStatus === "Pending Approval").length,
    approved: bills.filter((b) => b.workflowStatus === "Approved").length,
    onHold: bills.filter((b) => b.workflowStatus === "On Hold").length,
    readyForPayment: bills.filter((b) => b.workflowStatus === "Ready for Payment").length,
    overdue: bills.filter((b) => isOverdue(b.dueDate, b.workflowStatus)).length,
  }), [bills]);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Bills</h1>
          <p className="text-sm text-stone-500 mt-1">
            {loading ? "Loading…" : `${filtered.length} bill${filtered.length !== 1 ? "s" : ""}`}
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing || loading}
          className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-stone-800 hover:bg-stone-700 text-stone-200 ring-1 ring-stone-700 transition-colors disabled:opacity-50"
        >
          {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          Sync from Accounting
        </button>
      </div>

      {/* Stats Row */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <StatCard label="Pending Review" value={stats.pendingReview} color="text-amber-400" />
        <StatCard label="Pending Approval" value={stats.pendingApproval} color="text-orange-400" />
        <StatCard label="Approved" value={stats.approved} color="text-emerald-400" />
        <StatCard label="On Hold" value={stats.onHold} color="text-orange-400" />
        <StatCard label="Ready for Payment" value={stats.readyForPayment} color="text-violet-400" />
        <StatCard label="Overdue" value={stats.overdue} color="text-rose-400" />
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
            placeholder="Search bill # or supplier…"
            icon={Search}
            className="w-64"
          />
          <Select
            value={workflowFilter}
            onChange={(e: any) => setWorkflowFilter(e.target.value)}
            placeholder="All workflow statuses"
            options={WORKFLOW_OPTIONS}
          />
          <Select
            value={supplierFilter}
            onChange={(e: any) => setSupplierFilter(e.target.value)}
            placeholder="All suppliers"
            options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
          />
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-stone-500">Due</span>
            <input
              type="date"
              value={dueDateFrom}
              onChange={(e) => setDueDateFrom(e.target.value)}
              className="h-9 px-2 text-xs rounded-md border border-stone-700 bg-stone-800/60 text-stone-300 focus:border-violet-500 focus:outline-none"
            />
            <span className="text-xs text-stone-500">to</span>
            <input
              type="date"
              value={dueDateTo}
              onChange={(e) => setDueDateTo(e.target.value)}
              className="h-9 px-2 text-xs rounded-md border border-stone-700 bg-stone-800/60 text-stone-300 focus:border-violet-500 focus:outline-none"
            />
          </div>
          {(search || workflowFilter || supplierFilter || dueDateFrom || dueDateTo) && (
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              onClick={() => { setSearch(""); setWorkflowFilter(""); setSupplierFilter(""); setDueDateFrom(""); setDueDateTo(""); }}
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
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Bill #</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Supplier</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Bill Date</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Due Date</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Total</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-stone-400 uppercase tracking-wide">Balance</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Accounting</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Workflow</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-stone-400 uppercase tracking-wide">Approver</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((bill) => {
                  const overdue = isOverdue(bill.dueDate, bill.workflowStatus);
                  return (
                    <tr
                      key={bill.id}
                      onClick={() => router.push(`/payables/bills/${bill.id}`)}
                      className="border-b border-stone-800 hover:bg-stone-800/50 cursor-pointer transition-colors"
                    >
                      <td className="px-4 py-3 font-mono text-[12px] text-violet-400">{bill.billNumber}</td>
                      <td className="px-4 py-3 font-medium text-white max-w-[160px] truncate">{bill.supplierName}</td>
                      <td className="px-4 py-3 text-stone-400 text-[13px] whitespace-nowrap">{fmtDate(bill.billDate)}</td>
                      <td className={`px-4 py-3 text-[13px] whitespace-nowrap font-medium ${overdue ? "text-rose-400" : "text-stone-300"}`}>
                        {fmtDate(bill.dueDate)}
                        {overdue && <span className="ml-1 text-[10px] text-rose-500 font-semibold">OVERDUE</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-stone-300 tabular-nums text-[13px]">{fmtMoney(bill.total, bill.currency)}</td>
                      <td className="px-4 py-3 text-right font-semibold text-white tabular-nums text-[13px]">{fmtMoney(bill.balance, bill.currency)}</td>
                      <td className="px-4 py-3"><Badge variant={accountingStatusBadge(bill.accountingStatus)}>{bill.accountingStatus}</Badge></td>
                      <td className="px-4 py-3"><Badge variant={workflowStatusBadge(bill.workflowStatus)}>{bill.workflowStatus}</Badge></td>
                      <td className="px-4 py-3 text-stone-400 text-[13px]">{bill.assignedApproverName || <span className="text-stone-600 italic">Unassigned</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {!loading && filtered.length === 0 && (
            <EmptyState
              icon={Receipt}
              title="No bills found"
              description={
                bills.length === 0
                  ? "Sync from your accounting system to import bills."
                  : "Try adjusting your filters."
              }
              action={
                bills.length === 0 ? (
                  <button
                    onClick={handleSync}
                    disabled={syncing}
                    className="inline-flex items-center gap-2 h-9 px-3.5 text-sm font-medium rounded-md bg-stone-800 hover:bg-stone-700 text-stone-200 ring-1 ring-stone-700 transition-colors disabled:opacity-50"
                  >
                    {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                    Sync from Accounting
                  </button>
                ) : undefined
              }
            />
          )}
        </div>
      </Card>
    </div>
  );
}
