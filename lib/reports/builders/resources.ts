/**
 * Export models for the Resources reports: Team reports (Project, Employee) and
 * My hours. PURE — no Date, no clock. Built from the same rows the screen draws.
 *
 * Cost is added ONLY when the caller may see it (`canSeeCost`); the screen hides
 * it from everyone else, and the export must not reveal a pay rate the screen
 * does not. Hours use the "qty" kind (up to 5dp, never padded), as the screens do.
 */
import { fmt } from "../../format";
import { num, type Cell, type ExportColumn, type ExportRow, type ReportExportModel } from "../export-model";
import { WEEKDAY_SHORT, UNDER_LOGGED_RATIO } from "../../resources/report-constants";

export interface Split { actual: number; pending: number; draft: number }

export interface ResourceInfo {
  entity: string;
  currency: string | null;
}

const KIND_LABEL: Record<string, string> = { project: "Project", manufacturing_order: "Manufacturing order", job_work_order: "Job work" };

const hours = (key: string, label: string): ExportColumn => ({ key, label, kind: "qty" });
const text = (key: string, label: string): ExportColumn => ({ key, label, kind: "text" });
const sumSplit = (s: Split): number => s.actual + s.pending + s.draft;

function line(kind: ExportRow["kind"], cells: Cell[], flags?: boolean[], indent?: number): ExportRow {
  const row: ExportRow = { kind, cells };
  if (indent) row.indent = indent;
  if (flags && flags.some(Boolean)) row.flags = flags;
  return row;
}

const overPlan = (planned: number, actual: number): boolean => planned > 0 && actual > planned;

// ───────────────────────── Team: by project ─────────────────────────

export interface ProjectPersonIn extends Split {
  name: string; designation: string | null; planned: number; variance: number; percentUsed: number | null; cost?: number;
}
export interface ProjectIn extends Split {
  label: string; assignableType: string; planned: number; variance: number; percentUsed: number | null; cost?: number;
  people: ProjectPersonIn[];
}

export function buildProjectHoursModel(
  rows: ProjectIn[], info: ResourceInfo & { canSeeCost: boolean; periodLine: string; from: string; to: string },
): ReportExportModel {
  const cost = info.canSeeCost;
  const columns: ExportColumn[] = [
    text("name", "Project / person"), text("kind", "Type"),
    hours("planned", "Planned hours"), hours("actual", "Logged (approved)"), hours("pending", "Pending approval"), hours("draft", "Draft"),
    hours("variance", "Variance"), { key: "pct", label: "% used", kind: "percent" },
    ...(cost ? [{ key: "cost", label: "Cost", kind: "money" } as ExportColumn] : []),
  ];
  const tail = (r: { planned: number; actual: number; pending: number; draft: number; variance: number; percentUsed: number | null; cost?: number }): { cells: Cell[]; flags: boolean[] } => {
    const bad = overPlan(r.planned, r.actual);
    const cells: Cell[] = [num(r.planned), num(r.actual), num(r.pending) || null, num(r.draft) || null, num(r.variance), num(r.percentUsed)];
    const flags = [false, false, false, false, bad, bad];
    if (cost) { cells.push(r.cost === undefined ? null : num(r.cost)); flags.push(false); }
    return { cells, flags };
  };
  const out: ExportRow[] = [];
  for (const p of rows) {
    const t = tail(p);
    out.push(line("subtotal", [p.label, KIND_LABEL[p.assignableType] ?? "", ...t.cells], [false, false, ...t.flags]));
    for (const x of p.people) {
      const u = tail(x);
      out.push(line("line", [x.designation ? `${x.name} (${x.designation})` : x.name, "", ...u.cells], [false, false, ...u.flags], 1));
    }
  }
  return {
    title: "Team reports — by project", formalTitle: "Planned and logged hours by project",
    entity: info.entity, currency: cost ? info.currency : null, periodLine: info.periodLine,
    params: [{ label: "View", value: "Project" }],
    sections: [{ columns, rows: out }],
    notes: ["Logged hours are approved and posted time; pending and draft time is shown apart. Every project is listed with the people who worked on it."],
    fileBase: `Project-hours-${info.from}-${info.to}`,
  };
}

