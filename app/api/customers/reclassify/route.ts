import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and, inArray } from "drizzle-orm";

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  const { ids, repId, regionId } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0) return bad("No customers selected");

  const patch: Record<string, any> = {};
  if (repId !== undefined) patch.repId = repId || null;
  if (regionId !== undefined) patch.regionId = regionId || null;
  if (Object.keys(patch).length === 0) return bad("Nothing to update");

  await db.update(customers)
    .set(patch)
    .where(and(eq(customers.orgId, orgId!), inArray(customers.id, ids)));

  return ok({ updated: ids.length });
}
