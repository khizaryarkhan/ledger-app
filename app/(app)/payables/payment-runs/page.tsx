"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  AlertCircle,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { fmt, formatDate } from "@/lib/format";
import { inWindow } from "@/lib/list-period";
import {
  ListSearch, ListPeriodFilter, ListExportButton, usePeriodFilter, useRowSelection,
  exportRowsToExcel, type ExportColumn,
} from "@/components/list-chrome";
import {
  useListView, ListPage, ListPageHeader, ListDivider, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, listRow, listCheckCell, listCheckbox, listMoneyCell, listNumCell, type ListColumn,
} from "@/components/list-view";

// ── Types ─────────────────────────────────────────────────────────────────────

type RunStatus =
  | "Draft"
  | "Pending Approval"
  | "Approved"
  | "Scheduled"
  | "Posted"
  | "Cancelled";

interface PaymentRun {
  id: string;
  runNumber: string;
  currency: string;
  scheduledDate: string;
  billCount: number;
  totalAmount: number;
  status: RunStatus;
  createdByName: string;
  approvedByName?: string;
  createdAt: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusBadge(status: RunStatus): string {
  const map: Record<RunStatus, string> = {
    Draft: "neutral",
    "Pending Approval": "orange",
    Approved: "purple",
    Scheduled: "blue",
    Posted: "green",
    Cancelled: "red",
  };
  return map[status];
}

function AmountStatCard({
  label, count, amount, currency, color,
}: {
  label: string; count: number; amount: number; currency: string; color: string;
}) {
  return (
    <div className="bg-stone-900 border border-stone-800 rounded-lg px-4 py-3 flex flex-col gap-1 min-w-[160px]">
      <span className={`text-xl font-bold tabular-nums ${color}`}>{count}</span>
      <span className="text-[11px] text-stone-400 font-medium">{label}</span>
      {amount > 0 && (
        <span className={`text-xs tabular-nums font-medium ${color} opacity-70`}>
          {fmt.money(amount, currency)}
        </span>
      )}
    </div>
  );
}

// ── Column definitions — sort + funnel filter per column, board-style ─────────
// Status used to be a header select; there is no card view here, so (as on
// invoices/page.tsx) it moves to a column filter only. The scheduled-date
// range stays a header control for the same custom-period-logic reason.
const RUN_COLS: ListColumn<PaymentRun>[] = [
  { key: "runNumber",      label: "Run #",         sort: r => r.runNumber },
  { key: "currency",       label: "Currency",       sort: r => r.currency, filter: { kind: "multi", value: r => r.currency } },
  { key: "scheduledDate",  label: "Scheduled Date", sort: r => r.scheduledDate },
  { key: "billCount",      label: "Bills",          sort: r => r.billCount ?? 0, descFirst: true, align: "right", sum: r => r.billCount ?? 0 },
  { key: "totalAmount",    label: "Total Amount",   sort: r => Number(r.totalAmount ?? 0), descFirst: true, align: "right",
    money: r => ({ amount: Number(r.totalAmount ?? 0), currency: r.currency }) },
  { key: "status",         label: "Status",         sort: r => r.status, filter: { kind: "multi", value: r => r.status } },
  { key: "createdByName",  label: "Created By",     sort: r => r.createdByName, filter: { kind: "multi", value: r => r.createdByName } },
  { key: "approvedByName", label: "Approved By",    sort: r => r.approvedByName, filter: { kind: "multi", value: r => r.approvedByName } },
  { key: "createdAt",      label: "Created",        sort: r => r.createdAt },
];

const RUN_EXPORT: ExportColumn<any>[] = [
  { header: "Run #", value: (r) => r.runNumber, width: 14 },
  { header: "Currency", value: (r) => r.currency, width: 9 },
  { header: "Scheduled Date", value: (r) => r.scheduledDate, width: 14 },
  { header: "Bills", value: (r) => r.billCount ?? 0, width: 8 },
  { header: "Total Amount", value: (r) => Number(r.totalAmount ?? 0), width: 14 },
  { header: "Status", value: (r) => r.status, width: 16 },
  { header: "Created By", value: (r) => r.createdByName, width: 20 },
  { header: "Approved By", value: (r) => r.approvedByName, width: 20 },
  { header: "Created", value: (r) => r.createdAt, width: 22 },
];

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PaymentRunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<PaymentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const period = usePeriodFilter("all");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/payment-runs");
      if (!res.ok) throw new Error("Failed to load payment runs");
      const data = await res.json();
      setRuns(Array.isArray(data) ? data : data.runs ?? []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleNewRun() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/payables/payment-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // No currency here — the API resolves the org's own home currency.
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Failed to create payment run");
      const data = await res.json();
      const id = data.id ?? data.run?.id;
      if (id) {
        router.push(`/payables/payment-runs/${id}`);
      } else {
        await load();
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCreating(false);
    }
  }

