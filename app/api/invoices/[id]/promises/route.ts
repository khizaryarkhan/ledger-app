import { db } from "@/db";
import { invoicePromises, invoices } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { recomputeInvoiceState } from "@/lib/portal";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * POST /api/invoices/[id]/promises
 * Staff logs a promise-to-pay (e.g. relayed by phone). Body:
 *   { promiseDate, amount?, note?, source? }
 * source defaults to "Rep" for rep users, otherwise "Accountant".
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  const [inv] = await db.select({ id: invoices.id, customerId: invoices.customerId })
    .from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);
  if (!inv) return bad("Invoice not found", 404);

  const body = await req.json().catch(() => ({}));
  if (!body.promiseDate) return bad("promiseDate is required");

  const source = body.source || (role === "rep" ? "Rep" : "Accountant");
  const userId = (session!.user as any).id as string;

  await db.insert(invoicePromises).values({
    orgId: orgId!,
    invoiceId: inv.id,
    customerId: inv.customerId,
    promiseDate: String(body.promiseDate).slice(0, 16),
    amount: body.amount != null && !isNaN(Number(body.amount)) ? Number(body.amount) : null,
    source,
    enteredBy: userId,
    note: body.note ? String(body.note).slice(0, 1000) : null,
    status: "Active",
  });

  await recomputeInvoiceState(orgId!, inv.id);
  return NextResponse.json({ ok: true });
}
