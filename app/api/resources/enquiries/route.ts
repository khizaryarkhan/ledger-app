/**
 * GET /api/resources/enquiries?status=open|answered|closed|all
 *   -> hours-over-plan enquiries the caller may see.
 *
 * Visible when the enquiry is about someone you may see, OR it was assigned to
 * you — a project lead is routinely not in their people's management chain, so
 * scoping on the person alone would hide the very enquiries routed to them.
 * That is the same widening Phase A's approval queue needed.
 */

import { db } from "@/db";
import { hoursVarianceEnquiries, resources, projects } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { visibleResourceIds, scopeLabel } from "@/lib/resources/access";
import { resolveActor } from "@/lib/resources/access-server";
import { and, desc, eq, inArray } from "drizzle-orm";

const STATUSES = ["open", "answered", "closed", "all"];

export async function GET(req: Request) {
  const { error, orgId, session, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "open";
  if (!STATUSES.includes(status)) return bad(`status must be one of ${STATUSES.join(", ")}`);

  const { actor, people } = await resolveActor(orgId!, (session as any)?.user?.id ?? null, role);
  const scope = scopeLabel(actor);
  if (actor.level === "none") return ok({ scope, rows: [] });
  const visible = visibleResourceIds(actor, people);

  const conds = [eq(hoursVarianceEnquiries.orgId, orgId!)];
  if (status !== "all") conds.push(eq(hoursVarianceEnquiries.status, status));

  const rows = await db.select({
    id: hoursVarianceEnquiries.id, resourceId: hoursVarianceEnquiries.resourceId,
    personName: resources.name,
    assignableType: hoursVarianceEnquiries.assignableType, assignableId: hoursVarianceEnquiries.assignableId,
    month: hoursVarianceEnquiries.month, kind: hoursVarianceEnquiries.kind,
    plannedHours: hoursVarianceEnquiries.plannedHours, actualHours: hoursVarianceEnquiries.actualHours,
    status: hoursVarianceEnquiries.status, assignedTo: hoursVarianceEnquiries.assignedTo,
    response: hoursVarianceEnquiries.response, respondedAt: hoursVarianceEnquiries.respondedAt,
    escalatedAt: hoursVarianceEnquiries.escalatedAt, createdAt: hoursVarianceEnquiries.createdAt,
  }).from(hoursVarianceEnquiries)
    .innerJoin(resources, eq(resources.id, hoursVarianceEnquiries.resourceId))
    .where(and(...conds))
    .orderBy(desc(hoursVarianceEnquiries.month), desc(hoursVarianceEnquiries.createdAt));

  const mine = rows.filter((r) =>
    visible === "all" || visible.has(r.resourceId) || (!!actor.resourceId && r.assignedTo === actor.resourceId));
  if (mine.length === 0) return ok({ scope, rows: [] });

  const projectIds = Array.from(new Set(mine.filter((r) => r.assignableType === "project").map((r) => r.assignableId)));
  const names = new Map<string, string>();
  if (projectIds.length) {
    const ps = await db.select({ id: projects.id, name: projects.name, code: projects.code }).from(projects)
      .where(and(eq(projects.orgId, orgId!), inArray(projects.id, projectIds)));
    for (const p of ps) names.set(p.id, `${p.code} · ${p.name}`);
  }

  return ok({
    scope,
    rows: mine.map((r) => ({
      ...r,
      plannedHours: Number(r.plannedHours), actualHours: Number(r.actualHours),
      bookingName: names.get(r.assignableId) ?? null,
      canAnswer: !!actor.resourceId && (r.assignedTo === actor.resourceId || actor.isOrgAdmin),
    })),
  });
}
