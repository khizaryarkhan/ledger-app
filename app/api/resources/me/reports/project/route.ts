/**
 * GET /api/resources/me/reports/project?from=&to=[&projectId=][&key=]
 *   Team and above. Per project / manufacturing order / job work order: planned
 *   hours vs logged (approved+posted = actual, submitted = pending), variance,
 *   % used, and a per-person breakdown limited to the people the caller may see.
 *   Money appears only for an org admin / "all" designation, and only where a
 *   cost rate exists.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { resolveActor } from "@/lib/resources/access-server";
import { canOpenTeamReports, visibleResourceIds } from "@/lib/resources/access";
import { projectRollup, addDays, MAX_SPAN_DAYS } from "@/lib/resources/reports";
import { loadCalendars, loadEntries, loadAssignments, loadLabels, labelFor, validDate } from "@/lib/resources/reports-server";
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
  const projectId = url.searchParams.get("projectId");
  const key = url.searchParams.get("key") ?? (projectId ? `project:${projectId}` : null);

  const userId = (session?.user as { id?: string } | undefined)?.id;
  const { actor, people } = await resolveActor(orgId!, userId, role);
  if (!canOpenTeamReports(actor)) {
    return NextResponse.json({ error: "Your designation does not include team reports." }, { status: 403 });
  }
  const visible = visibleResourceIds(actor, people);
  const ids = visible === "all" ? people.map((p) => p.id) : [...visible];

  const [{ calendars, rates }, { entries, typeNames }, assignments] = await Promise.all([
    loadCalendars(orgId!, ids),
    loadEntries(orgId!, ids, from, to, { assignableOnly: true }),
    loadAssignments(orgId!, ids, from, to),
  ]);

  // Pay rates are an org-admin matter, whatever the designation level.
  const canSeeCost = actor.isOrgAdmin;
  const rows = projectRollup({ entries, assignments, calendars, window: { from, to }, visible, costing: { allowed: canSeeCost, rates }, onlyKey: key });
  const labels = await loadLabels(orgId!, rows.map((r) => r.key));
  const peopleById = new Map(people.map((p) => [p.id, p]));

  return ok({
    from, to, canSeeCost,
    rows: rows.map((r) => ({
      ...r,
      label: labelFor(r.key, labels, typeNames),
      code: labels.get(r.key)?.code ?? null,
      people: r.people.map((p) => ({
        ...p, name: peopleById.get(p.resourceId)?.name ?? "Unknown",
        designation: peopleById.get(p.resourceId)?.designationName ?? null,
      })),
    })),
  });
}
