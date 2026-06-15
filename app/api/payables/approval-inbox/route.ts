import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apApprovals, purchaseRequests, purchaseOrders, apBills, paymentRuns, apSuppliers, users } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";

export async function GET(_req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  const actorId    = (session?.user as any)?.id ?? null;
  const isAdmin    = role === "company_admin" || isSuperAdmin(session);

  const conditions: any[] = [
    eq(apApprovals.orgId, orgId!),
    eq(apApprovals.status, "Pending"),
  ];

  if (!isAdmin && actorId) {
    conditions.push(eq(apApprovals.approverUserId, actorId));
  }

  const approvals = await db.select().from(apApprovals)
    .where(and(...conditions))
    .orderBy(desc(apApprovals.createdAt));

  const now = Date.now();

  const enriched = await Promise.all(approvals.map(async (approval) => {
    let entityRef   = "";
    let entityTitle = "";
    let amount: number | null = null;
    let supplierId: string | null = null;
    let entityDetailUrl = "";

    if (approval.entityType === "purchase_request") {
      const [pr] = await db.select().from(purchaseRequests)
        .where(eq(purchaseRequests.id, approval.entityId)).limit(1);
      if (pr) {
        entityRef   = pr.requestNumber;
        entityTitle = pr.title;
        amount      = pr.estimatedTotal ?? null;
        supplierId  = pr.supplierId ?? null;
        entityDetailUrl = `/payables/purchase-requests/${pr.id}`;
      }
    } else if (approval.entityType === "purchase_order") {
      const [po] = await db.select().from(purchaseOrders)
        .where(eq(purchaseOrders.id, approval.entityId)).limit(1);
      if (po) {
        entityRef   = po.poNumber;
        entityTitle = `Purchase Order ${po.poNumber}`;
        amount      = po.total;
        supplierId  = po.supplierId ?? null;
        entityDetailUrl = `/payables/purchase-orders/${po.id}`;
      }
    } else if (approval.entityType === "bill") {
      const [bill] = await db.select().from(apBills)
        .where(eq(apBills.id, approval.entityId)).limit(1);
      if (bill) {
        entityRef   = bill.billNumber ?? bill.id;
        entityTitle = `Bill ${bill.billNumber ?? bill.id}`;
        amount      = bill.total;
        supplierId  = bill.supplierId ?? null;
        entityDetailUrl = `/payables/bills/${bill.id}`;
      }
    } else if (approval.entityType === "payment_run") {
      const [run] = await db.select().from(paymentRuns)
        .where(eq(paymentRuns.id, approval.entityId)).limit(1);
      if (run) {
        entityRef   = run.runNumber;
        entityTitle = `Payment Run ${run.runNumber}`;
        amount      = run.totalAmount;
        entityDetailUrl = `/payables/payment-runs/${run.id}`;
      }
    }

    let supplierName: string | null = null;
    if (supplierId) {
      const [s] = await db.select({ name: apSuppliers.name }).from(apSuppliers)
        .where(and(eq(apSuppliers.id, supplierId), eq(apSuppliers.orgId, orgId!))).limit(1);
      supplierName = s?.name ?? null;
    }

    let requestedBy: string | null = null;
    if (approval.approverUserId) {
      const [u] = await db.select({ name: users.name }).from(users)
        .where(eq(users.id, approval.approverUserId)).limit(1);
      requestedBy = u?.name ?? null;
    }

    const daysWaiting = Math.floor((now - new Date(approval.createdAt).getTime()) / (1000 * 60 * 60 * 24));

    return {
      id:             approval.id,
      entityType:     approval.entityType,
      entityId:       approval.entityId,
      entityRef,
      entityTitle,
      amount,
      supplierName,
      requestedBy,
      daysWaiting,
      entityDetailUrl,
      createdAt:      approval.createdAt,
    };
  }));

  return ok(enriched);
}
