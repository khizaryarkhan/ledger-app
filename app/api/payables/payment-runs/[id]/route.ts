import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { paymentRuns, paymentRunItems, apBills, apSuppliers } from "@/db/schema";
import { eq, and, desc, sum, count } from "drizzle-orm";
import { z } from "zod";

const UpdateSchema = z.object({
  scheduledPaymentDate: z.string().optional().nullable(),
  notes:                z.string().optional().nullable(),
  addBillIds:           z.array(z.string().uuid()).optional(),
  removeBillId:         z.string().uuid().optional(),
});

async function recalcTotals(paymentRunId: string, orgId: string) {
  const items = await db.select().from(paymentRunItems)
    .where(and(eq(paymentRunItems.paymentRunId, paymentRunId), eq(paymentRunItems.orgId, orgId)));
  const totalAmount = items.reduce((sum, i) => sum + (i.amount ?? 0), 0);
  const billCount   = items.length;
  await db.update(paymentRuns)
    .set({ totalAmount, billCount, updatedAt: new Date() })
    .where(and(eq(paymentRuns.id, paymentRunId), eq(paymentRuns.orgId, orgId)));
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [run] = await db.select().from(paymentRuns)
    .where(and(eq(paymentRuns.id, params.id), eq(paymentRuns.orgId, orgId!)))
    .limit(1);
  if (!run) return bad("Payment run not found", 404);

  const items = await db.select().from(paymentRunItems)
    .where(and(eq(paymentRunItems.paymentRunId, params.id), eq(paymentRunItems.orgId, orgId!)));

  const enrichedItems = await Promise.all(items.map(async (item) => {
    const [bill] = await db.select().from(apBills)
      .where(eq(apBills.id, item.billId)).limit(1);
    let supplier = null;
    if (item.supplierId) {
      const [s] = await db.select().from(apSuppliers)
        .where(and(eq(apSuppliers.id, item.supplierId), eq(apSuppliers.orgId, orgId!))).limit(1);
      supplier = s ?? null;
    }
    return { ...item, bill: bill ?? null, supplier };
  }));

  return ok({ ...run, items: enrichedItems });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [existing] = await db.select().from(paymentRuns)
    .where(and(eq(paymentRuns.id, params.id), eq(paymentRuns.orgId, orgId!)))
    .limit(1);
  if (!existing) return bad("Payment run not found", 404);
  if (existing.status !== "Draft") return bad("Only Draft payment runs can be modified", 400);

  try {
    const { addBillIds, removeBillId, ...rest } = UpdateSchema.parse(await req.json());

    if (addBillIds && addBillIds.length > 0) {
      for (const billId of addBillIds) {
        const [bill] = await db.select().from(apBills)
          .where(and(eq(apBills.id, billId), eq(apBills.orgId, orgId!))).limit(1);
        if (!bill) continue;
        const [existingItem] = await db.select().from(paymentRunItems)
          .where(and(
            eq(paymentRunItems.paymentRunId, params.id),
            eq(paymentRunItems.billId, billId),
          )).limit(1);
        if (existingItem) continue;
        await db.insert(paymentRunItems).values({
          orgId:         orgId!,
          paymentRunId:  params.id,
          billId,
          supplierId:    bill.supplierId ?? null,
          amount:        bill.balance,
          currency:      bill.currency,
          dueDate:       bill.dueDate ?? null,
          status:        "Pending",
        });
      }
    }

    if (removeBillId) {
      await db.delete(paymentRunItems)
        .where(and(
          eq(paymentRunItems.paymentRunId, params.id),
          eq(paymentRunItems.billId, removeBillId),
        ));
    }

    await recalcTotals(params.id, orgId!);

    const updateFields: any = { updatedAt: new Date() };
    if (rest.scheduledPaymentDate !== undefined) updateFields.scheduledPaymentDate = rest.scheduledPaymentDate;
    if (rest.notes !== undefined) updateFields.notes = rest.notes;

    const [updated] = await db.update(paymentRuns)
      .set(updateFields)
      .where(and(eq(paymentRuns.id, params.id), eq(paymentRuns.orgId, orgId!)))
      .returning();

    return ok(updated);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to update payment run", 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [existing] = await db.select().from(paymentRuns)
    .where(and(eq(paymentRuns.id, params.id), eq(paymentRuns.orgId, orgId!)))
    .limit(1);
  if (!existing) return bad("Payment run not found", 404);
  if (existing.status !== "Draft" && existing.status !== "Pending Approval") {
    return bad("Only Draft or Pending Approval payment runs can be cancelled", 400);
  }

  const [updated] = await db.update(paymentRuns)
    .set({ status: "Cancelled", updatedAt: new Date() })
    .where(and(eq(paymentRuns.id, params.id), eq(paymentRuns.orgId, orgId!)))
    .returning();
  return ok(updated);
}