// ───────────────────────── Team: by employee ─────────────────────────

export interface EmployeeWeekIn extends Split { weekStart: string; planned: number; capacity: number }
export interface EmployeeIn extends Split {
  name: string; designation: string | null; managerName: string | null;
  capacity: number; planned: number; utilizationPercent: number | null; cost?: number; weeks: EmployeeWeekIn[];
}

export function buildEmployeeHoursModel(
  rows: EmployeeIn[],
  info: ResourceInfo & { canSeeCost: boolean; periodLine: string; from: string; to: string; today: string; weekEnd: (weekStart: string) => string },
): ReportExportModel {
  const cost = info.canSeeCost;
  const columns: ExportColumn[] = [
    text("name", "Person / week"), text("designation", "Designation"), text("manager", "Manager"),
    hours("capacity", "Capacity hours"), hours("planned", "Planned hours"), hours("actual", "Logged (approved)"),
    hours("pending", "Pending approval"), hours("draft", "Draft"), { key: "util", label: "Utilization", kind: "percent" },
    ...(cost ? [{ key: "cost", label: "Cost", kind: "money" } as ExportColumn] : []),
    text("note", "Note"),
  ];
  const out: ExportRow[] = [];
  for (const r of rows) {
    const bad = r.utilizationPercent !== null && r.utilizationPercent > 100;
    const cells: Cell[] = [r.name, r.designation, r.managerName, num(r.capacity), num(r.planned), num(r.actual), num(r.pending) || null, num(r.draft) || null, num(r.utilizationPercent)];
    const flags: boolean[] = [false, false, false, false, false, false, false, false, bad];
    if (cost) { cells.push(r.cost === undefined ? null : num(r.cost)); flags.push(false); }
    cells.push(bad ? "Over capacity" : null); flags.push(bad);
    out.push(line("subtotal", cells, flags));
    for (const w of r.weeks) {
      const finished = info.weekEnd(w.weekStart) < info.today;
      const under = finished && w.capacity > 0 && sumSplit(w) < w.capacity * UNDER_LOGGED_RATIO;
      const wc: Cell[] = [`Week of ${fmt.shortDate(w.weekStart)}`, null, null, num(w.capacity), num(w.planned), num(w.actual), num(w.pending) || null, num(w.draft) || null, null];
      const wf: boolean[] = [false, false, false, false, false, under, false, false, false];
      if (cost) { wc.push(null); wf.push(false); }
      wc.push(under ? "Under-logged" : null); wf.push(under);
      out.push(line("line", wc, wf, 1));
    }
  }
  return {
    title: "Team reports — by employee", formalTitle: "Capacity, planned and logged hours by person",
    entity: info.entity, currency: cost ? info.currency : null, periodLine: info.periodLine,
    params: [{ label: "View", value: "Employee" }],
    sections: [{ columns, rows: out }],
    notes: ["Each person is followed by their weeks. A finished week is marked under-logged when less than 80% of its capacity was logged."],
    fileBase: `Employee-hours-${info.from}-${info.to}`,
  };
}

// ───────────────────────── My hours ─────────────────────────

export interface MyLoggedRow { label: string; weeks: Split[]; total: Split }
export interface MyDay extends Split { date: string; weekday: number; capacity: number; planned: number; isHoliday: boolean }
export interface MyPlannedRow { label: string; weeks: number[]; total: number }
export interface MyReportIn {
  resource: { name: string } | null;
  past?: { weeks: string[]; rows: MyLoggedRow[]; totals: Split[]; capacity: number[]; loggedHours: number };
  thisWeek?: { weekStart: string; days: MyDay[]; capacity: number; planned: number; logged: Split };
  upcoming?: { weeks: string[]; rows: MyPlannedRow[]; capacity: number[]; planned: number[] };
}

