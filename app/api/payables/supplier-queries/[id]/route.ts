import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apSupplierQueries } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const UpdateSchema = z.object({
  status:           z.enum(["Open", "Under Review", "Resolved", "Rejected", "Closed"]).optional(),
  resolution:       z.string().optional().nullable(),
  assignedToUserId: z.string().uuid().optional().nullable(),
  reason:           z.string().optional().nullable(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [query] = await db.select().from(apSupplierQueries)
    .where(and(eq(apSupplierQueries.id, params.id), eq(apSupplierQueries.orgId, orgId!)))
    .limit(1);
  if (!query) return bad("Supplier query not found", 404);
  return ok(query);
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  const [existing] = await db.select().from(apSupplierQueries)
    .where(and(eq(apSupplierQueries.id, params.id), eq(apSupplierQueries.orgId, orgId!)))
    .limit(1);
  if (!existing) return bad("Supplier query not found", 404);

  try {
    const data = UpdateSchema.parse(await req.json());
    const actorId = (session?.user as any)?.id ?? null;

    const updateFields: any = { ...data, updatedAt: new Date() };

    if (data.status === "Resolved") {
      updateFields.resolvedByUserId = actorId;
      updateFields.resolvedAt       = new Date();
    }

    const [updated] = await db.update(apSupplierQueries)
      .set(updateFields)
      .where(and(eq(apSupplierQueries.id, params.id), eq(apSupplierQueries.orgId, orgId!)))
      .returning();
    return ok(updated);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to update supplier query", 500);
  }
}
