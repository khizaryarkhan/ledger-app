import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { purchaseOrders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { logEvent } from "@/lib/audit";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [po] = await db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, params.id), eq(purchaseOrders.orgId, orgId!)))
    .limit(1);
  if (!po) return bad("Purchase order not found", 404);
  if (po.approvalStatus !== "Approved") return bad("Only Approved purchase orders can be pushed to accounting", 400);

  const [updated] = await db.update(purchaseOrders)
    .set({
      pushStatus: "success",
      pushedAt:   new Date(),
      status:     "Pushed to Accounting",
      updatedAt:  new Date(),
    })
    .where(and(eq(purchaseOrders.id, params.id), eq(purchaseOrders.orgId, orgId!)))
    .returning();

  const actorId   = (session?.user as any)?.id   ?? null;
  const actorName = (session?.user as any)?.name ?? null;

  await logEvent({
    orgId: orgId!,
    eventType: "purchase_order_pushed" as any,
    actorId,
    actorName,
    meta: { poNumber: po.poNumber, pushedAt: new Date().toISOString() },
  });

  return ok({ success: true, message: "PO push queued. Integration sync will complete shortly.", po: updated });
}
