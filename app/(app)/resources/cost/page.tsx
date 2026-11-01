"use client";

/**
 * Resource cost report - hours x cost rate from time entries, grouped by
 * project / MO / job work, resource or month. Approved vs posted vs pending
 * are shown apart; hours with no cost rate are counted but never costed at 0
 * silently (amber notice).
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { ListPage, ListPageHeader } from "@/components/list-view";
import { ListPeriodFilter, ListExportButton, exportRowsToExcel, usePeriodFilter } from "@/components/list-chrome";
import { fmt } from "@/lib/format";

type GroupBy = "assignable" | "resource" | "month";
const GROUPS: { id: GroupBy; label: string }[] = [
  { id: "assignable", label: "Project / Order" },
  { id: "resource", label: "Resource" },
  { id: "month", label: "Month" },
];

type Row = {
  key: string; label: string; sublabel: string | null; noRate?: boolean;
  hours: number; approvedHours: number; postedHours: number; pendingHours: number;
  cost: number; approvedCost: number; postedCost: number; pendingCost: number; unratedHours: number; hasUnrated: boolean;
};
type Report = {
  rows: Row[];
  totals: Omit<Row, "key" | "label" | "sublabel" | "noRate">;
  unratedHours: number;
  unratedResources: { id: string; name: string }[];
};

const NUM = "px-2 py-2 text-right tabular-nums whitespace-nowrap";

export default function ResourceCostPage() {
  const period = usePeriodFilter("this-month");
  const [groupBy, setGroupBy] = useState<GroupBy>("assignable");
  const [data, setData] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const { from, to } = period.range;

  useEffect(() => {
    let live = true;
    setData(null); setErr("");
    fetch(`/api/resources/cost-report?from=${from}&to=${to}&groupBy=${groupBy}`)
      .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d?.error || "Failed to load"); return d; })
      .then(d => { if (live) setData(d); })
      .catch(e => { if (live) { setErr(e.message || "Failed to load"); setData({ rows: [], totals: emptyTotals, unratedHours: 0, unratedResources: [] }); } });
    return () => { live = false; };
  }, [from, to, groupBy]);

  const firstCol = groupBy === "assignable" ? "Project / Order" : groupBy === "resource" ? "Resource" : "Month";
  const rows = data?.rows ?? [];
  const totals = data?.totals ?? emptyTotals;

  const exportCols = useMemo(() => [
    { header: firstCol, value: (r: Row) => r.label, width: 36 },
    { header: "Type", value: (r: Row) => r.sublabel ?? "", width: 20 },
    { header: "Hours", value: (r: Row) => r.hours },
    { header: "Approved hours", value: (r: Row) => r.approvedHours },
    { header: "Posted hours", value: (r: Row) => r.postedHours },
    { header: "Pending hours", value: (r: Row) => r.pendingHours },
    { header: "Unrated hours", value: (r: Row) => r.unratedHours },
    { header: "Cost", value: (r: Row) => r.cost },
    { header: "Approved cost", value: (r: Row) => r.approvedCost },
    { header: "Posted cost", value: (r: Row) => r.postedCost },
    { header: "Pending cost", value: (r: Row) => r.pendingCost },
  ], [firstCol]);

  return (
    <ListPage>
      <ListPageHeader title="Resource cost" subtitle="Hours x cost rate from timesheets, in your home currency.">
        <ListPeriodFilter state={period} label="Work date" />
        <div className="flex items-center gap-1" role="group" aria-label="Group by">
          {GROUPS.map(g => (
            <button key={g.id} onClick={() => setGroupBy(g.id)} aria-pressed={groupBy === g.id}
              className={`h-8 px-2.5 text-[12px] rounded-md ring-1 transition-colors ${groupBy === g.id
                ? "ring-stone-600 bg-stone-700 text-stone-100"
                : "ring-stone-700 bg-stone-800 text-stone-400 hover:text-stone-200"}`}>
              {g.label}
            </button>
          ))}
        </div>
        <ListExportButton disabled={!rows.length}
          onClick={() => exportRowsToExcel({ rows, columns: exportCols, sheet: "Resource cost", filename: `resource-cost-${from}-${to}.xlsx` })} />
      </ListPageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {data && data.unratedHours > 0 && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-700/50 bg-amber-950/30 px-3 py-2 text-[13px] text-amber-300">
            <AlertTriangle size={15} className="mt-0.5 flex-shrink-0" />
            <span>
              {data.unratedHours} hours have no cost rate and are not included in the cost totals
              {data.unratedResources.length > 0 && <> ({data.unratedResources.map(r => r.name).join(", ")})</>}.{" "}
              <Link href="/resources/people" className="underline hover:text-amber-200">Set cost rates on People</Link>
            </span>
          </div>
        )}
        {err && <p className="mb-3 text-[13px] text-rose-400">{err}</p>}

        {data === null ? (
          <p className="text-center text-[13px] text-stone-500 py-8">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-center text-[13px] text-stone-500 py-8">No timesheet hours in this period.</p>
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-stone-500 border-b border-stone-800">
                <th className="px-2 py-2 font-medium">{firstCol}</th>
                <th className={`${NUM} font-medium`}>Hours</th>
                <th className={`${NUM} font-medium`}>Approved h</th>
                <th className={`${NUM} font-medium`}>Posted h</th>
                <th className={`${NUM} font-medium`}>Pending h</th>
                <th className={`${NUM} font-medium`}>Approved cost</th>
                <th className={`${NUM} font-medium`}>Posted cost</th>
                <th className={`${NUM} font-medium`}>Pending cost</th>
                <th className={`${NUM} font-medium`}>Total cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.key} className="border-b border-stone-900">
                  <td className="px-2 py-2 text-stone-200">
                    {r.label}
                    {r.sublabel && <span className="ml-2 text-[11px] text-stone-500">{r.sublabel}</span>}
                    {(r.hasUnrated || r.noRate) && <span className="ml-2 text-[11px] text-amber-400">{r.noRate ? "no rate" : `${r.unratedHours}h no rate`}</span>}
                  </td>
                  <td className={`${NUM} text-stone-300`}>{r.hours}</td>
                  <td className={`${NUM} text-stone-400`}>{r.approvedHours}</td>
                  <td className={`${NUM} text-stone-400`}>{r.postedHours}</td>
                  <td className={`${NUM} text-stone-500`}>{r.pendingHours}</td>
                  <td className={`${NUM} text-stone-300`}>{fmt.num2(r.approvedCost)}</td>
                  <td className={`${NUM} text-stone-300`}>{fmt.num2(r.postedCost)}</td>
                  <td className={`${NUM} text-stone-500`}>{fmt.num2(r.pendingCost)}</td>
                  <td className={`${NUM} font-medium text-stone-100`}>{fmt.num2(r.cost)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-stone-700 font-semibold text-stone-100">
                <td className="px-2 py-2">Total</td>
                <td className={NUM}>{totals.hours}</td>
                <td className={NUM}>{totals.approvedHours}</td>
                <td className={NUM}>{totals.postedHours}</td>
                <td className={NUM}>{totals.pendingHours}</td>
                <td className={NUM}>{fmt.num2(totals.approvedCost)}</td>
                <td className={NUM}>{fmt.num2(totals.postedCost)}</td>
                <td className={NUM}>{fmt.num2(totals.pendingCost)}</td>
                <td className={NUM}>{fmt.num2(totals.cost)}</td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </ListPage>
  );
}

const emptyTotals = {
  hours: 0, approvedHours: 0, postedHours: 0, pendingHours: 0,
  cost: 0, approvedCost: 0, postedCost: 0, pendingCost: 0, unratedHours: 0, hasUnrated: false,
};
