/**
 * GET /api/payables/diagnose
 * Read-only diagnostic. Reports bill→supplier link health, payment-status
 * breakdown + total outstanding (explains an all-€0 dashboard), and the last
 * AP sync's recorded result/errors. Admin-only. Writes nothing.
 */
import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apBills, apSuppliers, auditEvents } from "@/db/schema";
import { eq, and, isNull, isNotNull, sql, desc } from "drizzle-orm";

export async function GET() {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (role !== "company_admin" && !isSuperAdmin(session)) return bad("Forbidden", 403);

  // ── Link health ────────────────────────────────────────────────────────────
  const [{ count: billsTotal }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(apBills)
    .where(eq(apBills.orgId, orgId!));

  const [{ count: billsUnlinked }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(apBills)
    .where(and(eq(apBills.orgId, orgId!), isNull(apBills.supplierId)));

  const [{ count: suppliersTotal }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(apSuppliers)
    .where(eq(apSuppliers.orgId, orgId!));

  const [{ count: suppliersWithQbo }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(apSuppliers)
    .where(and(eq(apSuppliers.orgId, orgId!), isNotNull(apSuppliers.qboId)));

  // ── Payment-status breakdown + outstanding (explains €0 dashboard) ──────────
  const statusRows = await db
    .select({
      status: apBills.accountingPaymentStatus,
      count: sql<number>`count(*)::int`,
      sumBalance: sql<number>`COALESCE(SUM(${apBills.balance}), 0)`,
      sumTotal: sql<number>`COALESCE(SUM(${apBills.total}), 0)`,
    })
    .from(apBills)
    .where(eq(apBills.orgId, orgId!))
    .groupBy(apBills.accountingPaymentStatus);

  const [{ outstanding }] = await db
    .select({
      outstanding: sql<number>`COALESCE(SUM(CASE WHEN ${apBills.balance} > 0 THEN ${apBills.balance} ELSE 0 END), 0)`,
    })
    .from(apBills)
    .where(eq(apBills.orgId, orgId!));

  const [{ count: billsWithBalance }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(apBills)
    .where(and(eq(apBills.orgId, orgId!), sql`${apBills.balance} > 0`));

  const sampleWithBalance = await db
    .select({
      billNumber: apBills.billNumber,
      balance: apBills.balance,
      total: apBills.total,
      status: apBills.accountingPaymentStatus,
      dueDate: apBills.dueDate,
    })
    .from(apBills)
    .where(and(eq(apBills.orgId, orgId!), sql`${apBills.balance} > 0`))
    .orderBy(desc(apBills.balance))
    .limit(10);

  // ── Last AP sync result (errors recorded during the sync) ───────────────────
  const [lastSync] = await db
    .select({ occurredAt: auditEvents.occurredAt, meta: auditEvents.meta, actorName: auditEvents.actorName })
    .from(auditEvents)
    .where(and(eq(auditEvents.orgId, orgId!), eq(auditEvents.eventType, "payables_master_data_synced")))
    .orderBy(desc(auditEvents.occurredAt))
    .limit(1);

  return ok({
    linkHealth: {
      billsTotal,
      billsUnlinked,
      billsLinked: billsTotal - billsUnlinked,
      suppliersTotal,
      suppliersWithQbo,
    },
    payments: {
      byStatus: statusRows,
      totalOutstanding: outstanding,
      billsWithBalance,
      sampleWithBalance,
      note:
        "If totalOutstanding is 0 and billsWithBalance is 0, the dashboard showing €0 is CORRECT " +
        "(all bills are fully paid). The dashboard only counts Unpaid/Partially Paid bills.",
    },
    lastSync: lastSync
      ? { occurredAt: lastSync.occurredAt, actorName: lastSync.actorName, meta: lastSync.meta }
      : null,
  });
}
