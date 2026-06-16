import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { purchaseOrders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { logEvent } from "@/lib/audit";
import { pushPurchaseOrder } from "@/lib/po-push";

export const maxDuration = 60;

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
  if (po.qboId || po.xeroId) return bad("This purchase order has already been pushed to accounting", 400);

  // Actually create the PurchaseOrder in QBO/Xero and persist the external id.
  const result = await pushPurchaseOrder(orgId!, params.id);

  if (!result.ok) {
    return bad(`Failed to push purchase order: ${result.error}`, 502);
  }

  const actorId   = (session?.user as any)?.id   ?? null;
  const actorName = (session?.user as any)?.name ?? null;

  await logEvent({
    orgId: orgId!,
    eventType: "purchase_order_pushed" as any,
    actorId,
    actorName,
    meta: {
      poNumber: po.poNumber,
      provider: result.provider,
      externalId: result.externalId,
      externalDocNumber: result.externalDocNumber,
      pushedAt: new Date().toISOString(),
    },
  });

  const [updated] = await db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, params.id), eq(purchaseOrders.orgId, orgId!)))
    .limit(1);

  return ok({
    success: true,
    message: `Purchase order pushed to ${result.provider === "qbo" ? "QuickBooks" : "Xero"}${result.externalDocNumber ? ` as ${result.externalDocNumber}` : ""}.`,
    po: updated,
  });
}
