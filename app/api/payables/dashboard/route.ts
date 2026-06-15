import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apBills, apApprovals, auditEvents } from "@/db/schema";
import { eq, and, lte, gte, inArray, desc, ne } from "drizzle-orm";

export async function GET(_req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const actorId = (session?.user as any)?.id ?? null;
  const today   = new Date().toISOString().split("T")[0];

  const endOfWeek = new Date();
  endOfWeek.setDate(endOfWeek.getDate() + 7);
  const endOfWeekStr = endOfWeek.toISOString().split("T")[0];

  const allBills = await db.select().from(apBills)
    .where(and(eq(apBills.orgId, orgId!), ne(apBills.accountingPaymentStatus, "Paid")));

  let totalPayables  = 0;
  let dueThisWeek    = 0;
  let overdueBills   = 0;
  let pendingApproval = 0;
  let onHold         = 0;
  let readyForPayment = 0;

  const aging = { current: 0, "1_30": 0, "31_60": 0, "61_90": 0, "90_plus": 0 };

  for (const bill of allBills) {
    totalPayables += bill.balance ?? 0;

    if (bill.workflowStatus === "Pending Approval") pendingApproval++;
    if (bill.workflowStatus === "On Hold")          onHold++;
    if (bill.workflowStatus === "Ready for Payment") readyForPayment++;

    if (bill.dueDate) {
      if (bill.dueDate < today) {
        overdueBills++;
        const daysPast = Math.floor((Date.now() - new Date(bill.dueDate).getTime()) / (1000 * 60 * 60 * 24));
        if (daysPast <= 30)      aging["1_30"]    += bill.balance ?? 0;
        else if (daysPast <= 60) aging["31_60"]   += bill.balance ?? 0;
        else if (daysPast <= 90) aging["61_90"]   += bill.balance ?? 0;
        else                     aging["90_plus"] += bill.balance ?? 0;
      } else {
        aging.current += bill.balance ?? 0;
        if (bill.dueDate <= endOfWeekStr) dueThisWeek++;
      }
    } else {
      aging.current += bill.balance ?? 0;
    }
  }

  const myApprovalConditions: any[] = [
    eq(apApprovals.orgId, orgId!),
    eq(apApprovals.status, "Pending"),
  ];
  if (actorId) myApprovalConditions.push(eq(apApprovals.approverUserId, actorId));

  const myApprovalTasks = actorId
    ? await db.select().from(apApprovals).where(and(...myApprovalConditions)).orderBy(desc(apApprovals.createdAt)).limit(20)
    : [];

  const payablesEventTypes = [
    "purchase_request_created",
    "purchase_request_submitted",
    "purchase_request_approved",
    "purchase_request_rejected",
    "purchase_order_created",
    "purchase_order_submitted",
    "purchase_order_approved",
    "purchase_order_rejected",
    "purchase_order_pushed",
    "bill_approved",
    "bill_rejected",
    "bill_on_hold",
    "bill_ready_for_payment",
    "bill_approval_note_pushed",
    "payment_run_approved",
    "payment_run_scheduled",
    "payables_master_data_synced",
  ];

  const recentActivity = await db.select().from(auditEvents)
    .where(and(
      eq(auditEvents.orgId, orgId!),
      inArray(auditEvents.eventType, payablesEventTypes),
    ))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(20);

  return ok({
    totalPayables,
    dueThisWeek,
    overdueBills,
    pendingApproval,
    onHold,
    readyForPayment,
    agingBuckets: aging,
    myApprovalTasks,
    recentActivity,
  });
}
