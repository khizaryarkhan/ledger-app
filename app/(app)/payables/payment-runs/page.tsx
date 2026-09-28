"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus,
  AlertCircle,
  Loader2,
  RefreshCw,
  Search,
} from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { fmt, formatDate } from "@/lib/format";
import { SelectField, control } from "@/components/form-kit";
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
  if (id === "last-3m")    return { from: new Date(now.getFullYear(), now.getMonth() - 3, 1), to: now };
  if (id === "last-6m")    return { from: new Date(now.getFullYear(), now.getMonth() - 6, 1), to: now };
  return { from: new Date(2000, 0, 1), to: now };
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function PaymentRunsPage() {
  const router = useRouter();
  const [runs, setRuns] = useState<PaymentRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
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

  const { from: periodFrom, to: periodTo } = useMemo(() => {
    if (period === "custom") return { from: new Date(customFrom + "T00:00:00"), to: new Date(customTo + "T23:59:59") };
    if (period === "all") return { from: new Date(2000, 0, 1), to: new Date(9999, 11, 31) };
    return getPeriodRange(period);
  }, [period, customFrom, customTo]);

  const baseFiltered = useMemo(() => {
    let rows = runs;

    rows = rows.filter((r) => {
      if (!r.scheduledDate) return true;
      const d = new Date(r.scheduledDate + "T00:00:00");
      return d >= periodFrom && d <= periodTo;
    });

    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(
        (r) =>
          r.runNumber.toLowerCase().includes(s) ||
          r.createdByName.toLowerCase().includes(s)
      );
    }
    return rows;
  }, [runs, search, periodFrom, periodTo]);

  const lv = useListView(baseFiltered, RUN_COLS, { storageKey: "payables-payment-runs", defaultSort: "createdAt", defaultDir: "desc", summary: "totalAmount" });

  // Prune the selection when filters hide rows (board rule).
  useEffect(() => {
    const visibleIds = new Set(lv.rows.map((r: any) => r.id));
    setSelected(prev => [...prev].some(id => !visibleIds.has(id)) ? new Set([...prev].filter(id => visibleIds.has(id))) : prev);
  }, [lv.rows]);

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
      <ListPageHeader title="Payment Runs"
        subtitle={<>{loading ? "Loading…" : `${lv.rows.length} run${lv.rows.length !== 1 ? "s" : ""}`} · {PERIODS.find((p) => p.id === period)?.label ?? "Custom"}</>}>
        <div className="relative">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search run # or creator…"
            className={`${control} h-8 w-60 pl-7 pr-2 text-xs`} />
        </div>
        <SelectField value={period} onChange={(e) => setPeriod(e.target.value as PeriodId)} aria-label="Scheduled date period" className="w-auto h-8 text-xs">
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

      <ListToolbar lv={lv} noun="run" plural="runs" filtered={pageFiltered} />
      <ListChips lv={lv} />

      {loading ? (
        <div className="flex-1 overflow-auto p-5 space-y-2">
          {[...Array(6)].map((_, i) => <div key={i} className="animate-pulse bg-stone-800 rounded h-10 w-full" />)}
        </div>
      ) : (
        <ListScroll lv={lv} empty={runs.length === 0 ? "Create a payment run to batch bill payments." : "No payment runs match the current filters."}>
          <table className={listTable}>
            <ListHead lv={lv} selection={{ all: allSelected, some: selected.size > 0, onToggle: toggleAll }} />
            <tbody>
              {lv.rows.map((run: any) => {
                const isSel = selected.has(run.id);
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
