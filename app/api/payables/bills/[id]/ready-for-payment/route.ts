import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apBills, apSupplierQueries } from "@/db/schema";
import { eq, and, ne, or } from "drizzle-orm";
import { logEvent } from "@/lib/audit";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [bill] = await db.select().from(apBills)
    .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)))
    .limit(1);
  if (!bill) return bad("Bill not found", 404);
  if (bill.workflowStatus !== "Approved") {
    return bad("Only Approved bills can be marked Ready for Payment", 400);
  }

  const openQueries = await db.select().from(apSupplierQueries)
    .where(and(
      eq(apSupplierQueries.billId, params.id),
      eq(apSupplierQueries.orgId, orgId!),
      ne(apSupplierQueries.status, "Resolved"),
      ne(apSupplierQueries.status, "Closed"),
    ));

  if (openQueries.length > 0) {
    return bad("Cannot mark ready: open supplier queries must be resolved first", 400);
  }

  const [updated] = await db.update(apBills)
    .set({ workflowStatus: "Ready for Payment", updatedAt: new Date() })
    .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)))
    .returning();

  const actorId   = (session?.user as any)?.id   ?? null;
  const actorName = (session?.user as any)?.name ?? null;

  await logEvent({
    orgId: orgId!,
    eventType: "bill_ready_for_payment" as any,
    actorId,
    actorName,
    meta: { billId: params.id, billNumber: bill.billNumber },
  });

  return ok(updated);
}
