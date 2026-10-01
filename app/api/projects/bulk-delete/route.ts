import { db } from "@/db";
import { projects } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { inArray, eq, and } from "drizzle-orm";

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  try {
    const { ids } = await req.json();
    if (!Array.isArray(ids) || ids.length === 0) return bad("No project IDs provided");
    await db.delete(projects).where(and(inArray(projects.id, ids), eq(projects.orgId, orgId!)));
    return ok({ deleted: ids.length });
  } catch (e: any) {
    return bad("Failed to delete projects", 500);
  }
}
