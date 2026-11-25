"use client";

/**
 * Employee dashboard — one scrolling page: who I am, my last two timesheets,
 * my leave, what needs my attention, what is planned for me, and how the weeks
 * behind went against plan. Data: /api/resources/me/dashboard (the caller's own
 * person only). Works in the app shell and the employee portal (ReportShell).
 * Bars are plain elements, not a chart library: there is none in this app, and
 * a stacked bar is a row of widths.
 */
import { useEffect, useMemo, useState } from "react";
import { useData } from "@/components/data-provider";
import { buildDashboardModel } from "@/lib/reports/builders/resources";
import Link from "next/link";
import { RefreshCw, CheckCircle2, AlertTriangle, Clock, Inbox } from "lucide-react";
import { ReportShell, type ReportShellKind } from "@/components/resource-report-shell";
import { ThisWeekSection, WeeksBehindSection, WeeksAheadSection, type AheadData, type BehindData, type LoggedRow } from "@/components/employee-dashboard-sections";
import { formatDateShort, fmt, localToday } from "@/lib/format";

type Status = "approved" | "submitted" | "returned" | "draft" | "missing";
interface Dash {
  resource: { name: string; designation: string | null; department: string | null; manager: string | null } | null;
  timesheets: { week: string; status: Status }[];
  leave: { name: string; taken: number; remaining: number }[];
  attention: { kind: string; title: string; detail: string; action: string | null }[];
  ahead: AheadData;
  thisWeekLogged?: LoggedRow[];
  behind: BehindData;
}

// Literal classes only — Tailwind cannot see a class built at runtime.
const LOGGED = "bg-sky-500";
const PLANNED = "bg-orange-400";

