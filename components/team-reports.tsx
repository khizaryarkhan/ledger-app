"use client";

/**
 * Team reports — Project (planned vs logged, who spent it) and Employee
 * (capacity, planned, logged, utilization, week by week). Visibility is decided
 * by the API from the caller's designation; this only draws what comes back and
 * explains a 403. Fetches only /api/resources/me/reports/*, so it also runs in
 * the portal shell. Colour is for exceptions: over-budget projects,
 * over-capacity people, under-logged finished weeks.
 */

import { Fragment, useEffect, useState } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { fmt, localToday } from "@/lib/format";
import { usePeriodFilter, ListPeriodFilter, ListExportButton, exportRowsToExcel } from "@/components/list-chrome";
import { ReportShell, UNDER_LOGGED_RATIO, type ReportShellKind } from "@/components/resource-report-shell";
import { weekEnd } from "@/lib/resources/reports";

type Tab = "project" | "employee";
type Split = { actual: number; pending: number; draft: number };

interface PersonOnProject extends Split {
  resourceId: string; name: string; designation: string | null;
  planned: number; variance: number; percentUsed: number | null; cost?: number;
}
interface ProjectRow extends Split {
  key: string; label: string; code: string | null; assignableType: string;
  planned: number; variance: number; percentUsed: number | null; cost?: number; people: PersonOnProject[];
}
interface EmployeeWeek extends Split { weekStart: string; planned: number; capacity: number }
interface EmployeeRow extends Split {
  resourceId: string; name: string; designation: string | null; department: string | null; managerName: string | null;
  capacity: number; leaveHours: number; planned: number; utilizationPercent: number | null; cost?: number; weeks: EmployeeWeek[];
}

const KIND_LABEL: Record<string, string> = { project: "Project", manufacturing_order: "Manufacturing order", job_work_order: "Job work" };
const th = "py-2 pr-3 font-medium text-[12px] text-stone-400 text-right whitespace-nowrap";
const td = "py-2 pr-3 text-[13px] text-right";
const pill = (active: boolean): string =>
  active
    ? "h-8 px-3 text-[12px] rounded-md ring-1 ring-stone-600 bg-stone-700 text-stone-100"
    : "h-8 px-3 text-[12px] rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-400 hover:text-stone-200";

const pctText = (p: number | null): string => (p === null ? "—" : `${fmt.qty(p)}%`);
const dash = <span className="text-stone-600">—</span>;

type LoadState<T> = { rows: T[]; canSeeCost: boolean } | { error: string; forbidden: boolean } | null;

