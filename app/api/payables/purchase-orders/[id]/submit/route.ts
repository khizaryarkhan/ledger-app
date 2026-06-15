import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { purchaseOrders, apApprovals } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { logEvent } from "@/lib/audit";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const [po] = await db.select().from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, params.id), eq(purchaseOrders.orgId, orgId!)))
    .limit(1);
  if (!po) return bad("Purchase order not found", 404);

  if (po.status !== "Draft") {
    return bad("Only Draft purchase orders can be submitted", 400);
  }

  const [updated] = await db.update(purchaseOrders)
    .set({ status: "Pending Approval", approvalStatus: "Pending", updatedAt: new Date() })
    .where(and(eq(purchaseOrders.id, params.id), eq(purchaseOrders.orgId, orgId!)))
    .returning();

  await db.insert(apApprovals).values({
    orgId:      orgId!,
    entityType: "purchase_order",
    entityId:   params.id,
    stepNumber: 1,
    status:     "Pending",
  });

  const actorId   = (session?.user as any)?.id   ?? null;
  const actorName = (session?.user as any)?.name ?? null;

  await logEvent({
    orgId: orgId!,
    eventType: "purchase_order_submitted" as any,
    actorId,
    actorName,
    meta: { poNumber: po.poNumber },
  });

  return ok(updated);
}
