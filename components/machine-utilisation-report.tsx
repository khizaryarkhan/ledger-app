"use client";

/**
 * Machine utilisation: hours run against hours available, downtime, and — for
 * organisation admins — what running the machine absorbs beside what owning it
 * depreciates.
 *
 * Honesty rules the screen carries through from the server:
 *  - a utilisation figure is withheld, with the reason, unless dated available
 *    hours cover the whole window;
 *  - run hours that were defaulted from the plan are marked, never shown as
 *    measured;
 *  - running cost and depreciation are two columns and are not added together.
 * Colour marks the exception only: unplanned downtime reads amber.
 */

import { useCallback, useEffect, useState } from "react";
import { ListPage, ListPageHeader } from "@/components/list-view";
import { control } from "@/components/form-kit";
import { fmt, localToday } from "@/lib/format";
import { addDays } from "@/lib/accounting/report-periods";

interface Reason { code: string; label: string; count: number; value: number }
interface Machine {
  resourceId: string; name: string;
  workCentre: { id: string; name: string; code: string | null };
  usage: { hours: number; firmHours: number; estimatedHours: number; notRecordedHours: number; runs: number };
  firm: boolean;
  available: { hours: number; days: number; coveredDays: number; complete: boolean };
  utilisation: { pct: number | null; reason: "ok" | "no-hours-on-record" | "partly-on-record" | "no-available-hours" };
  downtime: { plannedMinutes: number; unplannedMinutes: number; reasons: Reason[] };
  cost?: {
    labourRate: number; overheadRate: number;
    runningCost: { labour: number; overhead: number; total: number };
    asset: { id: string; name: string; depreciation: number; netBookValue: number } | null;
  };
}
interface Payload { from: string; to: string; machines: Machine[]; unlinked: { id: string; name: string }[] }

const hrs = (n: number) => String(Math.round(n * 100) / 100);
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

/** What to say in place of a percentage we are not willing to state. */
const WHY: Record<Machine["utilisation"]["reason"], string> = {
  ok: "",
  "no-hours-on-record": "No available hours on record",
  "partly-on-record": "Available hours cover only part of this period",
  "no-available-hours": "No working days in this period",
};

