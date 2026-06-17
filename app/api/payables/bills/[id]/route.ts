import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apBills, apBillLines, apSuppliers, apSupplierQueries, apApprovals } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const UpdateSchema = z.object({
  workflowStatus:      z.string().max(64).optional(),
  assignedApproverId:  z.string().uuid().optional().nullable(),
  approverEmail:       z.string().email().max(256).optional().nullable(),
  notes:               z.string().optional().nullable(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [bill] = await db.select().from(apBills)
    .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)))
    .limit(1);
  if (!bill) return bad("Bill not found", 404);

  const lines = await db.select().from(apBillLines)
    .where(eq(apBillLines.billId, params.id))
    .orderBy(apBillLines.lineNumber);

  let supplier = null;
  if (bill.supplierId) {
    const [s] = await db.select().from(apSuppliers)
      .where(and(eq(apSuppliers.id, bill.supplierId), eq(apSuppliers.orgId, orgId!)))
      .limit(1);
    supplier = s ?? null;
  }

  const openQueries = await db.select().from(apSupplierQueries)
    .where(and(eq(apSupplierQueries.billId, params.id), eq(apSupplierQueries.orgId, orgId!)));

  const approvalHistory = await db.select().from(apApprovals)
    .where(and(
      eq(apApprovals.entityId, params.id),
      eq(apApprovals.entityType, "bill"),
      eq(apApprovals.orgId, orgId!),
    ))
    .orderBy(desc(apApprovals.createdAt));

  return ok({ ...bill, lines, supplier, openQueries, approvalHistory });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [existing] = await db.select().from(apBills)
    .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)))
    .limit(1);
  if (!existing) return bad("Bill not found", 404);

  try {
    const data = UpdateSchema.parse(await req.json());
    const [updated] = await db.update(apBills)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)))
      .returning();
    return ok(updated);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to update bill", 500);
  }
}
