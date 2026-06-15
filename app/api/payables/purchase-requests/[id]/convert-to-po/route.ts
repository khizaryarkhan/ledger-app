import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { purchaseRequests, purchaseOrders } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { logEvent } from "@/lib/audit";

async function generatePoNumber(orgId: string): Promise<string> {
  const year = new Date().getFullYear();
  const seq  = Date.now().toString().slice(-6);
  return `PO-${year}-${seq}`;
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [pr] = await db.select().from(purchaseRequests)
    .where(and(eq(purchaseRequests.id, params.id), eq(purchaseRequests.orgId, orgId!)))
    .limit(1);
  if (!pr) return bad("Purchase request not found", 404);
  if (pr.status !== "Approved") return bad("Only Approved purchase requests can be converted to a PO", 400);

  const actorId   = (session?.user as any)?.id   ?? null;
  const actorName = (session?.user as any)?.name ?? null;

  const poNumber = await generatePoNumber(orgId!);

  const [po] = await db.insert(purchaseOrders).values({
    orgId:          orgId!,
    poNumber,
    requestId:      params.id,
    supplierId:     pr.supplierId ?? null,
    currency:       pr.currency,
    status:         "Draft",
    approvalStatus: "Pending",
    createdByUserId: actorId,
  }).returning();

  await db.update(purchaseRequests)
    .set({ status: "Converted to PO", updatedAt: new Date() })
    .where(and(eq(purchaseRequests.id, params.id), eq(purchaseRequests.orgId, orgId!)));

  await logEvent({
    orgId: orgId!,
    eventType: "purchase_order_created" as any,
    actorId,
    actorName,
    meta: { poNumber, fromRequestNumber: pr.requestNumber, requestId: params.id },
  });

  return ok(po);
}
