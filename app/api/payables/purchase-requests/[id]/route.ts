import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { purchaseRequests } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const UpdateSchema = z.object({
  title:                 z.string().min(1).max(500).optional(),
  description:           z.string().optional().nullable(),
  businessJustification: z.string().optional().nullable(),
  supplierId:            z.string().uuid().optional().nullable(),
  requiredByDate:        z.string().optional().nullable(),
  currency:              z.string().max(8).optional(),
  estimatedTotal:        z.number().optional().nullable(),
  notes:                 z.string().optional().nullable(),
  departmentId:          z.string().optional().nullable(),
  projectId:             z.string().optional().nullable(),
  costCentreId:          z.string().optional().nullable(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [pr] = await db.select().from(purchaseRequests)
    .where(and(eq(purchaseRequests.id, params.id), eq(purchaseRequests.orgId, orgId!)))
    .limit(1);
  if (!pr) return bad("Purchase request not found", 404);
  return ok(pr);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  const [existing] = await db.select().from(purchaseRequests)
    .where(and(eq(purchaseRequests.id, params.id), eq(purchaseRequests.orgId, orgId!)))
    .limit(1);
  if (!existing) return bad("Purchase request not found", 404);
  if (existing.status !== "Draft") return bad("Only Draft purchase requests can be edited", 400);

  try {
    const data = UpdateSchema.parse(await req.json());
    const [updated] = await db.update(purchaseRequests)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(purchaseRequests.id, params.id), eq(purchaseRequests.orgId, orgId!)))
      .returning();
    return ok(updated);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to update purchase request", 500);
  }
}
