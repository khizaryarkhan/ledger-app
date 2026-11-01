"use client";

/**
 * My reports — the caller's own hours: where they went (past weeks), this week
 * day by day against capacity, and what is planned ahead. Fetches only
 * /api/resources/me/report, so it works in the portal shell as well as the app.
 * Colour is for exceptions only: an under-logged week, a day over capacity.
 */

import { useEffect, useState } from "react";
import { fmt, localToday } from "@/lib/format";
import { ReportShell, WEEKDAY_SHORT, UNDER_LOGGED_RATIO, type ReportShellKind } from "@/components/resource-report-shell";

type Split = { actual: number; pending: number; draft: number };
type LoggedRow = { key: string; kind: string; label: string; weeks: Split[]; total: Split };
type Day = { date: string; weekday: number; capacity: number; planned: number; isHoliday: boolean } & Split;
type PlannedRow = { key: string; kind: string; label: string; weeks: number[]; total: number };

interface MyReport {
  resource: { id: string; name: string; dailyCapacity: number; designation: string | null } | null;
  past?: { weeks: string[]; rows: LoggedRow[]; totals: Split[]; capacity: number[]; loggedHours: number };
  thisWeek?: { weekStart: string; days: Day[]; capacity: number; planned: number; logged: Split };
  upcoming?: { weeks: string[]; rows: PlannedRow[]; capacity: number[]; planned: number[] };
}

const total = (s: Split): number => s.actual + s.pending + s.draft;

function HoursCell({ s }: { s: Split }) {
  if (total(s) === 0) return <span className="text-stone-600">—</span>;
  return (
    <div>
      <span className="text-stone-200">{fmt.qty(s.actual)}</span>
      {(s.pending > 0 || s.draft > 0) && (
        <div className="text-[11px] text-stone-500">
          {s.pending > 0 && <>+{fmt.qty(s.pending)} pending</>}
          {s.pending > 0 && s.draft > 0 && " · "}
          {s.draft > 0 && <>{fmt.qty(s.draft)} draft</>}
        </div>
      )}
    </div>
  );
}

const th = "py-2 pr-3 font-medium text-[12px] text-stone-400 text-right whitespace-nowrap";
const td = "py-2 pr-3 text-[13px] text-right align-top";

function Section({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="text-[13px] font-semibold text-stone-100">{title}</h2>
      <p className="text-[12px] text-stone-500 mb-2">{hint}</p>
      {children}
    </section>
  );
}