function useReport<T>(tab: Tab, kind: Tab, from: string, to: string): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>(null);
  useEffect(() => {
    if (tab !== kind) return;
    let live = true;
    setState(null);
    fetch(`/api/resources/me/reports/${kind}?from=${from}&to=${to}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) return { error: (j.error as string) || "Could not load the report.", forbidden: r.status === 403 };
        return { rows: j.rows as T[], canSeeCost: !!j.canSeeCost };
      })
      .then((s) => { if (live) setState(s); })
      .catch(() => { if (live) setState({ error: "Could not load the report.", forbidden: false }); });
    return () => { live = false; };
  }, [tab, kind, from, to]);
  return state;
}

export function TeamReports({ shell = "app" }: { shell?: ReportShellKind }) {
  const [tab, setTab] = useState<Tab>("project");
  const period = usePeriodFilter("this-month");
  const { from, to } = period.range;
  const projects = useReport<ProjectRow>(tab, "project", from, to);
  const employees = useReport<EmployeeRow>(tab, "employee", from, to);
  const state = tab === "project" ? projects : employees;

  async function exportCurrent() {
    if (!state || "error" in state) return;
    if (tab === "project") {
      const flat = (state.rows as ProjectRow[]).flatMap((p) => [
        { project: p.label, kind: KIND_LABEL[p.assignableType] ?? p.assignableType, person: "All people", row: p as Split & { planned: number; variance: number; percentUsed: number | null; cost?: number } },
        ...p.people.map((x) => ({ project: p.label, kind: KIND_LABEL[p.assignableType] ?? p.assignableType, person: x.name, row: x })),
      ]);
      await exportRowsToExcel({
        rows: flat, sheet: "Project hours", filename: `project-hours-${from}-${to}.xlsx`,
        columns: [
          { header: "Project", value: (r) => r.project, width: 30 }, { header: "Type", value: (r) => r.kind, width: 20 },
          { header: "Person", value: (r) => r.person, width: 24 },
          { header: "Planned hours", value: (r) => r.row.planned }, { header: "Logged (approved)", value: (r) => r.row.actual },
          { header: "Pending approval", value: (r) => r.row.pending }, { header: "Draft", value: (r) => r.row.draft },
          { header: "Variance", value: (r) => r.row.variance }, { header: "% used", value: (r) => r.row.percentUsed },
          ...(state.canSeeCost ? [{ header: "Cost", value: (r: { row: { cost?: number } }) => r.row.cost }] : []),
        ],
      });
    } else {
      await exportRowsToExcel({
        rows: state.rows as EmployeeRow[], sheet: "Employee hours", filename: `employee-hours-${from}-${to}.xlsx`,
        columns: [
          { header: "Person", value: (r) => r.name, width: 24 }, { header: "Designation", value: (r) => r.designation, width: 20 },
          { header: "Manager", value: (r) => r.managerName, width: 24 },
          { header: "Capacity hours", value: (r) => r.capacity }, { header: "Planned hours", value: (r) => r.planned },
          { header: "Logged (approved)", value: (r) => r.actual }, { header: "Pending approval", value: (r) => r.pending },
          { header: "Draft", value: (r) => r.draft }, { header: "Utilization %", value: (r) => r.utilizationPercent },
          ...(state.canSeeCost ? [{ header: "Cost", value: (r: EmployeeRow) => r.cost }] : []),
        ],
      });
    }
  }

  const actions = (
    <>
      <button className={pill(tab === "project")} onClick={() => setTab("project")}>Project</button>
      <button className={pill(tab === "employee")} onClick={() => setTab("employee")}>Employee</button>
      {/* The team reports are capped at a year (MAX_SPAN_DAYS), so "All Time" would only ever be refused. */}
      <ListPeriodFilter state={period} label="Period" exclude={["all"]} />
      <ListExportButton onClick={exportCurrent} disabled={!state || "error" in state || state.rows.length === 0} />
    </>
  );

  return (
    <ReportShell shell={shell} title="Team reports" subtitle="Planned against logged hours, by project and by person." actions={actions}>
      {!state && <p className="text-[13px] text-stone-500">Loading…</p>}
      {state && "error" in state && (
        state.forbidden
          ? <p className="text-[13px] text-stone-400">Your designation doesn&apos;t include team reports. Ask an administrator if you need to see your team&apos;s hours.</p>
          : <p className="text-[13px] text-rose-400">{state.error}</p>
      )}
      {state && !("error" in state) && state.rows.length === 0 && (
        <p className="text-[13px] text-stone-500">No hours or plans in this period.</p>
      )}
      {state && !("error" in state) && state.rows.length > 0 && tab === "project" && (
        <ProjectTable rows={state.rows as ProjectRow[]} cost={state.canSeeCost} />
      )}
      {state && !("error" in state) && state.rows.length > 0 && tab === "employee" && (
        <EmployeeTable rows={state.rows as EmployeeRow[]} cost={state.canSeeCost} />
      )}
    </ReportShell>
  );
}

function useExpanded() {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  return { open, toggle };
}

function Chevron({ open }: { open: boolean }) {
  return open ? <ChevronDown size={13} className="text-stone-500" /> : <ChevronRight size={13} className="text-stone-500" />;
}

function ProjectTable({ rows, cost }: { rows: ProjectRow[]; cost: boolean }) {
  const { open, toggle } = useExpanded();
  const over = (planned: number, actual: number): boolean => planned > 0 && actual > planned;
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-stone-800">
            <th className={`${th} text-left`}>Project</th>
            <th className={th}>Planned</th><th className={th}>Logged</th><th className={th}>Pending</th>
            <th className={th}>Variance</th><th className={th}>% used</th>
            {cost && <th className={th}>Cost</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const isOpen = open.has(p.key);
            const bad = over(p.planned, p.actual);
            return (
              <Fragment key={p.key}>
                <tr className="border-b border-stone-900 cursor-pointer hover:bg-stone-900" onClick={() => toggle(p.key)}>
                  <td className={`${td} text-left text-stone-200`}>
                    <span className="inline-flex items-center gap-1.5"><Chevron open={isOpen} />{p.label}
                      <span className="text-[11px] text-stone-500">{KIND_LABEL[p.assignableType] ?? ""}</span></span>
                  </td>
                  <td className={`${td} text-stone-300`}>{fmt.qty(p.planned)}</td>
                  <td className={`${td} text-stone-200`}>{fmt.qty(p.actual)}</td>
                  <td className={`${td} text-stone-400`}>{p.pending > 0 ? fmt.qty(p.pending) : dash}</td>
                  <td className={`${td} ${bad ? "text-rose-400" : "text-stone-300"}`}>{fmt.qty(p.variance)}</td>
                  <td className={`${td} ${bad ? "text-rose-400" : "text-stone-300"}`}>{pctText(p.percentUsed)}</td>
                  {cost && <td className={`${td} text-stone-300`}>{p.cost === undefined ? dash : fmt.num2(p.cost)}</td>}
                </tr>
                {isOpen && p.people.map((x) => {
                  const xbad = over(x.planned, x.actual);
                  return (
                    <tr key={x.resourceId} className="border-b border-stone-900 bg-stone-950">
                      <td className={`${td} text-left text-stone-300 pl-8`}>{x.name}
                        {x.designation && <span className="ml-2 text-[11px] text-stone-500">{x.designation}</span>}</td>
                      <td className={`${td} text-stone-400`}>{fmt.qty(x.planned)}</td>
                      <td className={`${td} text-stone-300`}>{fmt.qty(x.actual)}</td>
                      <td className={`${td} text-stone-500`}>{x.pending > 0 ? fmt.qty(x.pending) : dash}</td>
                      <td className={`${td} ${xbad ? "text-rose-400" : "text-stone-400"}`}>{fmt.qty(x.variance)}</td>
                      <td className={`${td} ${xbad ? "text-rose-400" : "text-stone-400"}`}>{pctText(x.percentUsed)}</td>
                      {cost && <td className={`${td} text-stone-400`}>{x.cost === undefined ? dash : fmt.num2(x.cost)}</td>}
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function EmployeeTable({ rows, cost }: { rows: EmployeeRow[]; cost: boolean }) {
  const { open, toggle } = useExpanded();
  const today = localToday();
  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-stone-800">
            <th className={`${th} text-left`}>Person</th><th className={`${th} text-left`}>Designation</th>
            <th className={`${th} text-left`}>Manager</th>
            <th className={th}>Capacity</th><th className={th}>Planned</th><th className={th}>Logged</th>
            <th className={th}>Pending</th><th className={th}>Draft</th><th className={th}>Utilization</th>
            {cost && <th className={th}>Cost</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const isOpen = open.has(r.resourceId);
            const bad = r.utilizationPercent !== null && r.utilizationPercent > 100;
            return (
              <Fragment key={r.resourceId}>
                <tr className="border-b border-stone-900 cursor-pointer hover:bg-stone-900" onClick={() => toggle(r.resourceId)}>
                  <td className={`${td} text-left text-stone-200`}><span className="inline-flex items-center gap-1.5"><Chevron open={isOpen} />{r.name}</span></td>
                  <td className={`${td} text-left text-stone-400`}>{r.designation ?? dash}</td>
                  <td className={`${td} text-left text-stone-400`}>{r.managerName ?? dash}</td>
                  <td className={`${td} text-stone-300`}>{fmt.qty(r.capacity)}</td>
                  <td className={`${td} text-stone-300`}>{fmt.qty(r.planned)}</td>
                  <td className={`${td} text-stone-200`}>{fmt.qty(r.actual)}</td>
                  <td className={`${td} text-stone-400`}>{r.pending > 0 ? fmt.qty(r.pending) : dash}</td>
                  <td className={`${td} text-stone-500`}>{r.draft > 0 ? fmt.qty(r.draft) : dash}</td>
                  <td className={`${td} ${bad ? "text-rose-400" : "text-stone-300"}`}>{pctText(r.utilizationPercent)}</td>
                  {cost && <td className={`${td} text-stone-300`}>{r.cost === undefined ? dash : fmt.num2(r.cost)}</td>}
                </tr>
                {isOpen && r.weeks.map((w) => {
                  const logged = w.actual + w.pending + w.draft;
                  const finished = weekEnd(w.weekStart) < today;
                  const under = finished && w.capacity > 0 && logged < w.capacity * UNDER_LOGGED_RATIO;
                  return (
                    <tr key={w.weekStart} className="border-b border-stone-900 bg-stone-950">
                      <td className={`${td} text-left text-stone-400 pl-8`} colSpan={3}>Week of {fmt.shortDate(w.weekStart)}</td>
                      <td className={`${td} text-stone-400`}>{fmt.qty(w.capacity)}</td>
                      <td className={`${td} text-stone-400`}>{fmt.qty(w.planned)}</td>
                      <td className={`${td} ${under ? "text-amber-400" : "text-stone-300"}`}>{fmt.qty(w.actual)}</td>
                      <td className={`${td} text-stone-500`}>{w.pending > 0 ? fmt.qty(w.pending) : dash}</td>
                      <td className={`${td} text-stone-500`}>{w.draft > 0 ? fmt.qty(w.draft) : dash}</td>
                      <td className={`${td} ${under ? "text-amber-400" : "text-stone-500"}`}>{under ? "Under-logged" : ""}</td>
                      {cost && <td />}
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
