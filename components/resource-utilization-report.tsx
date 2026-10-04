"use client";

/**
 * Utilization report — capacity vs planned (resource_assignments, forward-
 * looking) vs actual/billable (time_entries, backward-looking) per resource,
 * for a chosen range. Read-only, derived — same lazy/derived spirit as the
 * Delivery Risk report.
 */

import { useEffect, useState } from "react";
import { localToday } from "@/lib/format";

function startOfMonth(d: string) { return d.slice(0, 7) + "-01"; }

export function ResourceUtilizationReport() {
  const today = localToday();
  const [from, setFrom] = useState(startOfMonth(today));
  const [to, setTo] = useState(today);
  const [rows, setRows] = useState<any[] | null>(null);

  async function load() {
    setRows(await fetch(`/api/resources/utilization?from=${from}&to=${to}`).then(r => r.json()).catch(() => []));
  }
  useEffect(() => { load(); }, [from, to]);

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-[18px] font-semibold text-stone-100">Utilization</h1>
          <p className="text-[13px] text-stone-500">Capacity, planned and actual hours per resource for the chosen range.</p>
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="bg-stone-900 border border-stone-800 rounded-lg px-2.5 py-1.5 text-[13px] text-stone-200" />
          <span className="text-stone-600">–</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="bg-stone-900 border border-stone-800 rounded-lg px-2.5 py-1.5 text-[13px] text-stone-200" />
        </div>
      </div>

      {rows === null ? (
        <p className="text-center text-[13px] text-stone-500 py-8">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="text-center text-[13px] text-stone-500 py-8">No active resources.</p>
      ) : (
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-stone-500 border-b border-stone-800">
              <th className="py-2 pr-2 font-medium">Resource</th>
              <th className="py-2 pr-2 font-medium text-right">Capacity (h)</th>
              <th className="py-2 pr-2 font-medium text-right">Planned</th>
              <th className="py-2 pr-2 font-medium text-right">Actual</th>
              <th className="py-2 pr-2 font-medium text-right">Billable</th>
              <th className="py-2 pr-2 font-medium text-right">Leave (h)</th>
              <th className="py-2 pr-2 font-medium text-right">Utilization</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.resourceId} className="border-b border-stone-900">
                <td className="py-2 pr-2 text-stone-200">{r.name}</td>
                <td className="py-2 pr-2 text-right text-stone-300">{r.capacity}</td>
                <td className="py-2 pr-2 text-right text-stone-400">{r.plannedHours}h ({r.plannedPercent}%)</td>
                <td className="py-2 pr-2 text-right text-stone-300">{r.actualHours}</td>
                <td className="py-2 pr-2 text-right text-stone-300">{r.billableHours}</td>
                <td className="py-2 pr-2 text-right text-stone-500">{r.leaveHours}</td>
                <td className="py-2 pr-2 text-right font-medium text-stone-100">{r.utilizationPercent}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