export function MyReports({ shell = "app" }: { shell?: ReportShellKind }) {
  const [data, setData] = useState<MyReport | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/resources/me/report?today=${localToday()}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "Could not load your report.");
        return j as MyReport;
      })
      .then((j) => { if (live) setData(j); })
      .catch((e: unknown) => { if (live) setErr(e instanceof Error ? e.message : "Could not load your report."); });
    return () => { live = false; };
  }, []);

  const today = localToday();

  return (
    <ReportShell shell={shell} title="My hours" subtitle="Where your hours went, this week, and what is coming up.">
      {err && <p className="text-[13px] text-rose-400">{err}</p>}
      {!err && !data && <p className="text-[13px] text-stone-500">Loading…</p>}
      {data && !data.resource && (
        <p className="text-[13px] text-stone-400">Your login is not linked to a person in Resources, so there are no hours to show yet.</p>
      )}
      {data?.resource && data.past && data.thisWeek && data.upcoming && (
        <>
          <Section title="Where my hours went" hint="Hours by week. Approved and posted time counts; pending and draft are shown underneath.">
            {data.past.rows.length === 0 ? (
              <p className="text-[13px] text-stone-500">No hours logged in these weeks.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-stone-800">
                      <th className={`${th} text-left`}>Project / type</th>
                      {data.past.weeks.map((w) => <th key={w} className={th}>{fmt.shortDate(w)}</th>)}
                      <th className={th}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.past.rows.map((r) => (
                      <tr key={r.key} className="border-b border-stone-900">
                        <td className={`${td} text-left text-stone-200`}>{r.label}</td>
                        {r.weeks.map((s, i) => <td key={data.past!.weeks[i]} className={td}><HoursCell s={s} /></td>)}
                        <td className={td}><HoursCell s={r.total} /></td>
                      </tr>
                    ))}
                    <tr>
                      <td className={`${td} text-left text-stone-400`}>Logged vs capacity</td>
                      {data.past.totals.map((s, i) => {
                        const cap = data.past!.capacity[i];
                        const under = cap > 0 && total(s) < cap * UNDER_LOGGED_RATIO;
                        return (
                          <td key={data.past!.weeks[i]} className={`${td} ${under ? "text-amber-400" : "text-stone-300"}`}>
                            {fmt.qty(total(s))} / {fmt.qty(cap)}
                          </td>
                        );
                      })}
                      <td className={`${td} text-stone-300`}>{fmt.qty(data.past.loggedHours)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section title="This week" hint={`Week of ${fmt.shortDate(data.thisWeek.weekStart)}: ${fmt.qty(total(data.thisWeek.logged))} of ${fmt.qty(data.thisWeek.capacity)} hours logged, ${fmt.qty(data.thisWeek.planned)} planned.`}>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-stone-800">
                    <th className={`${th} text-left`} />
                    {data.thisWeek.days.map((d) => (
                      <th key={d.date} className={th}>{WEEKDAY_SHORT[d.weekday - 1]} {fmt.shortDate(d.date)}{d.date === today ? " (today)" : ""}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-stone-900">
                    <td className={`${td} text-left text-stone-400`}>Capacity</td>
                    {data.thisWeek.days.map((d) => (
                      <td key={d.date} className={`${td} text-stone-300`}>
                        {d.isHoliday ? <span className="text-stone-500">Holiday</span> : d.capacity > 0 ? fmt.qty(d.capacity) : <span className="text-stone-600">—</span>}
                      </td>
                    ))}
                  </tr>
                  <tr className="border-b border-stone-900">
                    <td className={`${td} text-left text-stone-400`}>Planned</td>
                    {data.thisWeek.days.map((d) => <td key={d.date} className={`${td} text-stone-300`}>{d.planned > 0 ? fmt.qty(d.planned) : <span className="text-stone-600">—</span>}</td>)}
                  </tr>
                  <tr>
                    <td className={`${td} text-left text-stone-400`}>Logged</td>
                    {data.thisWeek.days.map((d) => (
                      <td key={d.date} className={`${td} ${total(d) > d.capacity ? "text-rose-400" : "text-stone-200"}`}>
                        <HoursCell s={d} />
                      </td>
                    ))}
                  </tr>
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Coming up" hint="Planned hours per week, from your assignments, against your capacity.">
            {data.upcoming.rows.length === 0 ? (
              <p className="text-[13px] text-stone-500">Nothing is planned for the coming weeks.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-stone-800">
                      <th className={`${th} text-left`}>Project</th>
                      {data.upcoming.weeks.map((w) => <th key={w} className={th}>{fmt.shortDate(w)}</th>)}
                      <th className={th}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.upcoming.rows.map((r) => (
                      <tr key={r.key} className="border-b border-stone-900">
                        <td className={`${td} text-left text-stone-200`}>{r.label}</td>
                        {r.weeks.map((h, i) => <td key={data.upcoming!.weeks[i]} className={`${td} text-stone-300`}>{h > 0 ? fmt.qty(h) : <span className="text-stone-600">—</span>}</td>)}
                        <td className={`${td} text-stone-300`}>{fmt.qty(r.total)}</td>
                      </tr>
                    ))}
                    <tr>
                      <td className={`${td} text-left text-stone-400`}>Planned / capacity</td>
                      {data.upcoming.planned.map((p, i) => {
                        const cap = data.upcoming!.capacity[i];
                        return <td key={data.upcoming!.weeks[i]} className={`${td} ${p > cap ? "text-rose-400" : "text-stone-300"}`}>{fmt.qty(p)} / {fmt.qty(cap)}</td>;
                      })}
                      <td className={td} />
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Section>
        </>
      )}
    </ReportShell>
  );
}
