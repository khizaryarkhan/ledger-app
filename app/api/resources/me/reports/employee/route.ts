/**
 * GET /api/resources/me/reports/employee?from=&to=
 *   Team and above. One row per person the caller may see: designation,
 *   manager, capacity, planned, logged split by status, utilization and a
 *   weekly series. Cost only for an org admin / "all", only where a rate exists.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { resolveActor } from "@/lib/resources/access-server";
import { canOpenTeamReports, visibleResourceIds } from "@/lib/resources/access";
import { employeeRollup, addDays, MAX_SPAN_DAYS } from "@/lib/resources/reports";
import { loadCalendars, loadEntries, loadAssignments, validDate } from "@/lib/resources/reports-server";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!validDate(from) || !validDate(to) || from > to) return bad("from and to are required (YYYY-MM-DD, from <= to)");

  if (from < addDays(to, -MAX_SPAN_DAYS)) return bad("Choose a period of one year or less.");

  const userId =(session?.user as { id?: string } | undefined)?.id;
  const { actor, people } = await resolveActor(orgId!, userId, role);
  if (!canOpenTeamReports(actor)) {
    return NextResponse.json({ error: "Your designation does not include team reports." }, { status: 403 });
  }
  const visible = visibleResourceIds(actor, people);
  const active = people.filter((p) => p.status === "active");
  const ids = active.filter((p) => visible === "all" || visible.has(p.id)).map((p) => p.id);

  const [{ calendars, rates }, { entries }, assignments] = await Promise.all([
    loadCalendars(orgId!, ids),
    loadEntries(orgId!, ids, from, to),
    loadAssignments(orgId!, ids, from, to),
  ]);

  // Pay rates are an org-admin matter, whatever the designation level.
  const canSeeCost = actor.isOrgAdmin;
  const rows = employeeRollup({
    peopleIds: ids, entries, assignments, calendars, window: { from, to }, visible,
    costing: { allowed: canSeeCost, rates },
  });
  const byId = new Map(people.map((p) => [p.id, p]));

  return ok({
    from, to, canSeeCost,
    rows: rows.map((r) => {
      const p = byId.get(r.resourceId);
      return {
        ...r,
        name: p?.name ?? "Unknown", designation: p?.designationName ?? null, department: p?.department ?? null,
        managerId: p?.managerId ?? null, managerName: (p?.managerId && byId.get(p.managerId)?.name) || null,
      };
    }),
  });
}
