/**
 * Resource reports — pure, no `db`. Planned vs logged hours by week, project
 * and person. The routes under app/api/resources/me/ fetch rows and call these;
 * everything that is a rule (week bucketing, planned hours, status split,
 * variance, who is counted, when a cost may appear) lives here so it is tested.
 *
 * Dates are YYYY-MM-DD strings throughout and are never turned into a Date
 * from their own text ("A date is a date"); weeks start on Monday (ISO).
 */

import { workingDaysInRange, DEFAULT_WORKING_DAYS } from "@/lib/resources/capacity";
import { overlaps } from "@/lib/resources/assignable";

// ── numbers & dates ───────────────────────────────────────────────────────────

/** Longest window a team report accepts, in days (keeps the weekly series bounded). */
export const MAX_SPAN_DAYS = 371;

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d) + n * 86400000);
  return `${String(dt.getUTCFullYear()).padStart(4, "0")}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** ISO weekday of a date: 1 = Monday .. 7 = Sunday. */
export function isoWeekday(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return js === 0 ? 7 : js;
}

/** The Monday of the ISO week containing `dateStr`. */
export function weekStart(dateStr: string): string {
  return addDays(dateStr, -(isoWeekday(dateStr) - 1));
}

export function weekEnd(startMonday: string): string {
  return addDays(startMonday, 6);
}

/** Mondays of every week touching [from, to], oldest first. */
export function weeksBetween(from: string, to: string): string[] {
  const out: string[] = [];
  if (from > to) return out;
  let cur = weekStart(from);
  while (cur <= to) { out.push(cur); cur = addDays(cur, 7); }
  return out;
}

/** `weeksBack` full weeks before the current one, the current one, and `weeksAhead` after. */
export function weekWindow(today: string, weeksBack: number, weeksAhead: number) {
  const current = weekStart(today);
  const past = Array.from({ length: weeksBack }, (_, i) => addDays(current, -7 * (weeksBack - i)));
  const upcoming = Array.from({ length: weeksAhead }, (_, i) => addDays(current, 7 * (i + 1)));
  return { past, current, upcoming };
}

// ── status split ──────────────────────────────────────────────────────────────

export type HoursBucket = "actual" | "pending" | "draft";

/** approved + posted = actual, submitted = pending, draft / rejected = draft. */
export function statusBucket(status: string): HoursBucket {
  if (status === "approved" || status === "posted") return "actual";
  if (status === "submitted") return "pending";
  return "draft";
}

export type Split = { actual: number; pending: number; draft: number };
export const emptySplit = (): Split => ({ actual: 0, pending: 0, draft: 0 });
export const splitTotal = (s: Split): number => round2(s.actual + s.pending + s.draft);
function addTo(s: Split, bucket: HoursBucket, hours: number): void { s[bucket] += hours; }
function roundSplit(s: Split): Split { return { actual: round2(s.actual), pending: round2(s.pending), draft: round2(s.draft) }; }

// ── input rows ────────────────────────────────────────────────────────────────

export type PersonCalendar = {
  dailyCapacity: number;
  workingDays: readonly number[] | null;
  holidays: ReadonlySet<string>;
};

export type EntryRow = {
  resourceId: string;
  date: string;
  hours: number;
  status: string;
  assignableType: string | null;
  assignableId: string | null;
  timesheetTypeId: string;
  isLeave: boolean;
};

export type AssignmentRow = {
  resourceId: string;
  assignableType: string;
  assignableId: string;
  startDate: string;
  endDate: string | null;
  allocationPercent: number;
  status: string;
};

export type DateWindow = { from: string; to: string };

/** Project / MO / job-work key, or the timesheet type for entries with no assignable. */
export function entryKey(e: Pick<EntryRow, "assignableType" | "assignableId" | "timesheetTypeId">): string {
  return e.assignableType && e.assignableId ? `${e.assignableType}:${e.assignableId}` : `type:${e.timesheetTypeId}`;
}
export const assignmentKey = (a: Pick<AssignmentRow, "assignableType" | "assignableId">): string => `${a.assignableType}:${a.assignableId}`;

// ── planned hours & capacity ──────────────────────────────────────────────────

function workingDaysFor(cal: PersonCalendar, from: string, to: string): number {
  const days = cal.workingDays && cal.workingDays.length ? cal.workingDays : DEFAULT_WORKING_DAYS;
  return workingDaysInRange(from, to, days, cal.holidays);
}

/** Gross capacity hours of a person over a window: working days (minus holidays) x daily capacity. */
export function capacityHours(cal: PersonCalendar, from: string, to: string): number {
  return round2(workingDaysFor(cal, from, to) * cal.dailyCapacity);
}

/**
 * Planned hours of one assignment inside a window: allocation% x daily capacity
 * x the person's working days in the intersection of the assignment (open-ended
 * when it has no end date) and the window. Cancelled assignments plan nothing.
 */
export function plannedHours(a: AssignmentRow, cal: PersonCalendar, w: DateWindow): number {
  if (a.status === "cancelled") return 0;
  if (!overlaps(a.startDate, a.endDate, w.from, w.to)) return 0;
  const start = a.startDate > w.from ? a.startDate : w.from;
  const end = a.endDate && a.endDate < w.to ? a.endDate : w.to;
  if (start > end) return 0;
  return round2((a.allocationPercent / 100) * cal.dailyCapacity * workingDaysFor(cal, start, end));
}

const inWin = (d: string, w: DateWindow): boolean => d >= w.from && d <= w.to;

// ── the caller's own report ───────────────────────────────────────────────────

export type WeeklyLoggedRow = { key: string; assignableType: string | null; assignableId: string | null; timesheetTypeId: string | null; weeks: Split[]; total: Split };

/** Logged hours by week x (project | type), each cell split by status. `weeks` are Mondays. */
export function loggedByWeek(entries: readonly EntryRow[], weeks: readonly string[]): WeeklyLoggedRow[] {
  const index = new Map(weeks.map((w, i) => [w, i]));
  const rows = new Map<string, WeeklyLoggedRow>();
  for (const e of entries) {
    const i = index.get(weekStart(e.date));
    if (i === undefined) continue;
    const key = entryKey(e);
    let row = rows.get(key);
    if (!row) {
      const keyed = !!(e.assignableType && e.assignableId);
      row = {
        key, assignableType: keyed ? e.assignableType : null, assignableId: keyed ? e.assignableId : null,
        timesheetTypeId: keyed ? null : e.timesheetTypeId,
        weeks: weeks.map(emptySplit), total: emptySplit(),
      };
      rows.set(key, row);
    }
    const b = statusBucket(e.status);
    addTo(row.weeks[i], b, e.hours);
    addTo(row.total, b, e.hours);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, weeks: r.weeks.map(roundSplit), total: roundSplit(r.total) }))
    .sort((a, b) => splitTotal(b.total) - splitTotal(a.total));
}

export type DayRow = { date: string; weekday: number; capacity: number; planned: number; actual: number; pending: number; draft: number; isHoliday: boolean };

/** The seven days of a week: capacity (0 on a non-working day or holiday), planned and logged. */
export function daysOfWeek(
  startMonday: string, entries: readonly EntryRow[], assignments: readonly AssignmentRow[], cal: PersonCalendar,
): DayRow[] {
  const workDays = cal.workingDays && cal.workingDays.length ? cal.workingDays : DEFAULT_WORKING_DAYS;
  return Array.from({ length: 7 }, (_, i) => {
    const date = addDays(startMonday, i);
    const weekday = isoWeekday(date);
    const working = workDays.includes(weekday) && !cal.holidays.has(date);
    const split = emptySplit();
    for (const e of entries) if (e.date === date) addTo(split, statusBucket(e.status), e.hours);
    const planned = assignments.reduce((s, a) => s + plannedHours(a, cal, { from: date, to: date }), 0);
    return {
      date, weekday, isHoliday: cal.holidays.has(date),
      capacity: working ? round2(cal.dailyCapacity) : 0,
      planned: round2(planned), ...roundSplit(split),
    };
  });
}

export type PlannedWeekRow = { key: string; assignableType: string; assignableId: string; weeks: number[]; total: number };

/** Planned hours per project per week, plus the person's capacity for each week. */
export function plannedByWeek(
  assignments: readonly AssignmentRow[], cal: PersonCalendar, weeks: readonly string[],
): { rows: PlannedWeekRow[]; capacity: number[]; planned: number[] } {
  const rows = new Map<string, PlannedWeekRow>();
  for (const a of assignments) {
    const key = assignmentKey(a);
    let row = rows.get(key);
    if (!row) {
      row = { key, assignableType: a.assignableType, assignableId: a.assignableId, weeks: weeks.map(() => 0), total: 0 };
      rows.set(key, row);
    }
    weeks.forEach((w, i) => { row!.weeks[i] += plannedHours(a, cal, { from: w, to: weekEnd(w) }); });
  }
  const out = [...rows.values()]
    .map((r) => ({ ...r, weeks: r.weeks.map(round2), total: round2(r.weeks.reduce((s, n) => s + n, 0)) }))
    .filter((r) => r.total > 0)
    .sort((a, b) => b.total - a.total);
  return {
    rows: out,
    capacity: weeks.map((w) => capacityHours(cal, w, weekEnd(w))),
    planned: weeks.map((_, i) => round2(out.reduce((s, r) => s + r.weeks[i], 0))),
  };
}

// ── team rollups ──────────────────────────────────────────────────────────────

export type Visible = ReadonlySet<string> | "all";
const isVisible = (v: Visible, id: string): boolean => v === "all" || v.has(id);

export type Costing = {
  /** Only an org admin / "all" designation may see money. */
  allowed: boolean;
  /** resource id -> cost per hour; null/missing = no rate. */
  rates: ReadonlyMap<string, number | null>;
};

/** Actual hours x rate, or undefined when not allowed or there is no rate (never zero). */
export function costOf(c: Costing, resourceId: string, actualHours: number): number | undefined {
  if (!c.allowed) return undefined;
  const rate = c.rates.get(resourceId);
  if (rate === null || rate === undefined) return undefined;
  return round2(actualHours * rate);
}

export type PersonOnProject = Split & {
  resourceId: string; planned: number; variance: number; percentUsed: number | null; cost?: number;
};
export type ProjectRow = Split & {
  key: string; assignableType: string; assignableId: string;
  planned: number; variance: number; percentUsed: number | null; cost?: number;
  people: PersonOnProject[];
};

const pct = (actual: number, planned: number): number | null => (planned > 0 ? round2((actual / planned) * 100) : null);

/** Per project / MO / job work: planned vs logged, only counting people the caller may see. */
export function projectRollup(input: {
  entries: readonly EntryRow[]; assignments: readonly AssignmentRow[];
  calendars: ReadonlyMap<string, PersonCalendar>; window: DateWindow;
  visible: Visible; costing: Costing; onlyKey?: string | null;
}): ProjectRow[] {
  const { entries, assignments, calendars, window, visible, costing, onlyKey } = input;
  type Acc = { split: Split; planned: number };
  const projects = new Map<string, { type: string; id: string; people: Map<string, Acc> }>();
  const person = (key: string, type: string, id: string, rid: string): Acc => {
    let p = projects.get(key);
    if (!p) { p = { type, id, people: new Map() }; projects.set(key, p); }
    let a = p.people.get(rid);
    if (!a) { a = { split: emptySplit(), planned: 0 }; p.people.set(rid, a); }
    return a;
  };
  for (const e of entries) {
    if (!e.assignableType || !e.assignableId || !isVisible(visible, e.resourceId) || !inWin(e.date, window)) continue;
    const key = entryKey(e);
    if (onlyKey && key !== onlyKey) continue;
    addTo(person(key, e.assignableType, e.assignableId, e.resourceId).split, statusBucket(e.status), e.hours);
  }
  for (const a of assignments) {
    const cal = calendars.get(a.resourceId);
    if (!cal || !isVisible(visible, a.resourceId)) continue;
    const key = assignmentKey(a);
    if (onlyKey && key !== onlyKey) continue;
    const planned = plannedHours(a, cal, window);
    if (planned <= 0) continue;
    person(key, a.assignableType, a.assignableId, a.resourceId).planned += planned;
  }
  const rows: ProjectRow[] = [];
  for (const [key, p] of projects) {
    const total = emptySplit();
    let planned = 0;
    let cost: number | undefined;
    const people: PersonOnProject[] = [];
    for (const [rid, acc] of p.people) {
      const s = roundSplit(acc.split);
      const pl = round2(acc.planned);
      const c = costOf(costing, rid, s.actual);
      if (c !== undefined) cost = round2((cost ?? 0) + c);
      total.actual += s.actual; total.pending += s.pending; total.draft += s.draft;
      planned += pl;
      people.push({ resourceId: rid, planned: pl, ...s, variance: round2(pl - s.actual), percentUsed: pct(s.actual, pl), ...(c !== undefined ? { cost: c } : {}) });
    }
    people.sort((a, b) => b.actual - a.actual || b.planned - a.planned);
    const t = roundSplit(total);
    planned = round2(planned);
    rows.push({
      key, assignableType: p.type, assignableId: p.id, planned, ...t,
      variance: round2(planned - t.actual), percentUsed: pct(t.actual, planned),
      ...(cost !== undefined ? { cost } : {}), people,
    });
  }
  return rows.filter((r) => r.planned > 0 || r.actual > 0 || r.pending > 0 || r.draft > 0).sort((a, b) => b.actual - a.actual || b.planned - a.planned);
}

export type EmployeeWeek = Split & { weekStart: string; planned: number; capacity: number };
export type EmployeeRow = Split & {
  resourceId: string; capacity: number; leaveHours: number; planned: number;
  utilizationPercent: number | null; cost?: number; weeks: EmployeeWeek[];
};

/** One row per person in `people` the caller may see: capacity, planned, logged split and a weekly series. */
export function employeeRollup(input: {
  peopleIds: readonly string[];
  entries: readonly EntryRow[]; assignments: readonly AssignmentRow[];
  calendars: ReadonlyMap<string, PersonCalendar>; window: DateWindow;
  visible: Visible; costing: Costing;
}): EmployeeRow[] {
  const { peopleIds, entries, assignments, calendars, window, visible, costing } = input;
  const weeks = weeksBetween(window.from, window.to);
  const rows: EmployeeRow[] = [];
  for (const id of peopleIds) {
    const cal = calendars.get(id);
    if (!cal || !isVisible(visible, id)) continue;
    const mine = entries.filter((e) => e.resourceId === id && inWin(e.date, window));
    const myAssign = assignments.filter((a) => a.resourceId === id);
    const total = emptySplit();
    let leave = 0;
    const perWeek = new Map<string, Split>(weeks.map((w) => [w, emptySplit()]));
    for (const e of mine) {
      if (e.isLeave) { if (statusBucket(e.status) === "actual") leave += e.hours; continue; }
      const b = statusBucket(e.status);
      addTo(total, b, e.hours);
      const ws = perWeek.get(weekStart(e.date));
      if (ws) addTo(ws, b, e.hours);
    }
    const capacity = Math.max(0, round2(capacityHours(cal, window.from, window.to) - leave));
    const series: EmployeeWeek[] = weeks.map((w) => {
      const from = w < window.from ? window.from : w;
      const to = weekEnd(w) > window.to ? window.to : weekEnd(w);
      return {
        weekStart: w, ...roundSplit(perWeek.get(w) as Split),
        planned: round2(myAssign.reduce((s, a) => s + plannedHours(a, cal, { from, to }), 0)),
        capacity: capacityHours(cal, from, to),
      };
    });
    const t = roundSplit(total);
    const cost = costOf(costing, id, t.actual);
    rows.push({
      resourceId: id, capacity, leaveHours: round2(leave),
      planned: round2(series.reduce((s, w) => s + w.planned, 0)), ...t,
      utilizationPercent: capacity > 0 ? round2((t.actual / capacity) * 100) : null,
      ...(cost !== undefined ? { cost } : {}), weeks: series,
    });
  }
  return rows;
}