  const baseFiltered = useMemo(() => {
    let rows = runs;

    rows = rows.filter((r) => inWindow(r.scheduledDate, period.range));

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.runNumber.toLowerCase().includes(s) ||
          r.createdByName.toLowerCase().includes(s)
      );
    }
    return rows;
  }, [runs, search, period.range]);

  const lv = useListView(baseFiltered, RUN_COLS, { storageKey: "payables-payment-runs", defaultSort: "createdAt", defaultDir: "desc", summary: "totalAmount" });

  const { selected, count, isSelected, toggleOne, selection } = useRowSelection<any>(lv.rows);

  const stats = useMemo(() => {
    const defaultCurrency = runs[0]?.currency ?? "USD";
    return {
      draft:           { count: runs.filter((r) => r.status === "Draft").length,            amount: runs.filter((r) => r.status === "Draft").reduce((s, r) => s + r.totalAmount, 0) },
      pendingApproval: { count: runs.filter((r) => r.status === "Pending Approval").length,  amount: runs.filter((r) => r.status === "Pending Approval").reduce((s, r) => s + r.totalAmount, 0) },
      approved:        { count: runs.filter((r) => r.status === "Approved").length,          amount: runs.filter((r) => r.status === "Approved").reduce((s, r) => s + r.totalAmount, 0) },
      posted:          { count: runs.filter((r) => r.status === "Posted").length,            amount: runs.filter((r) => r.status === "Posted").reduce((s, r) => s + r.totalAmount, 0) },
      currency: defaultCurrency,
    };
  }, [runs]);

  const pageFiltered = !!search;

  return (
    <ListPage>
      <ListPageHeader title="Payment Runs"
        subtitle={<>{loading ? "Loading…" : `${lv.rows.length} run${lv.rows.length !== 1 ? "s" : ""}`} · Scheduled date: {period.label}</>}>
        <ListSearch value={search} onChange={setSearch} placeholder="Search run # or creator…" />
        <ListPeriodFilter state={period} label="Scheduled date" capAtToday />
        <ListDivider />
        <Button variant="secondary" size="sm" icon={loading ? Loader2 : RefreshCw} onClick={load} disabled={loading}>Refresh</Button>
        <Button icon={creating ? Loader2 : Plus} size="sm" onClick={handleNewRun} disabled={creating}>New Payment Run</Button>
      </ListPageHeader>

      {/* Stats */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-800 flex-wrap shrink-0">
        <AmountStatCard label="Draft"            count={stats.draft.count}           amount={stats.draft.amount}           currency={stats.currency} color="text-stone-300" />
        <AmountStatCard label="Pending Approval" count={stats.pendingApproval.count} amount={stats.pendingApproval.amount} currency={stats.currency} color="text-orange-400" />
        <AmountStatCard label="Approved"         count={stats.approved.count}        amount={stats.approved.amount}        currency={stats.currency} color="text-violet-400" />
        <AmountStatCard label="Posted"           count={stats.posted.count}          amount={stats.posted.amount}          currency={stats.currency} color="text-emerald-400" />
      </div>

      {error && (
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-stone-800 bg-rose-500/10 text-rose-400 text-sm shrink-0">
          <AlertCircle size={14} /> {error}
          <button onClick={load} className="ml-auto text-rose-300 hover:text-white underline text-xs">Retry</button>
        </div>
      )}

      <ListToolbar lv={lv} noun="run" plural="runs" selected={count} filtered={pageFiltered}>
        <ListExportButton onClick={() => exportRowsToExcel({
          rows: count > 0 ? lv.rows.filter((r: any) => selected.has(r.id)) : lv.rows,
          columns: RUN_EXPORT, sheet: "Payment Runs", filename: "payment-runs.xlsx",
        })} disabled={lv.rows.length === 0} />
      </ListToolbar>
      <ListChips lv={lv} />

      {loading ? (
        <div className="flex-1 overflow-auto p-5 space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="animate-pulse bg-stone-800 rounded h-10 w-full" />)}
        </div>
      ) : (
        <ListScroll lv={lv} empty={runs.length === 0 ? "Create a payment run to batch bill payments." : "No payment runs match the current filters."}>
          <table className={listTable}>
            <ListHead lv={lv} selection={selection} />
            <tbody>
              {lv.rows.map((run: any) => {
                const isSel = isSelected(run.id);
                return (
                  <tr key={run.id} onClick={() => router.push(`/payables/payment-runs/${run.id}`)} className={`${listRow(isSel)} cursor-pointer`}>
                    <td className={listCheckCell} onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" checked={isSel} onChange={() => toggleOne(run.id)} className={listCheckbox} aria-label={`Select run ${run.runNumber}`} />
                    </td>
                    <td className="px-2 py-2 font-mono text-[12px] text-violet-400 whitespace-nowrap">{run.runNumber}</td>
                    <td className="px-2 py-2 text-stone-300 font-medium text-[13px]">{run.currency}</td>
                    <td className="px-2 py-2 text-stone-400 text-[12px] whitespace-nowrap">{formatDate(run.scheduledDate)}</td>
                    <td className={`${listNumCell} text-stone-300`}>{run.billCount}</td>
                    <td className={listMoneyCell}><span className="font-semibold text-white text-[13px]">{fmt.money(run.totalAmount, run.currency)}</span></td>
                    <td className="px-2 py-2"><Badge variant={statusBadge(run.status)} size="sm">{run.status}</Badge></td>
                    <td className="px-2 py-2 text-stone-400 text-[12px]">{run.createdByName}</td>
                    <td className="px-2 py-2 text-stone-400 text-[12px]">{run.approvedByName ?? <span className="text-stone-600 italic">—</span>}</td>
                    <td className="px-2 py-2 text-stone-400 text-[12px] whitespace-nowrap">{formatDate(run.createdAt)}</td>
                  </tr>
                );
              })}
            </tbody>
            {lv.rows.length > 0 && <ListFoot lv={lv} noun="run" plural="runs" selectable />}
          </table>
        </ListScroll>
      )}
    </ListPage>
  );
}
