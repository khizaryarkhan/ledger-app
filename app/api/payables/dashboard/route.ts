import { requireOrg, ok } from "@/lib/api";
import { db } from "@/db";
import {
  apBills,
  apSuppliers,
  apApprovals,
  purchaseOrders,
  auditEvents,
} from "@/db/schema";
import { eq, and, inArray, desc } from "drizzle-orm";

// ── Activity mapping ──────────────────────────────────────────────────────────

function activityType(eventType: string): "sync" | "approval" | "payment" | "hold" | "query" {
  if (eventType.includes("synced")) return "sync";
  if (eventType.includes("payment")) return "payment";
  if (eventType.includes("on_hold")) return "hold";
  if (eventType.includes("query")) return "query";
  return "approval";
}

function activityDescription(eventType: string, actorName: string | null): string {
  const label = eventType
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
  return actorName ? `${label} by ${actorName}` : label;
}

export async function GET(_req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const actorId = (session?.user as any)?.id ?? null;
  const today = new Date().toISOString().split("T")[0];

  const endOfWeek = new Date();
  endOfWeek.setDate(endOfWeek.getDate() + 7);
  const endOfWeekStr = endOfWeek.toISOString().split("T")[0];

  // ── Bills (unpaid) joined to supplier names ──────────────────────────────
  const bills = await db
    .select({
      id: apBills.id,
      supplierName: apSuppliers.name,
      billNumber: apBills.billNumber,
      dueDate: apBills.dueDate,
      balance: apBills.balance,
      currency: apBills.currency,
      workflowStatus: apBills.workflowStatus,
    })
    .from(apBills)
    .leftJoin(apSuppliers, eq(apBills.supplierId, apSuppliers.id))
    .where(and(eq(apBills.orgId, orgId!), inArray(apBills.accountingPaymentStatus, ["Unpaid", "Partially Paid"])));

  // ── Stats accumulators ────────────────────────────────────────────────────
  let totalPayables = 0;
  let dueThisWeek = 0,
    dueThisWeekCount = 0;
  let overdueBills = 0,
    overdueBillsCount = 0;
  let pendingApproval = 0,
    pendingApprovalCount = 0;
  let billsOnHold = 0,
    billsOnHoldCount = 0;
  let readyForPayment = 0,
    readyForPaymentCount = 0;

  const currencyTally: Record<string, number> = {};
  const aging: {
    id: string;
    supplierName: string;
    billNumber: string;
    dueDate: string;
    balance: number;
    currency: string;
    agingBucket: "Current" | "1-30" | "31-60" | "61-90" | "90+";
  }[] = [];

  for (const bill of bills) {
    const balance = Number(bill.balance) || 0;
    totalPayables += balance;
    currencyTally[bill.currency] = (currencyTally[bill.currency] ?? 0) + 1;

    if (bill.workflowStatus === "Pending Approval") {
      pendingApproval += balance;
      pendingApprovalCount++;
    }
    if (bill.workflowStatus === "On Hold") {
      billsOnHold += balance;
      billsOnHoldCount++;
    }
    if (bill.workflowStatus === "Ready for Payment") {
      readyForPayment += balance;
      readyForPaymentCount++;
    }

    let bucket: "Current" | "1-30" | "31-60" | "61-90" | "90+" = "Current";
    if (bill.dueDate && bill.dueDate < today) {
      overdueBills += balance;
      overdueBillsCount++;
      const daysPast = Math.floor(
        (Date.now() - new Date(bill.dueDate).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysPast <= 30) bucket = "1-30";
      else if (daysPast <= 60) bucket = "31-60";
      else if (daysPast <= 90) bucket = "61-90";
      else bucket = "90+";
    } else if (bill.dueDate && bill.dueDate <= endOfWeekStr) {
      dueThisWeek += balance;
      dueThisWeekCount++;
    }

    if (balance > 0) {
      aging.push({
        id: bill.id,
        supplierName: bill.supplierName ?? "Unknown",
        billNumber: bill.billNumber ?? "—",
        dueDate: bill.dueDate ?? "",
        balance,
        currency: bill.currency,
        agingBucket: bucket,
      });
    }
  }

  // Sort aging worst-first (most overdue), keep the table focused
  const bucketOrder = { "90+": 0, "61-90": 1, "31-60": 2, "1-30": 3, Current: 4 };
  aging.sort((a, b) => bucketOrder[a.agingBucket] - bucketOrder[b.agingBucket] || b.balance - a.balance);

  const currency =
    Object.entries(currencyTally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "EUR";

  // ── My approval tasks (bills + POs assigned to me, still pending) ─────────
  let approvalTasks: any[] = [];
  if (actorId) {
    const pending = await db
      .select({
        id: apApprovals.id,
        entityType: apApprovals.entityType,
        entityId: apApprovals.entityId,
        createdAt: apApprovals.createdAt,
      })
      .from(apApprovals)
      .where(
        and(
          eq(apApprovals.orgId, orgId!),
          eq(apApprovals.status, "Pending"),
          eq(apApprovals.approverUserId, actorId)
        )
      )
      .orderBy(desc(apApprovals.createdAt))
      .limit(20);

    const billIds = pending.filter((p) => p.entityType === "bill").map((p) => p.entityId);
    const poIds = pending.filter((p) => p.entityType === "purchase_order").map((p) => p.entityId);

    const billMap = new Map<string, any>();
    if (billIds.length) {
      const rows = await db
        .select({
          id: apBills.id,
          billNumber: apBills.billNumber,
          supplierName: apSuppliers.name,
          total: apBills.total,
          balance: apBills.balance,
          currency: apBills.currency,
          dueDate: apBills.dueDate,
        })
        .from(apBills)
        .leftJoin(apSuppliers, eq(apBills.supplierId, apSuppliers.id))
        .where(and(eq(apBills.orgId, orgId!), inArray(apBills.id, billIds)));
      rows.forEach((r) => billMap.set(r.id, r));
    }

    const poMap = new Map<string, any>();
    if (poIds.length) {
      const rows = await db
        .select({
          id: purchaseOrders.id,
          poNumber: purchaseOrders.poNumber,
          supplierName: apSuppliers.name,
          total: purchaseOrders.total,
          currency: purchaseOrders.currency,
          expectedDeliveryDate: purchaseOrders.expectedDeliveryDate,
        })
        .from(purchaseOrders)
        .leftJoin(apSuppliers, eq(purchaseOrders.supplierId, apSuppliers.id))
        .where(and(eq(purchaseOrders.orgId, orgId!), inArray(purchaseOrders.id, poIds)));
      rows.forEach((r) => poMap.set(r.id, r));
    }

    approvalTasks = pending
      .map((p) => {
        if (p.entityType === "bill") {
          const b = billMap.get(p.entityId);
          if (!b) return null;
          return {
            id: p.id,
            billNumber: b.billNumber ?? "—",
            supplierName: b.supplierName ?? "Unknown",
            amount: Number(b.balance) || Number(b.total) || 0,
            currency: b.currency,
            dueDate: b.dueDate ?? "",
            assignedAt: p.createdAt,
            type: "bill" as const,
          };
        }
        if (p.entityType === "purchase_order") {
          const po = poMap.get(p.entityId);
          if (!po) return null;
          return {
            id: p.id,
            billNumber: po.poNumber ?? "—",
            supplierName: po.supplierName ?? "Unknown",
            amount: Number(po.total) || 0,
            currency: po.currency,
            dueDate: po.expectedDeliveryDate ?? "",
            assignedAt: p.createdAt,
            type: "po" as const,
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  // ── Recent activity ───────────────────────────────────────────────────────
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

  const events = await db
    .select()
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.orgId, orgId!),
        inArray(auditEvents.eventType, payablesEventTypes)
      )
    )
    .orderBy(desc(auditEvents.occurredAt))
    .limit(20);

  const recentActivity = events.map((e) => ({
    id: e.id,
    description: activityDescription(e.eventType, e.actorName),
    timestamp: e.occurredAt,
    type: activityType(e.eventType),
    actor: e.actorName ?? undefined,
  }));

  return ok({
    stats: {
      totalPayables,
      currency,
      dueThisWeek,
      dueThisWeekCount,
      overdueBills,
      overdueBillsCount,
      pendingApproval,
      pendingApprovalCount,
      billsOnHold,
      billsOnHoldCount,
      readyForPayment,
      readyForPaymentCount,
    },
    aging,
    approvalTasks,
    recentActivity,
  });
}
