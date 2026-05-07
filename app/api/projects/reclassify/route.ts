import { db } from "@/db";
import { projects } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and, inArray } from "drizzle-orm";

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  const { ids, repId, regionId } = await req.json();
  if (!Array.isArray(ids) || ids.length === 0) return bad("No projects selected");

  const patch: Record<string, any> = {};
  if (repId !== undefined) patch.repId = repId || null;
  if (regionId !== undefined) patch.regionId = regionId || null;
  if (Object.keys(patch).length === 0) return bad("Nothing to update");

  await db.update(projects)
    .set(patch)
    .where(and(eq(projects.orgId, orgId!), inArray(projects.id, ids)));

  return ok({ updated: ids.length });
}
