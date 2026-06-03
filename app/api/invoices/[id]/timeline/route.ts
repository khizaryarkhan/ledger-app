import { db } from "@/db";
import { invoicePromises, invoiceDisputes, invoices, users } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { and, eq, desc } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * GET /api/invoices/[id]/timeline
 * Returns the combined promise + dispute event history for an invoice,
 * newest first, with the entering user's name resolved.
 */
export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  // Confirm the invoice belongs to this org
  const [inv] = await db.select({ id: invoices.id })
    .from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);
  if (!inv) return bad("Invoice not found", 404);

  const promises = await db
    .select({
      id: invoicePromises.id, promiseDate: invoicePromises.promiseDate, amount: invoicePromises.amount,
      source: invoicePromises.source, note: invoicePromises.note, status: invoicePromises.status,
      createdAt: invoicePromises.createdAt, enteredByName: users.name,
    })
    .from(invoicePromises)
    .leftJoin(users, eq(users.id, invoicePromises.enteredBy))
    .where(and(eq(invoicePromises.orgId, orgId!), eq(invoicePromises.invoiceId, params.id)))
    .orderBy(desc(invoicePromises.createdAt));

  const disputes = await db
    .select({
      id: invoiceDisputes.id, category: invoiceDisputes.category, reason: invoiceDisputes.reason,
      source: invoiceDisputes.source, status: invoiceDisputes.status, resolution: invoiceDisputes.resolution,
      resolvedAt: invoiceDisputes.resolvedAt, createdAt: invoiceDisputes.createdAt, raisedByName: users.name,
    })
    .from(invoiceDisputes)
    .leftJoin(users, eq(users.id, invoiceDisputes.raisedBy))
    .where(and(eq(invoiceDisputes.orgId, orgId!), eq(invoiceDisputes.invoiceId, params.id)))
    .orderBy(desc(invoiceDisputes.createdAt));

  return NextResponse.json({ promises, disputes });
}
