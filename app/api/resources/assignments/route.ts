/**
 * GET  /api/resources/assignments?from=&to=[&resourceId=][&assignableType=&assignableId=]
 *   → board data: every resource (or one, if resourceId given) with its
 *     assignments overlapping [from,to], plus a computed overAllocated flag
 *     (sum of allocationPercent across overlapping assignments > 100).
 *   → filtering by assignableType+assignableId instead returns just that
 *     entity's assignments (used by a Project/MO/Job Work detail page's
 *     "Assigned resources" panel) — from/to are optional in that mode.
 *
 * POST /api/resources/assignments
 *   → book a resource against a Project/Manufacturing Order/Job Work order.
 */

import { db } from "@/db";
import { resources, resourceAssignments } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, gte, lte, or, isNull, desc } from "drizzle-orm";

const ASSIGNABLE_TYPES = ["project", "manufacturing_order", "job_work_order"] as const;
type AssignableType = (typeof ASSIGNABLE_TYPES)[number];

function overlaps(startA: string, endA: string | null, from: string, to: string) {
  // an open-ended assignment (no endDate) overlaps anything from its start onward
  if (startA > to) return false;
  if (endA && endA < from) return false;
  return true;
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const { searchParams } = new URL(req.url);
  const assignableType = searchParams.get("assignableType");
  const assignableId = searchParams.get("assignableId");

  if (assignableType && assignableId) {
    if (!(ASSIGNABLE_TYPES as readonly string[]).includes(assignableType)) return bad("Invalid assignableType");
    const rows = await db.select().from(resourceAssignments)
      .where(and(eq(resourceAssignments.orgId, orgId!), eq(resourceAssignments.assignableType, assignableType), eq(resourceAssignments.assignableId, assignableId)))
      .orderBy(desc(resourceAssignments.startDate));
    const resourceIds = [...new Set(rows.map(r => r.resourceId))];
    const resRows = resourceIds.length ? await db.select().from(resources).where(eq(resources.orgId, orgId!)) : [];
    const byId = new Map(resRows.filter(r => resourceIds.includes(r.id)).map(r => [r.id, r]));
    return ok(rows.map(r => ({ ...r, resource: byId.get(r.resourceId) ?? null })));
  }

  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to) return bad("from and to date params are required");

  const resourceId = searchParams.get("resourceId");
  const resConds = [eq(resources.orgId, orgId!), eq(resources.status, "active")];
  if (resourceId) resConds.push(eq(resources.id, resourceId));
  const allResources = await db.select().from(resources).where(and(...resConds)).orderBy(resources.name);

  const assignConds = [
    eq(resourceAssignments.orgId, orgId!),
    or(isNull(resourceAssignments.endDate), gte(resourceAssignments.endDate, from)),
    lte(resourceAssignments.startDate, to),
  ];
  const allAssignments = await db.select().from(resourceAssignments).where(and(...assignConds));

  const byResource = new Map<string, typeof allAssignments>();
  for (const a of allAssignments) {
    if (!overlaps(a.startDate as any as string, a.endDate as any as string | null, from, to)) continue;
    const list = byResource.get(a.resourceId) ?? [];
    list.push(a);
    byResource.set(a.resourceId, list);
  }

  const board = allResources.map(r => {
    const assignments = (byResource.get(r.id) ?? []).filter(a => a.status !== "cancelled");
    const totalAllocation = assignments.reduce((s, a) => s + Number(a.allocationPercent), 0);
    return { ...r, assignments, overAllocated: totalAllocation > 100 };
  });

  return ok(board);
}

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const body = await req.json().catch(() => ({}));
  const { resourceId, assignableType, assignableId, startDate, endDate, allocationPercent, notes } = body ?? {};

  if (!resourceId) return bad("resourceId is required");
  if (!(ASSIGNABLE_TYPES as readonly string[]).includes(assignableType)) return bad("assignableType must be one of: " + ASSIGNABLE_TYPES.join(", "));
  if (!assignableId) return bad("assignableId is required");
  if (!startDate) return bad("startDate is required");
  if (endDate && endDate < startDate) return bad("endDate cannot be before startDate");

  const [resource] = await db.select({ id: resources.id }).from(resources).where(and(eq(resources.id, resourceId), eq(resources.orgId, orgId!))).limit(1);
  if (!resource) return bad("Resource not found", 404);

  const [row] = await db.insert(resourceAssignments).values({
    orgId: orgId!,
    resourceId,
    assignableType: assignableType as AssignableType,
    assignableId,
    startDate,
    endDate: endDate || null,
    allocationPercent: allocationPercent != null ? String(allocationPercent) : "100",
    status: "scheduled",
    notes: notes || null,
    createdBy: (session?.user as any)?.id ?? null,
  }).returning();
  return ok(row);
}
