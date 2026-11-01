/**
 * GET  /api/resources/designations  → list (any org member with the Resources module)
 * POST /api/resources/designations  → create (organisation admin only)
 *
 * A designation is a person's role; its accessLevel (self | team | all) decides
 * which reports they may open — see lib/resources/access.ts.
 */

import { db } from "@/db";
import { resourceDesignations, resources } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isAdminRole } from "@/lib/resources/access";
import { designationNameKey, parseDesignation } from "@/lib/resources/people-rules";
import { and, asc, eq, sql } from "drizzle-orm";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const rows = await db.select().from(resourceDesignations)
    .where(eq(resourceDesignations.orgId, orgId!))
    .orderBy(asc(resourceDesignations.sortOrder), asc(resourceDesignations.name));

  const counts = await db.select({ designationId: resources.designationId, n: sql<number>`count(*)::int` })
    .from(resources)
    .where(and(eq(resources.orgId, orgId!), eq(resources.type, "person")))
    .groupBy(resources.designationId);
  const byId = new Map(counts.map(c => [c.designationId, c.n]));

  return ok(rows.map(r => ({ ...r, peopleCount: byId.get(r.id) ?? 0 })));
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;
  if (!isAdminRole(role)) return bad("Only organisation admins can manage designations", 403);

  const parsed = parseDesignation(await req.json().catch(() => ({})), false);
  if (!parsed.ok) return bad(parsed.error);
  const v = parsed.value;

  const existing = await db.select({ name: resourceDesignations.name }).from(resourceDesignations)
    .where(eq(resourceDesignations.orgId, orgId!));
  const key = designationNameKey(v.name!);
  if (existing.some(e => designationNameKey(e.name) === key)) return bad(`A designation named "${v.name}" already exists`, 409);

  const [row] = await db.insert(resourceDesignations).values({
    orgId: orgId!,
    name: v.name!,
    accessLevel: v.accessLevel!,
    sortOrder: v.sortOrder!,
    status: v.status!,
  }).returning();
  return ok({ ...row, peopleCount: 0 });
}
