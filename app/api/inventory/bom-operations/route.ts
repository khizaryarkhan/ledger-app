/**
 * POST   /api/inventory/bom-operations        → add { bomId, workCentreId, hoursPerBatch, description? }
 * DELETE /api/inventory/bom-operations?id=     → remove one
 *
 * An operation is the TIME a recipe takes at a work centre, per batch. The
 * rate comes from the work centre; an MO copies both when it is planned.
 */

import { db } from "@/db";
import { bomOperations, boms, workCentres } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq } from "drizzle-orm";

async function guard() {
  const { error, orgId, role } = await requireOrg();
  if (error) return { error };
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return { error: modErr };
  if (!["company_admin", "super_admin"].includes(role!)) return { error: bad("Admins only", 403) };
  return { orgId: orgId! };
}

export async function POST(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const b = await req.json().catch(() => ({}));
  const [bom] = await db.select({ id: boms.id }).from(boms).where(and(eq(boms.id, String(b?.bomId)), eq(boms.orgId, g.orgId))).limit(1);
  if (!bom) return bad("BOM not found", 404);
  const [wc] = await db.select({ id: workCentres.id, status: workCentres.status }).from(workCentres).where(and(eq(workCentres.id, String(b?.workCentreId)), eq(workCentres.orgId, g.orgId))).limit(1);
  if (!wc) return bad("Choose a work centre.");
  if (wc.status !== "Active") return bad("That work centre is inactive.");
  const hours = Number(b?.hoursPerBatch);
  if (!Number.isFinite(hours) || hours <= 0) return bad("Enter the hours this takes per batch.");
  const [row] = await db.insert(bomOperations).values({
    orgId: g.orgId, bomId: bom.id, workCentreId: wc.id, hoursPerBatch: (Math.round(hours * 1e6) / 1e6).toString(),
    description: b?.description ? String(b.description).trim().slice(0, 255) || null : null,
    sortOrder: Number.isFinite(Number(b?.sortOrder)) ? Number(b.sortOrder) : 0,
  }).returning();
  return ok(row);
}

export async function DELETE(req: Request) {
  const g = await guard();
  if ("error" in g) return g.error;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("Which operation?");
  await db.delete(bomOperations).where(and(eq(bomOperations.id, id), eq(bomOperations.orgId, g.orgId)));
  return ok({ id, deleted: true });
}