export function buildMyHoursModel(data: MyReportIn, info: ResourceInfo & { today: string }): ReportExportModel | null {
  if (!data.resource || !data.past || !data.thisWeek || !data.upcoming) return null;
  const { past, thisWeek, upcoming } = data;
  const sections: ReportExportModel["sections"] = [];

  // Where my hours went: approved per week, with pending and draft in their own total columns.
  if (past.rows.length > 0) {
    const columns: ExportColumn[] = [
      text("name", "Project / type"),
      ...past.weeks.map((w, i) => hours(`w${i}`, `Week of ${fmt.shortDate(w)}`)),
      hours("actual", "Total approved"), hours("pending", "Pending approval"), hours("draft", "Draft"),
    ];
    const rows: ExportRow[] = past.rows.map((r) => line("line", [
      r.label, ...r.weeks.map((s) => num(s.actual) || null), num(r.total.actual) || null, num(r.total.pending) || null, num(r.total.draft) || null,
    ]));
    rows.push(line("subtotal", ["Capacity", ...past.capacity.map((c) => num(c)), null, null, null]));
    const flags = [false, ...past.totals.map((s, i) => past.capacity[i] > 0 && sumSplit(s) < past.capacity[i] * UNDER_LOGGED_RATIO), false, false, false];
    rows.push(line("total", ["Logged (all statuses)", ...past.totals.map((s) => num(sumSplit(s))), num(past.loggedHours), null, null], flags));
    sections.push({ heading: "Where my hours went", columns, rows });
  }

  // This week, day by day.
  {
    const columns: ExportColumn[] = [
      text("name", ""),
      ...thisWeek.days.map((d, i) => hours(`d${i}`, `${WEEKDAY_SHORT[d.weekday - 1] ?? ""} ${fmt.shortDate(d.date)}${d.date === info.today ? " (today)" : ""}`)),
    ];
    const rows: ExportRow[] = [
      line("line", ["Capacity", ...thisWeek.days.map((d) => (d.isHoliday ? null : d.capacity > 0 ? num(d.capacity) : null))]),
      line("line", ["Planned", ...thisWeek.days.map((d) => (d.planned > 0 ? num(d.planned) : null))]),
      line("line", ["Logged (approved)", ...thisWeek.days.map((d) => num(d.actual) || null)],
        [false, ...thisWeek.days.map((d) => sumSplit(d) > d.capacity)]),
      line("line", ["Pending approval", ...thisWeek.days.map((d) => num(d.pending) || null)]),
      line("line", ["Draft", ...thisWeek.days.map((d) => num(d.draft) || null)]),
    ];
    const holidays = thisWeek.days.filter((d) => d.isHoliday).map((d) => `${WEEKDAY_SHORT[d.weekday - 1] ?? ""} ${fmt.shortDate(d.date)}`);
    if (holidays.length) rows.push(line("line", [`Holiday: ${holidays.join(", ")}`, ...thisWeek.days.map(() => null)]));
    sections.push({ heading: `This week — week of ${fmt.shortDate(thisWeek.weekStart)}`, columns, rows });
  }

  // Coming up.
  if (upcoming.rows.length > 0) {
    const columns: ExportColumn[] = [text("name", "Project"), ...upcoming.weeks.map((w, i) => hours(`u${i}`, `Week of ${fmt.shortDate(w)}`)), hours("total", "Total")];
    const rows: ExportRow[] = upcoming.rows.map((r) => line("line", [r.label, ...r.weeks.map((h) => (h > 0 ? num(h) : null)), num(r.total)]));
    rows.push(line("subtotal", ["Capacity", ...upcoming.capacity.map((c) => num(c)), null]));
    rows.push(line("total", ["Planned", ...upcoming.planned.map((p) => num(p)), null],
      [false, ...upcoming.planned.map((p, i) => p > upcoming.capacity[i]), false]));
    sections.push({ heading: "Coming up", columns, rows });
  }

  return {
    title: "My hours", formalTitle: `My hours — ${data.resource.name}`,
    entity: info.entity, currency: info.currency, periodLine: `As at ${fmt.shortDate(info.today)}`,
    params: [{ label: "Person", value: data.resource.name }],
    sections,
    notes: ["Approved and posted time counts as logged; pending and draft time is shown apart."],
    fileBase: "My-hours",
  };
}

// ───────────────────────── Employee dashboard ─────────────────────────

