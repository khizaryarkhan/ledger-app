"use client";

/**
 * Employee dashboard — one scrolling page: who I am, my last two timesheets,
 * my leave, what needs my attention, what is planned for me, and how the weeks
 * behind went against plan. Data: /api/resources/me/dashboard (the caller's own
 * person only). Works in the app shell and the employee portal (ReportShell).
 * Bars are plain elements, not a chart library: there is none in this app, and
 * a stacked bar is a row of widths.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { RefreshCw, CheckCircle2, AlertTriangle, Clock, Inbox } from "lucide-react";
import { ReportShell, type ReportShellKind } from "@/components/resource-report-shell";
import { SelectField, tableHead, th } from "@/components/form-kit";
import { formatDateShort, fmt, localToday } from "@/lib/format";

type Status = "approved" | "submitted" | "returned" | "draft" | "missing";
interface Dash {
  resource: { name: string; designation: string | null; department: string | null; manager: string | null } | null;
  timesheets: { week: string; status: Status }[];
  leave: { name: string; taken: number; remaining: number }[];
  attention: { kind: string; title: string; detail: string; action: string | null }[];
  ahead: { weeks: string[]; rows: { key: string; label: string; weeks: number[]; total: number }[]; totals: number[] };
  behind: { weeksBack: number; weeks: { week: string; planned: number; logged: number }[]; projects: { key: string; label: string; planned: number; logged: number }[] };
}

// Literal classes only — Tailwind cannot see a class built at runtime.
const SERIES = ["bg-sky-500", "bg-orange-400", "bg-emerald-500", "bg-amber-400", "bg-violet-500", "bg-rose-400", "bg-cyan-500", "bg-lime-500"];
const LOGGED = "bg-sky-500";
const PLANNED = "bg-orange-400";

const STATUS_CHIP: Record<Status, { label: string; cls: string }> = {
  approved:  { label: "Approved", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  submitted: { label: "Awaiting approval", cls: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
  returned:  { label: "Returned", cls: "bg-rose-500/15 text-rose-300 ring-rose-500/30" },
  draft:     { label: "Draft", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  missing:   { label: "Not started", cls: "bg-stone-700/60 text-stone-300 ring-stone-600" },
};

const h = (n: number) => `${fmt.num2(n)} h`;
const wk = (d: string) => `w/c ${formatDateShort(d)}`;

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-lg ring-1 ring-stone-800 bg-stone-900">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-stone-800">
        <h2 className="text-[13px] font-semibold text-stone-100">{title}</h2>
        <div className="ml-auto">{right}</div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function Legend({ items }: { items: { label: string; cls: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5 text-[11px] text-stone-400">
          <span className={`w-2.5 h-2.5 rounded-sm ${i.cls}`} />{i.label}
        </span>
      ))}
    </div>
  );
}

/** Two bars per row (logged over planned), scaled to the largest value on the card. */
function PairedBars({ rows }: { rows: { label: string; planned: number; logged: number }[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.planned, r.logged]));
  if (!rows.length) return <p className="text-[12px] text-stone-400">Nothing planned or logged in this window.</p>;
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label} className="grid grid-cols-[minmax(0,170px)_1fr] gap-3 items-center">
          <div className="text-[12px] text-stone-300 truncate" title={r.label}>{r.label}</div>
          <div className="space-y-1">
            {([["logged", r.logged, LOGGED], ["planned", r.planned, PLANNED]] as const).map(([k, v, cls]) => (
              <div key={k} className="flex items-center gap-2">
                <div className="flex-1 h-2.5 rounded-sm bg-stone-800 overflow-hidden">
                  <div className={`h-full ${cls}`} style={{ width: `${(v / max) * 100}%` }} />
                </div>
                <span className="w-16 text-right text-[11px] tabular-nums text-stone-400">{fmt.num2(v)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const TAG_CLS: Record<string, string> = {
  returned: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  unsubmitted: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  over_plan: "bg-stone-700/60 text-stone-300 ring-stone-600",
};
const TAG_LABEL: Record<string, string> = { returned: "Action", unsubmitted: "Due", over_plan: "Info" };

export function EmployeeDashboard({ shell }: { shell: ReportShellKind }) {
  const [weeksBack, setWeeksBack] = useState(3);
  const [data, setData] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const timesheetHref = shell === "portal" ? "/my-time" : "/resources/my-time";

  const load = () => {
    setErr(null);
    // Send the viewer's own date: the server's fallback is UTC, a day off west of Greenwich.
    fetch(`/api/resources/me/dashboard?weeksBack=${weeksBack}&today=${localToday()}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setErr(d?.error || "Could not load your dashboard."); return; }
        setData(d);
      })
      .catch(() => setErr("Network problem. Reload to try again."));
  };
  useEffect(load, [weeksBack]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = (
    <button onClick={load} title="Refresh" className="h-8 w-8 inline-flex items-center justify-center rounded-md ring-1 ring-stone-700 text-stone-400 hover:text-stone-200">
      <RefreshCw size={13} />
    </button>
  );
  const subtitle = "Your timesheets, leave, what's planned for you and how the last weeks went.";

  if (err) return <ReportShell shell={shell} title="Dashboard" subtitle={subtitle} actions={refresh}><p className="text-[13px] text-rose-400">{err}</p></ReportShell>;
  if (!data) return <ReportShell shell={shell} title="Dashboard" subtitle={subtitle}><p className="text-[13px] text-stone-400">Loading…</p></ReportShell>;
  if (!data.resource) {
    return (
      <ReportShell shell={shell} title="Dashboard" subtitle={subtitle}>
        <p className="text-[13px] text-stone-400">Your login is not linked to a person record yet, so there is nothing to show. Ask your administrator.</p>
      </ReportShell>
    );
  }

  const r = data.resource;
  const initials = r.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
  const colorOf = new Map(data.ahead.rows.map((row, i) => [row.key, SERIES[i % SERIES.length]]));
  const aheadMax = Math.max(1, ...data.ahead.totals);

  return (
    <ReportShell shell={shell} title="Dashboard" subtitle={subtitle} actions={refresh}>
      <div className="space-y-5 max-w-[1280px]">
        {/* Summary cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-lg ring-1 ring-stone-800 bg-stone-900 p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-stone-700 flex items-center justify-center text-[13px] font-semibold text-stone-200 shrink-0">{initials}</div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-white truncate">{r.name}</div>
              <div className="text-[12px] text-stone-400 truncate">{r.designation || "—"}</div>
              <div className="text-[11px] text-stone-400 truncate">{[r.department, r.manager ? `Manager: ${r.manager}` : null].filter(Boolean).join(" · ") || "No manager set"}</div>
            </div>
          </div>

          <div className="rounded-lg ring-1 ring-stone-800 bg-stone-900 p-4">
            <div className="text-[13px] font-semibold text-stone-100 mb-2">My timesheets</div>
            <div className="grid grid-cols-2 gap-2">
              {data.timesheets.map((t) => (
                <div key={t.week}>
                  <div className="text-[11px] text-stone-400 mb-1">{wk(t.week)}</div>
                  <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-md ring-1 text-[11px] font-medium ${STATUS_CHIP[t.status].cls}`}>
                    {t.status === "approved" ? <CheckCircle2 size={11} /> : t.status === "returned" ? <AlertTriangle size={11} /> : <Clock size={11} />}
                    {STATUS_CHIP[t.status].label}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg ring-1 ring-stone-800 bg-stone-900 p-4">
            <div className="text-[13px] font-semibold text-stone-100 mb-2">Leave balance</div>
            {data.leave.length === 0 ? (
              <p className="text-[12px] text-stone-400">No leave type tracks a balance yet.</p>
            ) : data.leave.slice(0, 2).map((l) => {
              const total = Math.max(l.taken + Math.max(l.remaining, 0), 0.01);
              return (
                <div key={l.name} className="mb-2 last:mb-0">
                  <div className="flex justify-between gap-2 text-[11px] text-stone-400 mb-1">
                    <span className="truncate">{l.name}</span>
                    <span className="shrink-0"><span className="text-orange-300">Taken {h(l.taken)}</span> · <span className="text-sky-300">Left {h(l.remaining)}</span></span>
                  </div>
                  <div className="flex h-2.5 rounded-sm overflow-hidden bg-stone-800">
                    <div className={PLANNED} style={{ width: `${(l.taken / total) * 100}%` }} />
                    <div className={LOGGED} style={{ width: `${(Math.max(l.remaining, 0) / total) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg ring-1 ring-stone-800 bg-stone-900 p-4">
            <div className="text-[13px] font-semibold text-stone-100 mb-2">This week</div>
            <div className="text-[20px] font-semibold text-white tabular-nums">{h(data.ahead.totals[0] ?? 0)}</div>
            <div className="text-[11px] text-stone-400">planned across {data.ahead.rows.filter((x) => (x.weeks[0] ?? 0) > 0).length} booking(s)</div>
            <Link href={timesheetHref} className="mt-2 inline-block text-[12px] text-emerald-400 hover:text-emerald-300">Open my timesheet →</Link>
          </div>
        </div>

        {/* What needs attention */}
        <Card title="What needs your attention">
          {data.attention.length === 0 ? (
            <div className="flex items-center gap-2 text-[13px] text-stone-400"><Inbox size={15} /> You're all caught up.</div>
          ) : (
            <ul className="divide-y divide-stone-800 -my-2">
              {data.attention.map((a, i) => (
                <li key={i} className="flex items-center gap-3 py-2.5">
                  <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded ring-1 ${TAG_CLS[a.kind] ?? TAG_CLS.over_plan}`}>
                    {TAG_LABEL[a.kind] ?? "Info"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13px] text-stone-100">{a.title}</div>
                    <div className="text-[12px] text-stone-400">{a.detail}</div>
                  </div>
                  {a.action === "timesheet" && (
                    <Link href={timesheetHref} className="shrink-0 h-8 inline-flex items-center px-3 rounded-md ring-1 ring-stone-700 text-[12px] text-stone-200 hover:bg-stone-800">Open timesheet</Link>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Planned ahead */}
        <Card title="Planned project hours — this week and the next three"
          right={data.ahead.rows.length > 0 ? (
            <button onClick={() => setShowTable((v) => !v)} className="h-8 px-3 rounded-md ring-1 ring-stone-700 text-[12px] text-stone-300 hover:text-stone-100">
              {showTable ? "Hide table" : "Show table"}
            </button>
          ) : undefined}>
          {data.ahead.rows.length === 0 ? (
            <p className="text-[12px] text-stone-400">Nothing is planned for you in these weeks yet.</p>
          ) : (
            <>
              <div className="space-y-2.5">
                {data.ahead.weeks.map((w, i) => (
                  <div key={w} className="grid grid-cols-[90px_1fr_60px] items-center gap-3">
                    <div className="text-[12px] text-stone-400">{i === 0 ? "This week" : wk(w)}</div>
                    <div className="flex h-5 rounded-sm overflow-hidden bg-stone-800">
                      {data.ahead.rows.map((row) => (row.weeks[i] ?? 0) > 0 ? (
                        <div key={row.key} className={colorOf.get(row.key)} style={{ width: `${((row.weeks[i] ?? 0) / aheadMax) * 100}%` }}
                          title={`${row.label}: ${h(row.weeks[i] ?? 0)}`} />
                      ) : null)}
                    </div>
                    <div className="text-right text-[12px] tabular-nums text-stone-300">{fmt.num2(data.ahead.totals[i] ?? 0)}</div>
                  </div>
                ))}
              </div>
              <Legend items={data.ahead.rows.map((row) => ({ label: row.label, cls: colorOf.get(row.key)! }))} />
              {showTable && (
                <div className="mt-4 overflow-x-auto">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className={tableHead}>
                        <th className={th}>Booking</th>
                        {data.ahead.weeks.map((w, i) => <th key={w} className={`${th} !text-right`}>{i === 0 ? "This week" : wk(w)}</th>)}
                        <th className={`${th} !text-right`}>Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.ahead.rows.map((row) => (
                        <tr key={row.key} className="border-b border-stone-800/60">
                          <td className="py-2 pr-3 text-stone-200"><span className={`inline-block w-2 h-2 rounded-sm mr-2 ${colorOf.get(row.key)}`} />{row.label}</td>
                          {row.weeks.map((v, i) => <td key={i} className="py-2 px-3 text-right tabular-nums text-stone-300">{fmt.num2(v)}</td>)}
                          <td className="py-2 pl-3 text-right tabular-nums font-semibold text-stone-100">{fmt.num2(row.total)}</td>
                        </tr>
                      ))}
                      <tr>
                        <td className="py-2 pr-3 font-semibold text-stone-100">Planned total</td>
                        {data.ahead.totals.map((v, i) => <td key={i} className="py-2 px-3 text-right tabular-nums font-semibold text-stone-100">{fmt.num2(v)}</td>)}
                        <td className="py-2 pl-3 text-right tabular-nums font-semibold text-white">{fmt.num2(data.ahead.totals.reduce((s, v) => s + v, 0))}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </Card>

        {/* Weeks behind */}
        <div className="flex items-center gap-3">
          <h2 className="text-[15px] font-semibold text-white">How the last weeks went</h2>
          <div className="w-40">
            <SelectField value={String(weeksBack)} onChange={(e) => setWeeksBack(Number(e.target.value))}>
              <option value="3">Last 3 weeks</option>
              <option value="6">Last 6 weeks</option>
              <option value="12">Last 12 weeks</option>
            </SelectField>
          </div>
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 pb-4">
          <Card title="Planned vs logged — per week">
            <PairedBars rows={data.behind.weeks.map((w) => ({ label: wk(w.week), planned: w.planned, logged: w.logged }))} />
            <Legend items={[{ label: "Logged", cls: LOGGED }, { label: "Planned", cls: PLANNED }]} />
          </Card>
          <Card title="Planned vs logged — per project">
            <PairedBars rows={data.behind.projects.map((p) => ({ label: p.label, planned: p.planned, logged: p.logged }))} />
            <Legend items={[{ label: "Logged", cls: LOGGED }, { label: "Planned", cls: PLANNED }]} />
          </Card>
        </div>
      </div>
    </ReportShell>
  );
}
