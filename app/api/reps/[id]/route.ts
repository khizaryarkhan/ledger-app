import { db } from "@/db";
import { reps } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";

const VALID_TIERS = ["rep", "rd", "ed"];

/** PATCH /api/reps/:id — update tier (and/or name/email) */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  const repId = params.id;
  const body = await req.json();

  const updates: Record<string, any> = {};
  if (body.name !== undefined) {
    if (!body.name?.trim()) return bad("Name cannot be empty");
    updates.name = body.name.trim();
  }
  if (body.email !== undefined) updates.email = body.email?.trim() || null;
  if (body.tier !== undefined) {
    if (!VALID_TIERS.includes(body.tier)) return bad("Invalid tier — must be rep, rd, or ed");
    updates.tier = body.tier;
  }
  if (body.managerId !== undefined) {
    updates.managerId = body.managerId || null;
  }

  if (Object.keys(updates).length === 0) return bad("Nothing to update");

  const [updated] = await db
    .update(reps)
    .set(updates)
    .where(and(eq(reps.id, repId), eq(reps.orgId, orgId!)))
    .returning();

  if (!updated) return bad("Rep not found", 404);
  return ok(updated);
}