export type DashStatus = "approved" | "submitted" | "returned" | "draft" | "missing";
export const DASH_STATUS_LABEL: Record<DashStatus, string> = {
  approved: "Approved", submitted: "Awaiting approval", returned: "Returned", draft: "Draft", missing: "Not started",
};
const ATTENTION_LABEL: Record<string, string> = { returned: "Action", unsubmitted: "Due", over_plan: "Info" };

export interface DashboardIn {
  resource: { name: string; designation: string | null; department: string | null; manager: string | null } | null;
  timesheets: { week: string; status: DashStatus }[];
  leave: { name: string; taken: number; remaining: number }[];
  attention: { kind: string; title: string; detail: string; action: string | null }[];
  ahead: { weeks: string[]; rows: { key: string; label: string; weeks: number[]; total: number }[]; totals: number[] };
  behind: { weeksBack: number; weeks: { week: string; planned: number; logged: number }[]; projects: { key: string; label: string; planned: number; logged: number }[] };
}

/** The dashboard as tables: one section per card, nothing the screen does not show. */
export function buildDashboardModel(data: DashboardIn, info: ResourceInfo & { today: string }): ReportExportModel | null {
  if (!data.resource) return null;
  const r = data.resource;
  const sections: ReportExportModel["sections"] = [];
  const wk = (d: string) => `Week of ${fmt.shortDate(d)}`;

  if (data.timesheets.length > 0) {
    sections.push({
      heading: "My timesheets", columns: [text("week", "Week"), text("status", "Status")],
      rows: data.timesheets.map((t) => line("line", [wk(t.week), DASH_STATUS_LABEL[t.status] ?? t.status],
        t.status === "returned" ? [false, true] : undefined)),
    });
  }
  if (data.leave.length > 0) {
    sections.push({
      heading: "Leave balance", columns: [text("name", "Leave type"), hours("taken", "Taken (h)"), hours("left", "Remaining (h)")],
      rows: data.leave.map((l) => line("line", [l.name, num(l.taken), num(l.remaining)])),
    });
  }
  if (data.attention.length > 0) {
    sections.push({
      heading: "What needs your attention", columns: [text("tag", "Type"), text("title", "Item"), text("detail", "Detail")],
      rows: data.attention.map((a) => line("line", [ATTENTION_LABEL[a.kind] ?? "Info", a.title, a.detail])),
    });
  }
  if (data.ahead.rows.length > 0) {
    const columns: ExportColumn[] = [text("name", "Booking"), ...data.ahead.weeks.map((w, i) => hours(`a${i}`, i === 0 ? "This week" : wk(w))), hours("total", "Total")];
    const rows: ExportRow[] = data.ahead.rows.map((x) => line("line", [x.label, ...x.weeks.map((h) => (h > 0 ? num(h) : null)), num(x.total)]));
    rows.push(line("total", ["Planned total", ...data.ahead.totals.map((v) => num(v)), num(data.ahead.totals.reduce((s, v) => s + v, 0))]));
    sections.push({ heading: "Planned hours — this week and the next three", columns, rows });
  }
  const pair = (label: string): ExportColumn[] => [text("name", label), hours("planned", "Planned (h)"), hours("logged", "Logged (h)")];
  if (data.behind.weeks.length > 0) {
    sections.push({
      heading: `How the last ${data.behind.weeksBack} weeks went — per week`, columns: pair("Week"),
      rows: data.behind.weeks.map((w) => line("line", [wk(w.week), num(w.planned), num(w.logged)])),
    });
  }
  if (data.behind.projects.length > 0) {
    sections.push({
      heading: `How the last ${data.behind.weeksBack} weeks went — per project`, columns: pair("Project"),
      rows: data.behind.projects.map((p) => line("line", [p.label, num(p.planned), num(p.logged)])),
    });
  }

  const params = [{ label: "Person", value: r.name }];
  if (r.designation) params.push({ label: "Designation", value: r.designation });
  if (r.department) params.push({ label: "Department", value: r.department });
  if (r.manager) params.push({ label: "Manager", value: r.manager });
  return {
    title: "Dashboard", formalTitle: `Dashboard — ${r.name}`,
    entity: info.entity, currency: info.currency, periodLine: `As at ${fmt.shortDate(info.today)}`,
    params, sections,
    notes: ["Logged hours are approved and posted time."],
    fileBase: "Dashboard",
  };
}