const STATUS_CHIP: Record<Status, { label: string; cls: string }> = {
  approved:  { label: "Approved", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  submitted: { label: "Awaiting approval", cls: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
  returned:  { label: "Returned", cls: "bg-rose-500/15 text-rose-300 ring-rose-500/30" },
  // A finished week that was never handed in is overdue, whether it is a draft or empty.
  draft:     { label: "Overdue", cls: "bg-rose-500/20 text-rose-300 ring-rose-500/40" },
  missing:   { label: "Overdue", cls: "bg-rose-500/20 text-rose-300 ring-rose-500/40" },
};

const h = (n: number) => `${fmt.num2(n)} h`;
const wk = (d: string) => `w/c ${formatDateShort(d)}`;

function Card({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="rounded-lg ring-1 ring-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/70 shadow-sm">
      <header className="flex items-center gap-3 px-5 py-3.5 border-b border-stone-800">
        <h2 className="text-[13px] font-semibold text-stone-100">{title}</h2>
        <div className="ml-auto">{right}</div>
      </header>
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

const TAG_CLS: Record<string, string> = {
  returned: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  unsubmitted: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  over_plan: "bg-stone-700/60 text-stone-300 ring-stone-600",
};
const TAG_LABEL: Record<string, string> = { returned: "Action", unsubmitted: "Soon", over_plan: "Info" };

export function EmployeeDashboard({ shell }: { shell: ReportShellKind }) {
  const [weeksBack, setWeeksBack] = useState(3);
  const [weeksAhead, setWeeksAhead] = useState(3);
  const [data, setData] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const timesheetHref = shell === "portal" ? "/my-time" : "/resources/my-time";
  const notificationsHref = shell === "portal" ? "/my-time/notifications" : "/resources/notifications";

  const load = () => {
    setErr(null);
    // Send the viewer's own date: the server's fallback is UTC, a day off west of Greenwich.
    fetch(`/api/resources/me/dashboard?weeksBack=${weeksBack}&weeksAhead=${weeksAhead}&today=${localToday()}`)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) { setErr(d?.error || "Could not load your dashboard."); return; }
        setData(d);
      })
      .catch(() => setErr("Network problem. Reload to try again."));
  };
  useEffect(load, [weeksBack, weeksAhead]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = (
    <button onClick={load} title="Refresh" className="h-8 w-8 inline-flex items-center justify-center rounded-md ring-1 ring-stone-700 text-stone-400 hover:text-stone-200">
      <RefreshCw size={13} />
    </button>
  );
  const subtitle = "Your timesheets, leave, what's planned for you and how the last weeks went.";

  // Export / Print of exactly what is on screen. Held back (null) unless the data was fetched for the window now selected.
  let org: { name: string; displayName: string | null } | null = null;
  try { org = useData().orgSettings; } catch { org = null; }
  const exportModel = useMemo(() => {
    if (!data || data.behind.weeksBack !== weeksBack || data.ahead.weeks.length - 1 !== weeksAhead) return null;
    try {
      return buildDashboardModel(data, { entity: org ? (org.displayName || org.name) : "", currency: null, today: localToday() });
    } catch (e) {
      console.error("Could not build the export model", e);
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, weeksBack, weeksAhead, org?.name, org?.displayName]);

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
  const thisWeekLoggedTotal = (data.thisWeekLogged ?? []).reduce((t, x) => t + x.logged, 0);

  return (
    <ReportShell shell={shell} title="Dashboard" subtitle={subtitle} actions={refresh} exportModel={exportModel}>
      <div className="space-y-5 max-w-[1280px]">
        {/* Summary cards stay in view while the page scrolls, as on EDC Pulse. */}
        <div className="sticky top-0 z-10 -mt-1 pt-1 pb-3 bg-stone-950 grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-lg ring-1 ring-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/70 shadow-sm p-4 flex items-center gap-3">
            <div className="w-11 h-11 rounded-full bg-stone-700 flex items-center justify-center text-[13px] font-semibold text-stone-200 shrink-0">{initials}</div>
            <div className="min-w-0">
              <div className="text-[15px] font-semibold text-white truncate">{r.name}</div>
              <div className="text-[12px] text-stone-400 truncate">{r.designation || "—"}</div>
              <div className="text-[11px] text-stone-400 truncate">{[r.department, r.manager ? `Manager: ${r.manager}` : null].filter(Boolean).join(" · ") || "No manager set"}</div>
            </div>
          </div>

          <div className="rounded-lg ring-1 ring-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/70 shadow-sm p-4">
            <div className="text-[13px] font-semibold text-stone-100 mb-2">My timesheet status</div>
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

          <div className="rounded-lg ring-1 ring-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/70 shadow-sm p-4">
            <div className="text-[13px] font-semibold text-stone-100 mb-2">Leave balance</div>
            {data.leave.length === 0 ? (
              <p className="text-[12px] text-stone-400">No leave type tracks a balance yet.</p>
            ) : data.leave.slice(0, 2).map((l) => {
              const total = Math.max(l.taken + Math.max(l.remaining, 0), 0.01);
              return (
                <div key={l.name} className="mb-2 last:mb-0">
                  <div className="flex justify-between gap-2 text-[11px] text-stone-400 mb-1">
                    <span className="truncate">{l.name}</span>
                    <span className="shrink-0"><span className="text-orange-300">Taken {h(l.taken)}</span> · <span className="text-sky-300">Remaining {h(l.remaining)}</span></span>
                  </div>
                  <div className="flex h-2.5 rounded-sm overflow-hidden bg-stone-800">
                    <div className={PLANNED} style={{ width: `${(l.taken / total) * 100}%` }} />
                    <div className={LOGGED} style={{ width: `${(Math.max(l.remaining, 0) / total) * 100}%` }} />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg ring-1 ring-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/70 shadow-sm p-4">
            <div className="text-[13px] font-semibold text-stone-100 mb-2">This week</div>
            <div className="text-[20px] font-semibold text-white tabular-nums">{h(thisWeekLoggedTotal)} <span className="text-[12px] font-normal text-stone-400">logged</span></div>
            <div className="text-[11px] text-stone-400">{h(data.ahead.totals[0] ?? 0)} planned across {data.ahead.rows.filter((x) => (x.weeks[0] ?? 0) > 0).length} booking(s)</div>
            <Link href={timesheetHref} className="mt-2 inline-block text-[12px] text-emerald-400 hover:text-emerald-300">Open my timesheet →</Link>
          </div>
        </div>

        {/* What needs attention */}
        <h2 className="text-[15px] font-semibold text-white">Notifications</h2>
        <Card title="What needs your attention"
          right={<Link href={notificationsHref} className="text-[12px] text-stone-400 hover:text-stone-200">All notifications</Link>}>
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

        <ThisWeekSection ahead={data.ahead} logged={data.thisWeekLogged ?? []} />
        <WeeksBehindSection behind={data.behind} weeksBack={weeksBack} onWeeksBack={setWeeksBack} />
        <WeeksAheadSection ahead={data.ahead} weeksAhead={weeksAhead} onWeeksAhead={setWeeksAhead} />
      </div>
    </ReportShell>
  );
}