export function MachineUtilisationReport() {
  const [to, setTo] = useState(localToday());
  const [from, setFrom] = useState(addDays(localToday(), -29));
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/resources/machines/report?from=${from}&to=${to}`);
      const body = await r.json().catch(() => null);
      if (!r.ok) { setErr(body?.error || "Could not load the report"); setData(null); return; }
      setData(body);
    } catch { setErr("Network problem. Try again."); setData(null); }
  }, [from, to]);
  useEffect(() => { load(); }, [load]);

  const showCost = !!data?.machines.some((m) => m.cost);
  const notRecorded = data ? data.machines.filter((m) => m.utilisation.pct === null).length : 0;
  const softRuns = data ? data.machines.filter((m) => m.usage.hours > 0 && !m.firm).length : 0;

  return (
    <ListPage>
      <ListPageHeader title="Machine utilisation" subtitle="Hours run against hours available, and what the downtime was.">
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${control} h-8 text-[12px] w-[150px]`} aria-label="From" />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${control} h-8 text-[12px] w-[150px]`} aria-label="To" />
      </ListPageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
        {err && <div className="text-[13px] text-rose-400">{err}</div>}
        {!data && !err && <p className="text-[13px] text-stone-500">Loading…</p>}

        {data && (
          <>
            {notRecorded > 0 && (
              <p className="text-[12px] text-amber-400/90">
                {notRecorded} of {data.machines.length} machines show no utilisation figure because their available hours are not fully on record for this period. Add working hours to the machine to fill them in.
              </p>
            )}
            {softRuns > 0 && (
              <p className="text-[12px] text-stone-500">
                {softRuns} machine{softRuns === 1 ? "" : "s"} include run hours that were defaulted from the plan or recorded before hours were tracked, marked <span className="text-stone-400">est.</span>
              </p>
            )}

            {data.machines.length === 0 ? (
              <div className="rounded-lg border border-stone-800 bg-stone-900 p-8 text-center text-[13px] text-stone-500">
                No machine is linked to a work centre yet. Link one from Equipment to see its usage here.
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-stone-500 border-b border-stone-800">
                    <th className="py-2 pr-2 font-medium">Machine</th>
                    <th className="py-2 pr-2 font-medium text-right">Run</th>
                    <th className="py-2 pr-2 font-medium text-right">Available</th>
                    <th className="py-2 pr-2 font-medium text-right">Utilisation</th>
                    <th className="py-2 pr-2 font-medium text-right">Unplanned</th>
                    <th className="py-2 pr-2 font-medium text-right">Planned</th>
                    {showCost && <th className="py-2 pr-2 font-medium text-right">Running cost</th>}
                    {showCost && <th className="py-2 pr-2 font-medium text-right">Depreciation</th>}
                  </tr>
                </thead>
                <tbody>
                  {data.machines.map((m) => (
                    <tr key={m.resourceId} className="border-b border-stone-900 align-top">
                      <td className="py-2 pr-2 text-stone-200">
                        {m.name}
                        <div className="text-[12px] text-stone-500">{m.workCentre.code ? `${m.workCentre.code} · ` : ""}{m.workCentre.name}</div>
                        {m.downtime.reasons.length > 0 && (
                          <div className="text-[12px] text-stone-500">
                            Top stoppage: {m.downtime.reasons[0].label} ({mins(m.downtime.reasons[0].value)})
                          </div>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums text-stone-300">
                        {hrs(m.usage.hours)} h
                        {m.usage.hours > 0 && !m.firm && (
                          <span className="text-stone-600" title={`Entered ${hrs(m.usage.firmHours)} h · defaulted from plan ${hrs(m.usage.estimatedHours)} h · not recorded ${hrs(m.usage.notRecordedHours)} h`}> ·&nbsp;est.</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums text-stone-400">
                        {m.available.coveredDays === 0 ? <span className="text-stone-600">—</span> : `${hrs(m.available.hours)} h`}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {m.utilisation.pct !== null
                          ? <span className="text-stone-100">{m.utilisation.pct}%</span>
                          : <span className="text-stone-600 text-[12px]" title={WHY[m.utilisation.reason]}>not stated</span>}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {m.downtime.unplannedMinutes > 0 ? <span className="text-amber-400">{mins(m.downtime.unplannedMinutes)}</span> : <span className="text-stone-600">—</span>}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums text-stone-400">
                        {m.downtime.plannedMinutes > 0 ? mins(m.downtime.plannedMinutes) : <span className="text-stone-600">—</span>}
                      </td>
                      {showCost && (
                        <td className="py-2 pr-2 text-right tabular-nums text-stone-300">
                          {fmt.num2(m.cost?.runningCost.total ?? 0)}
                          <div className="text-[12px] text-stone-600">at {fmt.num2((m.cost?.labourRate ?? 0) + (m.cost?.overheadRate ?? 0))}/h</div>
                        </td>
                      )}
                      {showCost && (
                        <td className="py-2 pr-2 text-right tabular-nums text-stone-300">
                          {m.cost?.asset
                            ? <>{fmt.num2(m.cost.asset.depreciation)}<div className="text-[12px] text-stone-600">NBV {fmt.num2(m.cost.asset.netBookValue)}</div></>
                            : <span className="text-stone-600" title="No fixed asset linked">—</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {showCost && data.machines.length > 0 && (
              <p className="text-[12px] text-stone-500">
                Running cost is what production absorbs at the work centre&apos;s rates; depreciation is what the asset costs to own. They are shown apart and not added together.
              </p>
            )}

            {data.unlinked.length > 0 && (
              <p className="text-[12px] text-stone-500">
                Not linked to a work centre, so not shown: {data.unlinked.map((u) => u.name).join(", ")}.
              </p>
            )}
          </>
        )}
      </div>
    </ListPage>
  );
}
