"use client";

/**
 * Timesheet compliance: who has not handed a week in, and whose handed-in week
 * is still waiting for a decision.
 *
 * Colour marks the exception only — a shortfall reads amber, everything else
 * stays quiet. Dormant people are listed apart rather than chased, and the
 * strength of the "expected" figure is stated rather than assumed.
 */

import { useCallback, useEffect, useState } from "react";
import { ListPage, ListPageHeader } from "@/components/list-view";
import { control, SelectField } from "@/components/form-kit";
import { formatDateShort, localToday } from "@/lib/format";
import { addDays } from "@/lib/accounting/report-periods";

interface Row {
  resourceId: string; name: string; weekStart: string;
  expected: number; submitted: number; awaitingApproval: number; shortBy: number;
  notSubmitted: boolean; notApproved: boolean; capacityOnRecord: boolean;
}
interface DormantRow { resourceId: string; name: string; lastLoggedOn: string | null }
interface Payload { weeks: string[]; rows: Row[]; dormant: DormantRow[]; clear: number }

const hrs = (n: number) => String(Math.round(n * 100) / 100);

export function TimesheetComplianceReport() {
  const [endDate, setEndDate] = useState(localToday());
  const [weeks, setWeeks] = useState("6");
  const [data, setData] = useState<Payload | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const r = await fetch(`/api/resources/compliance?endDate=${endDate}&weeks=${weeks}`);
      const body = await r.json().catch(() => null);
      if (!r.ok) { setErr(body?.error || "Could not load the report"); setData(null); return; }
      setData(body);
    } catch { setErr("Network problem. Try again."); setData(null); }
  }, [endDate, weeks]);
  useEffect(() => { load(); }, [load]);

  const softCount = data ? data.rows.filter((r) => !r.capacityOnRecord).length : 0;

  return (
    <ListPage>
      <ListPageHeader
        title="Timesheet compliance"
        subtitle="Weeks not handed in, and weeks handed in that nobody has decided yet."
      >
        <input
          type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
          className={`${control} h-8 text-[12px] w-[150px]`} aria-label="Week ending"
        />
        <SelectField value={weeks} onChange={(e) => setWeeks(e.target.value)} className="h-8 text-[12px] w-[130px]" aria-label="Weeks">
          <option value="4">Last 4 weeks</option>
          <option value="6">Last 6 weeks</option>
          <option value="12">Last 12 weeks</option>
          <option value="26">Last 26 weeks</option>
        </SelectField>
      </ListPageHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
        {err && <div className="text-[13px] text-rose-400">{err}</div>}
        {!data && !err && <p className="text-[13px] text-stone-500">Loading…</p>}

        {data && (
          <>
            <div className="flex items-center gap-4 flex-wrap text-[13px]">
              <span className="text-stone-300">
                <span className="font-semibold text-stone-100">{data.rows.length}</span> outstanding
                {data.rows.length > 0 && <span className="text-stone-500"> across {new Set(data.rows.map((r) => r.resourceId)).size} people</span>}
              </span>
              <span className="text-stone-500">{data.clear} fully up to date</span>
              {data.dormant.length > 0 && <span className="text-stone-500">{data.dormant.length} not logging time</span>}
            </div>

            {softCount > 0 && (
              // Phase B's rule carried through: say when the bar someone is
              // being measured against rests on an editable column.
              <p className="text-[12px] text-amber-400/90">
                {softCount} of {data.rows.length} rows compare against a resource&apos;s current daily capacity rather than contracted hours on record. Set contracted hours on the person to make these firm.
              </p>
            )}

            {data.rows.length === 0 ? (
              <div className="rounded-lg border border-stone-800 bg-stone-900 p-8 text-center text-[13px] text-stone-500">
                Nothing outstanding for this period.
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-left text-stone-500 border-b border-stone-800">
                    <th className="py-2 pr-2 font-medium">Person</th>
                    <th className="py-2 pr-2 font-medium">Week</th>
                    <th className="py-2 pr-2 font-medium text-right">Expected</th>
                    <th className="py-2 pr-2 font-medium text-right">Handed in</th>
                    <th className="py-2 pr-2 font-medium text-right">Short by</th>
                    <th className="py-2 pr-2 font-medium text-right">Awaiting approval</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={`${r.resourceId}|${r.weekStart}`} className="border-b border-stone-900">
                      <td className="py-2 pr-2 text-stone-200">
                        {r.name}
                        {!r.capacityOnRecord && (
                          <span className="text-stone-600" title="Expected hours come from this person's current daily capacity, not contracted hours on record"> ·&nbsp;est.</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-stone-400 whitespace-nowrap">
                        {formatDateShort(r.weekStart)} – {formatDateShort(addDays(r.weekStart, 6), { year: true })}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums text-stone-400">{hrs(r.expected)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums text-stone-300">{hrs(r.submitted)}</td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {r.notSubmitted ? <span className="text-amber-400">{hrs(r.shortBy)}</span> : <span className="text-stone-600">—</span>}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums">
                        {r.notApproved ? <span className="text-stone-300">{hrs(r.awaitingApproval)}</span> : <span className="text-stone-600">—</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {data.dormant.length > 0 && (
              <div className="rounded-lg border border-stone-800">
                <div className="px-3 py-2.5 border-b border-stone-800 bg-stone-950">
                  <div className="text-[13px] font-semibold text-stone-100">Not logging time</div>
                  <div className="text-[12px] text-stone-500">
                    Nothing but public holidays in the last 8 weeks. Listed here rather than chased every week.
                  </div>
                </div>
                <ul className="divide-y divide-stone-800/60">
                  {data.dormant.map((d) => (
                    <li key={d.resourceId} className="px-3 py-2 text-[13px] flex items-center gap-3">
                      <span className="text-stone-300">{d.name}</span>
                      <div className="flex-1" />
                      <span className="text-[12px] text-stone-500">
                        {d.lastLoggedOn ? `last logged ${formatDateShort(d.lastLoggedOn, { year: true })}` : "never logged any time"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </ListPage>
  );
}
