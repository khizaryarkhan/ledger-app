/**
 * GET /api/resources/me/dashboard?weeksBack=3
 *
 * Everything the employee dashboard shows, for the CALLER only (the person is
 * found from the session): who they are, their last two timesheets, leave
 * balances, what needs their attention, planned hours this week and the next
 * three, and planned against logged for the weeks behind (3 | 6 | 12).
 * Loads with the same helpers as /me/report, so the two never disagree.
 * Lives under /me/ so employee logins can call it.
 */
import { db } from "@/db";
import { hoursVarianceEnquiries, leavePolicies, leaveBalanceEntries, timesheetTypes } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { resolveActor } from "@/lib/resources/access-server";
import { weekWindow, weekEnd, plannedByWeek, loggedByWeek, round2 } from "@/lib/resources/reports";
import { loadCalendars, loadEntries, loadAssignments, loadLabels, labelFor, validDate } from "@/lib/resources/reports-server";
import { returnsFor } from "@/lib/resources/approval-server";
import { balanceAsAt } from "@/lib/payroll/leave-balance";
import { weekStatus, behindByWeek, behindByProject } from "@/lib/resources/dashboard";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";

const BEHIND_CHOICES = [3, 6, 12];

export async function GET(req: Request) {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const url = new URL(req.url);
  const wb = Number(url.searchParams.get("weeksBack"));
  const weeksBack = BEHIND_CHOICES.includes(wb) ? wb : 3;
  const todayParam = url.searchParams.get("today");
  const today = validDate(todayParam) ? todayParam! : new Date().toISOString().slice(0, 10);

  const userId = (session?.user as { id?: string } | undefined)?.id;
  const { me, people } = await resolveActor(orgId!, userId, role);
  if (!me) return ok({ resource: null });

  const win = weekWindow(today, weeksBack, 3);
  const firstWeek = win.past[0] ?? win.current;
  const lastWeek = win.upcoming[win.upcoming.length - 1] ?? win.current;
  const ids = [me.id];

  const [{ calendars }, { entries, typeNames }, assignments, returns, enquiries, leaveTypes] = await Promise.all([
    loadCalendars(orgId!, ids),
    loadEntries(orgId!, ids, firstWeek, weekEnd(win.current)),
    loadAssignments(orgId!, ids, firstWeek, weekEnd(lastWeek)),
    returnsFor(orgId!, me.id, 20),
    db.select({
      id: hoursVarianceEnquiries.id, assignableType: hoursVarianceEnquiries.assignableType,
      assignableId: hoursVarianceEnquiries.assignableId, month: hoursVarianceEnquiries.month,
      plannedHours: hoursVarianceEnquiries.plannedHours, actualHours: hoursVarianceEnquiries.actualHours, status: hoursVarianceEnquiries.status,
    }).from(hoursVarianceEnquiries)
      .where(and(eq(hoursVarianceEnquiries.orgId, orgId!), eq(hoursVarianceEnquiries.resourceId, me.id), ne(hoursVarianceEnquiries.status, "closed"))),
    db.select({ id: timesheetTypes.id, name: timesheetTypes.name }).from(timesheetTypes)
      .innerJoin(leavePolicies, eq(leavePolicies.timesheetTypeId, timesheetTypes.id))
      .where(and(eq(timesheetTypes.orgId, orgId!), eq(timesheetTypes.status, "active"))),
  ]);
  const cal = calendars.get(me.id);
  if (!cal) return ok({ resource: null });

  // Timesheet status for the last two finished weeks.
  const timesheets = win.past.slice(-2).map((w) => ({
    week: w,
    status: weekStatus(entries.filter((e) => e.date >= w && e.date <= weekEnd(w)).map((e) => e.status)),
  }));

  // Leave: remaining now, and taken this calendar year.
  const yearStart = `${today.slice(0, 4)}-01-01`;
  const leave = await Promise.all(leaveTypes.map(async (t) => {
    const [remaining, takenRows] = await Promise.all([
      balanceAsAt(orgId!, me.id, t.id, today),
      db.select({ h: sql<string>`coalesce(sum(-${leaveBalanceEntries.hours}), 0)` }).from(leaveBalanceEntries)
        .where(and(
          eq(leaveBalanceEntries.orgId, orgId!), eq(leaveBalanceEntries.resourceId, me.id), eq(leaveBalanceEntries.timesheetTypeId, t.id),
          eq(leaveBalanceEntries.sourceType, "usage"), gte(leaveBalanceEntries.date, yearStart), lte(leaveBalanceEntries.date, today),
        )),
    ]);
    return { name: t.name, taken: round2(Number(takenRows[0]?.h ?? 0)), remaining: round2(Number(remaining)) };
  }));

  // Planned ahead (this week + 3) and the weeks behind.
  const aheadWeeks = [win.current, ...win.upcoming];
  const ahead = plannedByWeek(assignments, cal, aheadWeeks);
  const pastPlanned = plannedByWeek(assignments, cal, win.past);
  const pastLogged = loggedByWeek(entries.filter((e) => e.date < win.current), win.past);
  const byProject = behindByProject(pastPlanned.rows, pastLogged);

  const keys = new Set<string>([
    ...ahead.rows.map((r) => r.key), ...byProject.map((p) => p.key),
    ...enquiries.map((e) => `${e.assignableType}:${e.assignableId}`),
  ]);
  const labels = await loadLabels(orgId!, keys);
  const label = (k: string) => labelFor(k, labels, typeNames);

  const manager = me.managerId ? people.find((p) => p.id === me.managerId) : null;
  const attention = [
    ...returns.filter((r) => !r.acknowledgedAt).slice(0, 5).map((r) => ({
      kind: "returned", title: `Time returned for ${r.date}`, detail: r.reason || "Your approver sent this time back.", action: "timesheet",
    })),
    ...timesheets.filter((t) => t.status === "missing" || t.status === "draft").map((t) => ({
      kind: "unsubmitted", title: `Timesheet for w/c ${t.week} not submitted`,
      detail: t.status === "missing" ? "Nothing logged for that week yet." : "Saved as a draft — submit it for approval.", action: "timesheet",
    })),
    ...enquiries.map((e) => ({
      kind: "over_plan",
      title: `Hours over plan: ${label(`${e.assignableType}:${e.assignableId}`)}`,
      detail: `${e.month}: ${Number(e.actualHours).toFixed(2)} h against ${Number(e.plannedHours).toFixed(2)} h planned — ${e.status === "answered" ? "explained, awaiting review" : "with your lead to review"}.`,
      action: null,
    })),
  ];

  return ok({
    resource: { name: me.name, designation: me.designationName, department: me.department, manager: manager?.name ?? null },
    today,
    timesheets,
    leave,
    attention,
    ahead: {
      weeks: aheadWeeks,
      rows: ahead.rows.map((r) => ({ key: r.key, label: label(r.key), weeks: r.weeks, total: r.total })),
      totals: ahead.planned,
    },
    behind: {
      weeksBack,
      weeks: behindByWeek(win.past, pastPlanned.rows, pastLogged),
      projects: byProject.map((p) => ({ ...p, label: label(p.key) })),
    },
  });
}
