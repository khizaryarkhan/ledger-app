import { db } from "@/db";
import { projects, customers } from "@/db/schema";
import { requireOrg, ok, bad, ownsInOrg } from "@/lib/api";
import { eq, and } from "drizzle-orm";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const body = await req.json();
  // Allowlist editable columns — never let the client rewrite id/orgId/createdAt
  // or sync-derived fields (qboId/xeroId) via a blind spread of the loaded row
  // (the edit modal round-trips the whole loaded project as its form state).
  const EDITABLE = ["customerId", "name", "code", "ownerId", "status", "repId"] as const;
  const set: Record<string, any> = {};
  for (const k of EDITABLE) if (k in body) set[k] = body[k];
  // The new customer must belong to this org — don't let a project get reassigned
  // to another tenant's customer via this route.
  if (set.customerId && !(await ownsInOrg(customers, set.customerId, orgId!))) {
    return bad("Customer not found in this organisation", 404);
  }
  const [updated] = await db.update(projects).set(set).where(and(eq(projects.id, params.id), eq(projects.orgId, orgId!))).returning();
  if (!updated) return bad("Not found", 404);
  return ok(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  await db.delete(projects).where(and(eq(projects.id, params.id), eq(projects.orgId, orgId!)));
  return ok({ ok: true });
}
