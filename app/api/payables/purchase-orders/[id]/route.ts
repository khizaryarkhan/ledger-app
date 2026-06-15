import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { purchaseOrders, purchaseOrderLines, apSuppliers } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { z } from "zod";

const LineSchema = z.object({
  lineNumber:         z.number().int().default(1),
  itemId:             z.string().optional().nullable(),
  description:        z.string().optional().nullable(),
  quantity:           z.number().default(1),
  unitPrice:          z.number().default(0),
  accountId:          z.string().optional().nullable(),
  taxRateId:          z.string().optional().nullable(),
  projectId:          z.string().optional().nullable(),
  costCentreId:       z.string().optional().nullable(),
  trackingCategoryId: z.string().optional().nullable(),
  classId:            z.string().optional().nullable(),
  departmentId:       z.string().optional().nullable(),
  lineSubtotal:       z.number().default(0),
  lineTax:            z.number().default(0),
  lineTotal:          z.number().default(0),
});

const UpdateSchema = z.object({
  supplierId:           z.string().uuid().optional().nullable(),
  poDate:               z.string().optional().nullable(),
  expectedDeliveryDate: z.string().optional().nullable(),
  currency:             z.string().max(8).optional(),
  notes:                z.string().optional().nullable(),
  lines:                z.array(LineSchema).optional(),
});

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [po] = await db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, params.id), eq(purchaseOrders.orgId, orgId!)))
    .limit(1);
  if (!po) return bad("Purchase order not found", 404);

  const lines = await db.select().from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.purchaseOrderId, params.id))
    .orderBy(purchaseOrderLines.lineNumber);

  let supplier = null;
  if (po.supplierId) {
    const [s] = await db.select().from(apSuppliers)
      .where(and(eq(apSuppliers.id, po.supplierId), eq(apSuppliers.orgId, orgId!)))
      .limit(1);
    supplier = s ?? null;
  }

  return ok({ ...po, lines, supplier });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [existing] = await db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, params.id), eq(purchaseOrders.orgId, orgId!)))
    .limit(1);
  if (!existing) return bad("Purchase order not found", 404);
  if (existing.status !== "Draft") return bad("Only Draft purchase orders can be edited", 400);

  try {
    const { lines, ...rest } = UpdateSchema.parse(await req.json());

    let subtotal = 0;
    let taxTotal = 0;
    let total    = 0;

    if (lines !== undefined) {
      await db.delete(purchaseOrderLines)
        .where(eq(purchaseOrderLines.purchaseOrderId, params.id));

      if (lines.length > 0) {
        const lineRows = lines.map((l) => {
          const sub = l.lineSubtotal || l.quantity * l.unitPrice;
          const tax = l.lineTax || 0;
          const tot = l.lineTotal || sub + tax;
          subtotal += sub;
          taxTotal += tax;
          total    += tot;
          return {
            orgId:              orgId!,
            purchaseOrderId:    params.id,
            lineNumber:         l.lineNumber,
            itemId:             l.itemId ?? null,
            description:        l.description ?? null,
            quantity:           l.quantity,
            unitPrice:          l.unitPrice,
            accountId:          l.accountId ?? null,
            taxRateId:          l.taxRateId ?? null,
            projectId:          l.projectId ?? null,
            costCentreId:       l.costCentreId ?? null,
            trackingCategoryId: l.trackingCategoryId ?? null,
            classId:            l.classId ?? null,
            departmentId:       l.departmentId ?? null,
            lineSubtotal:       sub,
            lineTax:            tax,
            lineTotal:          tot,
          };
        });
        await db.insert(purchaseOrderLines).values(lineRows);
      }
    }

    const updateFields: any = { ...rest, updatedAt: new Date() };
    if (lines !== undefined) {
      updateFields.subtotal = subtotal;
      updateFields.taxTotal = taxTotal;
      updateFields.total    = total;
    }

    const [updated] = await db.update(purchaseOrders)
      .set(updateFields)
      .where(and(eq(purchaseOrders.id, params.id), eq(purchaseOrders.orgId, orgId!)))
      .returning();

    return ok(updated);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to update purchase order", 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [existing] = await db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, params.id), eq(purchaseOrders.orgId, orgId!)))
    .limit(1);
  if (!existing) return bad("Purchase order not found", 404);
  if (existing.status !== "Draft") return bad("Only Draft purchase orders can be cancelled", 400);

  const [updated] = await db.update(purchaseOrders)
    .set({ status: "Cancelled", updatedAt: new Date() })
    .where(and(eq(purchaseOrders.id, params.id), eq(purchaseOrders.orgId, orgId!)))
    .returning();
  return ok(updated);
}
