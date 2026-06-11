import { db } from "@/db";
import {
  invoicePromises, invoiceDisputes, invoices, customers, projects, users,
  reps as repsTable,
} from "@/db/schema";
import { requireOrg } from "@/lib/api";
import { and, eq, desc, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { NextResponse } from "next/server";

/**
 * GET /api/responses
 * Aggregated customer responses (promises + disputes) across the user's
 * visible portfolio. Powers the Customer Responses inbox, dashboard widgets,
 * and the sidebar count badge.
 *
 * Visibility: admins/accountants see everything; reps see only invoices owned
 * by them or their direct reports (invoice → project.repId, else customer.repId).
 */
export async function GET(_req: Request, _ctx?: any) {
  const { error, orgId, role, repId } = await requireOrg();
  if (error) return error;

  // Build visible rep set — null = unrestricted (admin/accountant)
  let visibleRepIds: Set<string> | null = null;
  if (role === "rep" && repId) {
    const reports = await db.select({ id: repsTable.id }).from(repsTable)
      .where(and(eq(repsTable.orgId, orgId!), eq(repsTable.managerId, repId)));
    visibleRepIds = new Set([repId, ...reports.map(r => r.id)]);
  }

  const inScope = (projectRepId: string | null, customerRepId: string | null) => {
    if (!visibleRepIds) return true;
    const owner = projectRepId ?? customerRepId;
    return owner != null && visibleRepIds.has(owner);
  };

  // ── Disputes ──
  const assignee = alias(users, "assignee");
  const disputeRows = await db
    .select({
      id: invoiceDisputes.id, invoiceId: invoiceDisputes.invoiceId,
      category: invoiceDisputes.category, reason: invoiceDisputes.reason,
      source: invoiceDisputes.source, status: invoiceDisputes.status,
      outcome: invoiceDisputes.outcome, assignedTo: invoiceDisputes.assignedTo,
      resolution: invoiceDisputes.resolution, createdAt: invoiceDisputes.createdAt,
      invoiceNumber: invoices.invoiceNumber, currency: invoices.currency,
      customerName: customers.name, customerRepId: customers.repId,
      projectName: projects.name, projectRepId: projects.repId,
      raisedByName: users.name, assignedToName: assignee.name,
    })
    .from(invoiceDisputes)
    .leftJoin(invoices, eq(invoices.id, invoiceDisputes.invoiceId))
    .leftJoin(customers, eq(customers.id, invoiceDisputes.customerId))
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .leftJoin(users, eq(users.id, invoiceDisputes.raisedBy))
    .leftJoin(assignee, eq(assignee.id, invoiceDisputes.assignedTo))
    .where(eq(invoiceDisputes.orgId, orgId!))
    .orderBy(desc(invoiceDisputes.createdAt));

  const disputes = disputeRows
    .filter(d => inScope(d.projectRepId as any, d.customerRepId as any))
    .map(d => ({
      id: d.id, invoiceId: d.invoiceId, invoiceNumber: d.invoiceNumber,
      customerName: d.customerName, projectName: d.projectName,
      category: d.category, reason: d.reason, source: d.source, status: d.status,
      outcome: d.outcome, assignedTo: d.assignedTo,
      resolution: d.resolution, createdAt: d.createdAt, raisedByName: d.raisedByName,
      assignedToName: d.assignedToName,
    }));

  // ── Promises ──
  const todayStr = new Date().toISOString().slice(0, 10);
  const promiseRows = await db
    .select({
      id: invoicePromises.id, invoiceId: invoicePromises.invoiceId,
      promiseDate: invoicePromises.promiseDate, amount: invoicePromises.amount,
      source: invoicePromises.source, status: invoicePromises.status,
      note: invoicePromises.note, createdAt: invoicePromises.createdAt,
      invoiceNumber: invoices.invoiceNumber, currency: invoices.currency,
      paymentStatus: invoices.paymentStatus,
      customerName: customers.name, customerRepId: customers.repId,
      projectName: projects.name, projectRepId: projects.repId,
      enteredByName: users.name,
    })
    .from(invoicePromises)
    .leftJoin(invoices, eq(invoices.id, invoicePromises.invoiceId))
    .leftJoin(customers, eq(customers.id, invoicePromises.customerId))
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .leftJoin(users, eq(users.id, invoicePromises.enteredBy))
    .where(eq(invoicePromises.orgId, orgId!))
    .orderBy(desc(invoicePromises.createdAt));

  const promises = promiseRows
    .filter(p => inScope(p.projectRepId as any, p.customerRepId as any))
    .map(p => ({
      id: p.id, invoiceId: p.invoiceId, invoiceNumber: p.invoiceNumber,
      customerName: p.customerName, projectName: p.projectName,
      promiseDate: p.promiseDate, amount: p.amount, currency: p.currency || "EUR",
      source: p.source, status: p.status, note: p.note, createdAt: p.createdAt,
      enteredByName: p.enteredByName,
      // Derived: an active promise whose date has passed and invoice still open
      isBroken: p.status === "Active" && p.promiseDate < todayStr && p.paymentStatus !== "Paid",
    }));

  const openDisputes   = disputes.filter(d => d.status === "Open" || d.status === "Under Review").length;
  const activePromises = promises.filter(p => p.status === "Active" && !p.isBroken).length;
  const brokenPromises = promises.filter(p => p.isBroken).length;

  // ── Invoices without a secured promise ──
  // Overdue, open invoices that have no active promise on them — the gap we need to chase.
  const activePromisedInvIds = new Set(
    promises.filter(p => p.status === "Active" && !p.isBroken).map(p => p.invoiceId)
  );

  const overdueRows = await db
    .select({
      id: invoices.id,
      currency: invoices.currency,
      qboBalance: invoices.qboBalance,
      xeroBalance: invoices.xeroBalance,
      total: invoices.total,
      paid: invoices.paid,
      customerRepId: customers.repId,
      projectRepId: projects.repId,
    })
    .from(invoices)
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .where(and(
      eq(invoices.orgId, orgId!),
      ne(invoices.paymentStatus, "Paid"),
      sql`${invoices.dueDate} < ${todayStr}`,
    ));

  const unpromisedOverdue = overdueRows.filter(i =>
    !activePromisedInvIds.has(i.id) &&
    inScope(i.projectRepId as any, i.customerRepId as any)
  );

  // Build per-currency totals for the unpromised invoices
  const unpromisedByCcy: Record<string, number> = {};
  for (const i of unpromisedOverdue) {
    const bal = i.qboBalance ?? i.xeroBalance ?? Math.max(0, (i.total ?? 0) - (i.paid ?? 0));
    const ccy = i.currency || "USD";
    unpromisedByCcy[ccy] = (unpromisedByCcy[ccy] || 0) + bal;
  }

  return NextResponse.json({
    disputes, promises,
    counts: {
      needsAttention: openDisputes + brokenPromises,
      openDisputes, activePromises, brokenPromises,
      unpromisedOverdueCount: unpromisedOverdue.length,
      unpromisedByCcy,
    },
  });
}
