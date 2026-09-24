/**
 * PATCH  /api/production/work-centres/[id]  → rename, change rates, (de)activate
 * DELETE /api/production/work-centres/[id]  → only if no BOM uses it
 *
 * A rate change applies to orders planned AFTER it: an MO copies the rates
 * when it is created, so an order already in flight keeps the cost it was
 * planned at.
 */

import { db } from "@/db";
import { workCentres, bomOperations } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, ne, sql } from "drizzle-orm";
import { rate } from "@/lib/inventory/work-centres";

const s = (v: any, n = 255) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));

async function guard() {
  const { error, orgId, role } = await requireOrg();
  if (error) return { error };
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return { error: modErr };
  if (!["company_admin", "super_admin"].includes(role!)) return { error: bad("Admins only", 403) };
  return { orgId: orgId! };
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard();
  if ("error" in g) return g.error;
  const b = await req.json().catch(() => ({}));
  const set: Record<string, any> = { updatedAt: new Date() };
  if (b.name !== undefined) {
    const name = s(b.name, 128);
    if (!name) return bad("Give the work centre a name.");
    const [clash] = await db.select({ id: workCentres.id }).from(workCentres)
      .where(and(eq(workCentres.orgId, g.orgId), ne(workCentres.id, params.id), sql`lower(trim(${workCentres.name})) = ${name.toLowerCase()}`)).limit(1);
    if (clash) return bad(`A work centre called "${name}" already exists.`, 409);
    set.name = name;
  }
  if (b.code !== undefined) set.code = s(b.code, 32);
  for (const k of ["labourRate", "overheadRate"] as const) if (b[k] !== undefined) {
    const v = rate(b[k]);
    if (v == null) return bad("Rates must be zero or more.");
    set[k] = v;
  }
  if (b.status !== undefined) set.status = b.status === "Inactive" ? "Inactive" : "Active";
  const [row] = await db.update(workCentres).set(set).where(and(eq(workCentres.id, params.id), eq(workCentres.orgId, g.orgId))).returning();
  if (!row) return bad("Work centre not found", 404);
  return ok(row);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const g = await guard();
  if ("error" in g) return g.error;
  const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(bomOperations)
    .where(and(eq(bomOperations.orgId, g.orgId), eq(bomOperations.workCentreId, params.id)));
  if (Number(used?.n ?? 0) > 0) return bad(`${used!.n} BOM operation${Number(used!.n) === 1 ? " uses" : "s use"} this work centre — remove ${Number(used!.n) === 1 ? "it" : "them"} first, or make it inactive.`, 409);
  await db.delete(workCentres).where(and(eq(workCentres.id, params.id), eq(workCentres.orgId, g.orgId)));
  return ok({ id: params.id, deleted: true });
}
