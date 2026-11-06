/**
 * Employee dashboard rules (pure). The server half is the route
 * /api/resources/me/dashboard, which loads with the same helpers as My Reports
 * (lib/resources/reports*.ts), so the two can never disagree on a figure.
 */
import { round2, splitTotal, type PlannedWeekRow, type WeeklyLoggedRow } from "./reports";

export type WeekStatus = "approved" | "submitted" | "returned" | "draft" | "missing";

/**
 * One week's timesheet in a word, worst first: anything RETURNED needs the
 * person; then anything still in DRAFT; then anything waiting on the approver;
 * only a week with every line approved/posted reads APPROVED. No lines at all
 * is MISSING — never "approved", which is how an empty week would look done.
 */
export function weekStatus(statuses: readonly string[]): WeekStatus {
  if (!statuses.length) return "missing";
  if (statuses.includes("rejected")) return "returned";
  if (statuses.includes("draft")) return "draft";
  if (statuses.includes("submitted")) return "submitted";
  return "approved";
}

export interface BehindWeek { week: string; planned: number; logged: number }
export interface BehindProject { key: string; planned: number; logged: number }

const ZERO = { actual: 0, pending: 0, draft: 0 };

/**
 * Planned against logged, per past week. Like behindByProject, only work on a
 * booking counts: leave and internal time ("type:" keys) were never planned,
 * so counting them made a week's "logged" bigger than its project bars added
 * up to. Every status counts, a returned line included — it was worked; the
 * return is about how it was recorded.
 */
export function behindByWeek(weeks: readonly string[], planned: readonly PlannedWeekRow[], logged: readonly WeeklyLoggedRow[]): BehindWeek[] {
  const project = logged.filter((r) => !r.key.startsWith("type:"));
  return weeks.map((week, i) => ({
    week,
    planned: round2(planned.reduce((s, r) => s + (r.weeks[i] ?? 0), 0)),
    logged: round2(project.reduce((s, r) => s + splitTotal(r.weeks[i] ?? ZERO), 0)),
  }));
}

/**
 * Planned against logged, per booking, across the window. Leave and internal
 * time ("type:" keys) are left out: they were never planned against a project,
 * so they would only ever read as unplanned work.
 */
export function behindByProject(planned: readonly PlannedWeekRow[], logged: readonly WeeklyLoggedRow[]): BehindProject[] {
  const map = new Map<string, BehindProject>();
  for (const r of planned) {
    const p = map.get(r.key) ?? { key: r.key, planned: 0, logged: 0 };
    p.planned += r.total;
    map.set(r.key, p);
  }
  for (const r of logged) {
    if (r.key.startsWith("type:")) continue;
    const p = map.get(r.key) ?? { key: r.key, planned: 0, logged: 0 };
    p.logged += splitTotal(r.total);
    map.set(r.key, p);
  }
  return [...map.values()]
    .map((p) => ({ ...p, planned: round2(p.planned), logged: round2(p.logged) }))
    .filter((p) => p.planned > 0 || p.logged > 0)
    .sort((a, b) => Math.max(b.planned, b.logged) - Math.max(a.planned, a.logged));
}
