/**
 * GET /api/resources/cost-report?from=&to=[&groupBy=assignable|resource|month][&assignableType=&assignableId=]
 *   -> cost (hours x resource cost rate) of time entries in the range,
 *      split approved / posted / pending, with unrated-hours warning.
 *      Rejected entries are ignored. Org-scoped and module-gated.
 */

import { db } from "@/db";
import { resources, timeEntries, projects, manufacturingOrders, jobWorkOrders } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isAdminRole } from "@/lib/resources/access";
import { and, eq, gte, lte, inArray } from "drizzle-orm";
import { computeCostSummary, type CostGroupBy, type CostBucket } from "@/lib/resources/cost";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GROUPS: CostGroupBy[] = ["assignable", "resource", "month"];
const COUNTED_STATUSES = ["draft", "submitted", "approved", "posted"];

export async function GET(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  const groupBy = (searchParams.get("groupBy") ?? "assignable") as CostGroupBy;
  const assignableType = searchParams.get("assignableType");
  const assignableId = searchParams.get("assignableId");
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) return bad("from and to (YYYY-MM-DD) are required");
  if (!GROUPS.includes(groupBy)) return bad("groupBy must be assignable, resource or month");
  // Org admins only, every grouping: on a project or month that one person
  // worked, cost / hours is that person's pay rate just as surely as the
  // per-person split is.
  if (!isAdminRole(role)) return bad("Only organisation admins can see labour cost", 403);

  const conds = [
    eq(timeEntries.orgId, orgId!),
    gte(timeEntries.date, from), lte(timeEntries.date, to),
    inArray(timeEntries.status, COUNTED_STATUSES),
  ];
  if (assignableType && assignableId) {
    conds.push(eq(timeEntries.assignableType, assignableType), eq(timeEntries.assignableId, assignableId));
  }

  const [entries, resourceRows] = await Promise.all([
    db.select().from(timeEntries).where(and(...conds)),
    db.select({ id: resources.id, name: resources.name, costRatePerHour: resources.costRatePerHour })
      .from(resources).where(eq(resources.orgId, orgId!)),
  ]);

  const costResources = resourceRows.map(r => ({
    id: r.id, name: r.name,
    costRate: r.costRatePerHour == null || r.costRatePerHour === "" ? null : Number(r.costRatePerHour),
  }));
  const summary = computeCostSummary(
    entries.map(e => ({
      resourceId: e.resourceId, date: e.date, hours: Number(e.hours) || 0, status: e.status,
      assignableType: e.assignableType, assignableId: e.assignableId,
    })),
    costResources, groupBy, from, to,
  );

  const idsOf = (type: string) => [...new Set(summary.buckets.filter(b => b.assignableType === type && b.assignableId).map(b => b.assignableId!))];
  const projectIds = groupBy === "assignable" ? idsOf("project") : [];
  const moIds = groupBy === "assignable" ? idsOf("manufacturing_order") : [];
  const jwIds = groupBy === "assignable" ? idsOf("job_work_order") : [];
  const [projRows, moRows, jwRows] = await Promise.all([
    projectIds.length ? db.select({ id: projects.id, name: projects.name, code: projects.code }).from(projects).where(and(eq(projects.orgId, orgId!), inArray(projects.id, projectIds))) : [],
    moIds.length ? db.select({ id: manufacturingOrders.id, moNo: manufacturingOrders.moNo }).from(manufacturingOrders).where(and(eq(manufacturingOrders.orgId, orgId!), inArray(manufacturingOrders.id, moIds))) : [],
    jwIds.length ? db.select({ id: jobWorkOrders.id, docNumber: jobWorkOrders.docNumber }).from(jobWorkOrders).where(and(eq(jobWorkOrders.orgId, orgId!), inArray(jobWorkOrders.id, jwIds))) : [],
  ]);
  const projById = new Map((projRows as { id: string; name: string; code: string }[]).map(p => [p.id, p] as const));
  const moById = new Map((moRows as { id: string; moNo: string | null }[]).map(m => [m.id, m] as const));
  const jwById = new Map((jwRows as { id: string; docNumber: string | null }[]).map(j => [j.id, j] as const));
  const nameById = new Map(costResources.map(r => [r.id, r]));

  const labelOf = (b: CostBucket): { label: string; sublabel: string | null; noRate?: boolean } => {
    if (groupBy === "month") return { label: b.key, sublabel: null };
    if (groupBy === "resource") {
      const r = nameById.get(b.key);
      return { label: r?.name ?? "Unknown resource", sublabel: null, noRate: r ? r.costRate == null : false };
    }
    if (b.assignableType === "project") {
      const p = projById.get(b.assignableId!);
      return { label: p ? `${p.code} · ${p.name}` : "Unknown project", sublabel: "Project" };
    }
    if (b.assignableType === "manufacturing_order") {
      const m = moById.get(b.assignableId!);
      return { label: m?.moNo ?? "Manufacturing order", sublabel: "Manufacturing order" };
    }
    if (b.assignableType === "job_work_order") {
      const j = jwById.get(b.assignableId!);
      return { label: j?.docNumber ?? "Job work order", sublabel: "Job work order" };
    }
    return { label: "Not assigned", sublabel: null };
  };

  return ok({
    from, to, groupBy,
    rows: summary.buckets.map(b => ({ ...b, ...labelOf(b) })),
    totals: summary.totals,
    unratedHours: summary.unratedHours,
    unratedResources: summary.unratedResourceIds.map(id => ({ id, name: nameById.get(id)?.name ?? "Unknown" })),
  });
}
