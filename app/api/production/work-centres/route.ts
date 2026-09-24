/**
 * GET  /api/production/work-centres  → every work centre with its rates
 * POST /api/production/work-centres  → create { name, code?, labourRate, overheadRate }
 *
 * A work centre is where production work is done, and what an hour of it
 * costs. Master data, so writes are admin-only — like items and BOMs.
 */

import { db } from "@/db";
import { workCentres } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, asc, sql } from "drizzle-orm";
import { rate } from "@/lib/inventory/work-centres";

const s = (v: any, n = 255) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const rows = await db.select().from(workCentres).where(eq(workCentres.orgId, orgId!)).orderBy(asc(workCentres.name));
  return ok(rows.map(r => ({ ...r, labourRate: Number(r.labourRate), overheadRate: Number(r.overheadRate) })));
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const name = s(b?.name, 128);
  if (!name) return bad("Give the work centre a name.");
  const labourRate = rate(b?.labourRate ?? 0), overheadRate = rate(b?.overheadRate ?? 0);
  if (labourRate == null || overheadRate == null) return bad("Rates must be zero or more.");
  const [clash] = await db.select({ id: workCentres.id }).from(workCentres)
    .where(and(eq(workCentres.orgId, orgId!), sql`lower(trim(${workCentres.name})) = ${name.toLowerCase()}`)).limit(1);
  if (clash) return bad(`A work centre called "${name}" already exists.`, 409);
  const [row] = await db.insert(workCentres).values({ orgId: orgId!, name, code: s(b?.code, 32), labourRate, overheadRate }).returning();
  return ok(row);
}
