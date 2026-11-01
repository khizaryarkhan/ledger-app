/**
 * GET /api/resources/me/report?weeksBack=8&weeksAhead=4[&today=YYYY-MM-DD]
 *   The caller's OWN report: where their hours went (past weeks), this week
 *   day by day, and what is planned ahead. {resource:null} when the login has
 *   no linked people-resource. Lives under /me/ so employee logins can call it.
 */

import { requireOrg, ok } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { resolveActor } from "@/lib/resources/access-server";
import {
  weekWindow, weekEnd, capacityHours, loggedByWeek, daysOfWeek, plannedByWeek, emptySplit, splitTotal, round2, type Split,
} from "@/lib/resources/reports";
import {
  loadCalendars, loadEntries, loadAssignments, loadLabels, labelFor, validDate,
} from "@/lib/resources/reports-server";

const MAX_WEEKS = 52;
const clampWeeks = (v: string | null, dflt: number): number => {
  const n = v === null ? dflt : Number(v);
  return Number.isInteger(n) && n >= 0 ? Math.min(n, MAX_WEEKS) : dflt;
};

const kindOf = (key: string): string => key.slice(0, key.indexOf(":"));

export async function GET(req: Request) {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const url = new URL(req.url);
  const weeksBack = clampWeeks(url.searchParams.get("weeksBack"), 8);
  const weeksAhead = clampWeeks(url.searchParams.get("weeksAhead"), 4);
  const todayParam = url.searchParams.get("today");
  const today = validDate(todayParam) ? todayParam : new Date().toISOString().slice(0, 10);

  const userId = (session?.user as { id?: string } | undefined)?.id;
  const { me } = await resolveActor(orgId!, userId, role);
  if (!me) return ok({ resource: null });

  const win = weekWindow(today, weeksBack, weeksAhead);
  const firstWeek = win.past[0] ?? win.current;
  const lastWeek = win.upcoming[win.upcoming.length - 1] ?? win.current;
  const ids = [me.id];

  const [{ calendars, meta }, { entries, typeNames }, assignments] = await Promise.all([
    loadCalendars(orgId!, ids),
    loadEntries(orgId!, ids, firstWeek, weekEnd(win.current)),
    loadAssignments(orgId!, ids, win.current, weekEnd(lastWeek)),
  ]);
  const cal = calendars.get(me.id);
  if (!cal) return ok({ resource: null });

  const pastRows = loggedByWeek(entries, win.past);
  const thisWeekEntries = entries.filter((e) => e.date >= win.current);
  const days = daysOfWeek(win.current, thisWeekEntries, assignments, cal);
  const upcoming = plannedByWeek(assignments, cal, win.upcoming);
  const thisWeekPlan = plannedByWeek(assignments, cal, [win.current]);

  const keys = [...pastRows.map((r) => r.key), ...upcoming.rows.map((r) => r.key)];
  const labels = await loadLabels(orgId!, keys);

  const pastTotals: Split[] = win.past.map((_, i) => {
    const s = emptySplit();
    for (const r of pastRows) { s.actual += r.weeks[i].actual; s.pending += r.weeks[i].pending; s.draft += r.weeks[i].draft; }
    return { actual: round2(s.actual), pending: round2(s.pending), draft: round2(s.draft) };
  });
  const thisWeekLogged = days.reduce(
    (s, d) => ({ actual: s.actual + d.actual, pending: s.pending + d.pending, draft: s.draft + d.draft }), emptySplit(),
  );
  const pastLoggedTotal = round2(pastTotals.reduce((s, t) => s + splitTotal(t), 0));

  return ok({
    resource: { id: me.id, name: me.name, dailyCapacity: meta.get(me.id)?.dailyCapacity ?? 0, designation: me.designationName, accessLevel: me.accessLevel },
    today,
    past: {
      weeks: win.past,
      rows: pastRows.map((r) => ({
        key: r.key, kind: r.assignableType ?? "type", label: labelFor(r.key, labels, typeNames), weeks: r.weeks, total: r.total,
      })),
      totals: pastTotals,
      capacity: win.past.map((w) => capacityHours(cal, w, weekEnd(w))),
      loggedHours: pastLoggedTotal,
    },
    thisWeek: {
      weekStart: win.current, days,
      capacity: round2(days.reduce((s, d) => s + d.capacity, 0)),
      planned: thisWeekPlan.planned[0] ?? 0,
      logged: { actual: round2(thisWeekLogged.actual), pending: round2(thisWeekLogged.pending), draft: round2(thisWeekLogged.draft) },
    },
    upcoming: {
      weeks: win.upcoming,
      rows: upcoming.rows.map((r) => ({ key: r.key, kind: kindOf(r.key), label: labelFor(r.key, labels, typeNames), weeks: r.weeks, total: r.total })),
      capacity: upcoming.capacity,
      planned: upcoming.planned,
    },
  });
}
