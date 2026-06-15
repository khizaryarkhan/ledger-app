import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apSuppliers, apBills, purchaseOrders, apSupplierQueries } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const UpdateSchema = z.object({
  name:         z.string().min(1).max(255).optional(),
  displayName:  z.string().max(255).optional().nullable(),
  code:         z.string().max(64).optional().nullable(),
  email:        z.string().email().optional().nullable(),
  phone:        z.string().max(64).optional().nullable(),
  address:      z.string().optional().nullable(),
  country:      z.string().max(64).optional().nullable(),
  currency:     z.string().max(8).optional(),
  paymentTerms: z.number().int().optional(),
  taxNumber:    z.string().max(64).optional().nullable(),
  status:       z.enum(["Active", "Inactive", "Suspended"]).optional(),
  riskRating:   z.enum(["Low", "Medium", "High"]).optional(),
  notes:        z.string().optional().nullable(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [supplier] = await db.select().from(apSuppliers)
    .where(and(eq(apSuppliers.id, params.id), eq(apSuppliers.orgId, orgId!)))
    .limit(1);
  if (!supplier) return bad("Supplier not found", 404);

  const allBills = await db.select().from(apBills)
    .where(and(eq(apBills.supplierId, params.id), eq(apBills.orgId, orgId!)))
    .orderBy(desc(apBills.dueDate));

  const allPOs = await db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.supplierId, params.id), eq(purchaseOrders.orgId, orgId!)))
    .orderBy(desc(purchaseOrders.createdAt));

  const allQueries = await db.select().from(apSupplierQueries)
    .where(and(eq(apSupplierQueries.supplierId, params.id), eq(apSupplierQueries.orgId, orgId!)))
    .orderBy(desc(apSupplierQueries.createdAt));

  const totalOutstanding = allBills.reduce((sum, b) => sum + Math.max(0, b.balance ?? 0), 0);
  const openBillsCount = allBills.filter(b => (b.balance ?? 0) > 0).length;
  const openQueriesCount = allQueries.filter(q => q.status !== "Resolved" && q.status !== "Closed").length;

  return ok({
    ...supplier,
    lastSynced: supplier.lastSyncedAt,
    totalOutstanding,
    openBillsCount,
    openQueriesCount,
    bills: allBills,
    purchaseOrders: allPOs,
    queries: allQueries.map(q => ({
      id: q.id,
      subject: q.category + (q.reason ? `: ${(q.reason).slice(0, 80)}` : ""),
      createdAt: q.createdAt,
      status: q.status,
      resolvedAt: q.resolvedAt,
    })),
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [existing] = await db.select().from(apSuppliers)
    .where(and(eq(apSuppliers.id, params.id), eq(apSuppliers.orgId, orgId!)))
    .limit(1);
  if (!existing) return bad("Supplier not found", 404);

  try {
    const data = UpdateSchema.parse(await req.json());
    const [updated] = await db.update(apSuppliers)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(apSuppliers.id, params.id), eq(apSuppliers.orgId, orgId!)))
      .returning();
    return ok(updated);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to update supplier", 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [existing] = await db.select().from(apSuppliers)
    .where(and(eq(apSuppliers.id, params.id), eq(apSuppliers.orgId, orgId!)))
    .limit(1);
  if (!existing) return bad("Supplier not found", 404);

  const [updated] = await db.update(apSuppliers)
    .set({ status: "Inactive", updatedAt: new Date() })
    .where(and(eq(apSuppliers.id, params.id), eq(apSuppliers.orgId, orgId!)))
    .returning();
  return ok(updated);
}
