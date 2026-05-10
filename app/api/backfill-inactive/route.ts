/**
 * Backfill: mark customers and projects Inactive when they have no open AR.
 * Safe to re-run. Does not touch records that already have the right status.
 *
 * POST /api/backfill-inactive
 */

import { db } from "@/db";
import { invoices, customers, projects } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, inArray } from "drizzle-orm";

export async function POST() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  try {
    // Load all invoices for this org (just the fields we need)
    const allInvoices = await db
      .select({
        customerId: invoices.customerId,
        projectId: invoices.projectId,
        paymentStatus: invoices.paymentStatus,
        collectionStage: invoices.collectionStage,
        txnType: invoices.txnType,
        qboBalance: invoices.qboBalance,
      })
      .from(invoices)
      .where(eq(invoices.orgId, orgId!));

    // Collect IDs that still have open AR
    const activeCustomerIds = new Set<string>();
    const activeProjectIds  = new Set<string>();
    for (const inv of allInvoices) {
      const isOpen = inv.txnType !== "CreditMemo"
        ? inv.paymentStatus !== "Paid" && inv.collectionStage !== "Closed"
        : (inv.qboBalance ?? 0) < 0; // unapplied credit memo
      if (isOpen) {
        if (inv.customerId) activeCustomerIds.add(inv.customerId);
        if (inv.projectId)  activeProjectIds.add(inv.projectId);
      }
    }

    // Customers with no open AR → Inactive
    const allCustomers = await db
      .select({ id: customers.id, status: customers.status })
      .from(customers)
      .where(eq(customers.orgId, orgId!));

    const customersToDeactivate = allCustomers.filter(
      c => c.status !== "Inactive" && !activeCustomerIds.has(c.id)
    );
    if (customersToDeactivate.length > 0) {
      await db.update(customers)
        .set({ status: "Inactive", updatedAt: new Date() })
        .where(inArray(customers.id, customersToDeactivate.map(c => c.id)));
    }

    // Projects with no open AR → Inactive
    const allProjects = await db
      .select({ id: projects.id, status: projects.status })
      .from(projects)
      .where(eq(projects.orgId, orgId!));

    const projectsToDeactivate = allProjects.filter(
      p => p.status !== "Inactive" && !activeProjectIds.has(p.id)
    );
    if (projectsToDeactivate.length > 0) {
      await db.update(projects)
        .set({ status: "Inactive", updatedAt: new Date() })
        .where(inArray(projects.id, projectsToDeactivate.map(p => p.id)));
    }

    return ok({
      customersDeactivated: customersToDeactivate.length,
      projectsDeactivated: projectsToDeactivate.length,
    });
  } catch (e: any) {
    console.error("Backfill inactive failed:", e);
    return bad(`Backfill failed: ${e.message}`, 500);
  }
}
