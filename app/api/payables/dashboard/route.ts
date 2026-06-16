import { requireOrg, ok } from "@/lib/api";
import { db } from "@/db";
import {
  apBills,
  apSuppliers,
  apApprovals,
  purchaseOrders,
  auditEvents,
} from "@/db/schema";
import { eq, and, inArray, desc, gte } from "drizzle-orm";

// Bills considered "approved to pay" (the AP analog of AR commitments).
const APPROVED_STATUSES = ["Approved", "Ready for Payment", "Scheduled"];

function activityType(eventType: string): "sync" | "approval" | "payment" | "hold" | "query" {
  if (eventType.includes("synced")) return "sync";
  if (eventType.includes("payment")) return "payment";
  if (eventType.includes("on_hold")) return "hold";
  if (eventType.includes("query")) return "query";
  return "approval";
}
function activityDescription(eventType: string, actorName: string | null): string {
  const label = eventType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return actorName ? `${label} by ${actorName}` : label;
}

export async function GET(_req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const actorId = (session?.user as any)?.id ?? null;
  const today = new Date().toISOString().split("T")[0];
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 7);
  const weekEndStr = weekEnd.toISOString().split("T")[0];
  const monthEnd = new Date();
  monthEnd.setDate(monthEnd.getDate() + 30);
  const monthEndStr = monthEnd.toISOString().split("T")[0];

  // ── All unpaid bills (joined to supplier names) ───────────────────────────
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
    .where(
      and(
        eq(apBills.orgId, orgId!),
        inArray(apBills.accountingPaymentStatus, ["Unpaid", "Partially Paid"])
      )
    );

  // ── KPI accumulators ───────────────────────────────────────────────────────
  const totalByCcy: Record<string, number> = {};
  const overdueByCcy: Record<string, number> = {};
  const ccyTally: Record<string, number> = {};
  let openCount = 0;
  let overdueCount = 0;
  let over90 = 0;
  let pendingApproval = 0;
  let pendingApprovalCount = 0;

  // Aging buckets (dominant-ccy sums, like the AR dashboard)
  const aging = { current: 0, b1_30: 0, b31_60: 0, b61_90: 0, b90plus: 0 };

  // Approved-to-Pay band
  const atp = {
    overdue: { amount: 0, count: 0 },
    thisWeek: { amount: 0, count: 0 },
    thisMonth: { amount: 0, count: 0 },
    pipeline: { amount: 0, count: 0 },
  };

  for (const b of bills) {
    const bal = Number(b.balance) || 0;
    if (bal <= 0) continue;
    openCount++;
    totalByCcy[b.currency] = (totalByCcy[b.currency] ?? 0) + bal;
    ccyTally[b.currency] = (ccyTally[b.currency] ?? 0) + 1;

    const overdue = !!b.dueDate && b.dueDate < today;
    if (overdue) {
      overdueCount++;
      overdueByCcy[b.currency] = (overdueByCcy[b.currency] ?? 0) + bal;
      const daysPast = Math.floor((Date.now() - new Date(b.dueDate!).getTime()) / 86400000);
      if (daysPast <= 30) aging.b1_30 += bal;
      else if (daysPast <= 60) aging.b31_60 += bal;
      else if (daysPast <= 90) aging.b61_90 += bal;
      else {
        aging.b90plus += bal;
        over90 += bal;
      }
    } else {
      aging.current += bal;
    }

    if (b.workflowStatus === "Pending Approval") {
      pendingApproval += bal;
      pendingApprovalCount++;
    }

    if (APPROVED_STATUSES.includes(b.workflowStatus)) {
      atp.pipeline.amount += bal;
      atp.pipeline.count++;
      if (overdue) {
        atp.overdue.amount += bal;
        atp.overdue.count++;
      } else if (b.dueDate && b.dueDate <= weekEndStr) {
        atp.thisWeek.amount += bal;
        atp.thisWeek.count++;
      } else if (b.dueDate && b.dueDate <= monthEndStr) {
        atp.thisMonth.amount += bal;
        atp.thisMonth.count++;
      }
    }
  }

  const currency = Object.entries(ccyTally).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "EUR";

  // ── Pending approvals assigned to me (bills + POs) ─────────────────────────
  let approvals: any[] = [];
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
      .limit(25);

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

    approvals = pending
      .map((p) => {
        if (p.entityType === "bill") {
          const b = billMap.get(p.entityId);
          if (!b) return null;
          return {
            id: p.id,
            type: "bill" as const,
            entityId: p.entityId,
            number: b.billNumber ?? "—",
            supplierName: b.supplierName ?? "Unknown",
            amount: Number(b.balance) || Number(b.total) || 0,
            currency: b.currency,
            dueDate: b.dueDate ?? "",
            createdAt: p.createdAt,
          };
        }
        if (p.entityType === "purchase_order") {
          const po = poMap.get(p.entityId);
          if (!po) return null;
          return {
            id: p.id,
            type: "po" as const,
            entityId: p.entityId,
            number: po.poNumber ?? "—",
            supplierName: po.supplierName ?? "Unknown",
            amount: Number(po.total) || 0,
            currency: po.currency,
            dueDate: po.expectedDeliveryDate ?? "",
            createdAt: p.createdAt,
          };
        }
        return null;
      })
      .filter(Boolean);
  }
  const approvalCounts = {
    bills: approvals.filter((a) => a.type === "bill").length,
    pos: approvals.filter((a) => a.type === "po").length,
    totalAmount: approvals.reduce((s, a) => s + (a.amount || 0), 0),
    currency,
  };

  // ── Activity (last 7 days) ──────────────────────────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
  const recentEvents = await db
    .select({
      id: auditEvents.id,
      eventType: auditEvents.eventType,
      actorName: auditEvents.actorName,
      occurredAt: auditEvents.occurredAt,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.orgId, orgId!),
        gte(auditEvents.occurredAt, sevenDaysAgo),
        inArray(auditEvents.eventType, [
          "purchase_request_created",
          "purchase_request_approved",
          "purchase_order_created",
          "purchase_order_approved",
          "purchase_order_pushed",
          "bill_approved",
          "bill_rejected",
          "bill_on_hold",
          "bill_ready_for_payment",
          "payment_run_approved",
          "payment_run_scheduled",
          "payables_master_data_synced",
        ])
      )
    )
    .orderBy(desc(auditEvents.occurredAt))
    .limit(30);

  const activity7d = {
    billsApproved: recentEvents.filter((e) => e.eventType === "bill_approved").length,
    posPushed: recentEvents.filter((e) => e.eventType === "purchase_order_pushed").length,
    paymentRuns: recentEvents.filter(
      (e) => e.eventType === "payment_run_scheduled" || e.eventType === "payment_run_approved"
    ).length,
  };

  const recentActivity = recentEvents.slice(0, 12).map((e) => ({
    id: e.id,
    description: activityDescription(e.eventType, e.actorName),
    timestamp: e.occurredAt,
    type: activityType(e.eventType),
    actor: e.actorName ?? undefined,
  }));

  return ok({
    asOf: today,
    currency,
    kpis: {
      totalByCcy,
      openCount,
      overdueByCcy,
      overdueCount,
      over90,
      pendingApproval,
      pendingApprovalCount,
    },
    approvedToPay: { ...atp, currency },
    aging,
    approvals,
    approvalCounts,
    activity7d,
    recentActivity,
  });
}
