import { db } from "@/db";
import { invoices, invoicePromises, invoiceDisputes } from "@/db/schema";
import { requireOrg, bad, ok } from "@/lib/api";
import { recomputeInvoiceState, DISPUTE_CATEGORIES } from "@/lib/portal";
import { and, eq, inArray } from "drizzle-orm";

/**
 * POST /api/invoices/[id]/response
 * Canonical "set the customer response" action — keeps promise ⇄ dispute ⇄ clear
 * consistent everywhere (board, portal, rep portal).
 * Body: { type: "promise" | "dispute" | "clear", promiseDate?, amount?, note?, category?, reason? }
 *
 * Switching is automatic:
 *  - promise  → resolves any open dispute (dispute → promise), records the promise
 *  - dispute  → raises a dispute (dispute wins over a promise in derived state)
 *  - clear    → resolves open disputes + supersedes active promises (back to neutral)
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  const [inv] = await db
    .select({ id: invoices.id, customerId: invoices.customerId, collectionOwnerId: invoices.collectionOwnerId })
    .from(invoices).where(and(eq(invoices.id, params.id), eq(invoices.orgId, orgId!))).limit(1);
  if (!inv) return bad("Invoice not found", 404);

  const body = await req.json().catch(() => ({}));
  const userId = (session!.user as any).id as string;
  const source = role === "rep" ? "Rep" : "Accountant";

  // Helper: resolve all open disputes on this invoice
  async function resolveOpenDisputes(outcome: string) {
    await db.update(invoiceDisputes)
      .set({ status: "Resolved", outcome, resolvedBy: userId, resolvedAt: new Date() })
      .where(and(
        eq(invoiceDisputes.orgId, orgId!),
        eq(invoiceDisputes.invoiceId, inv.id),
        inArray(invoiceDisputes.status, ["Open", "Under Review"]),
      ));
  }
  // Helper: supersede active promises
  async function supersedePromises() {
    await db.update(invoicePromises)
      .set({ status: "Superseded" })
      .where(and(
        eq(invoicePromises.orgId, orgId!),
        eq(invoicePromises.invoiceId, inv.id),
        eq(invoicePromises.status, "Active"),
      ));
  }

  if (body.type === "promise") {
    if (!body.promiseDate) return bad("promiseDate is required");
    await resolveOpenDisputes("Customer agreed to pay"); // switching dispute → promise
    await db.insert(invoicePromises).values({
      orgId: orgId!, invoiceId: inv.id, customerId: inv.customerId,
      promiseDate: String(body.promiseDate).slice(0, 16),
      amount: body.amount != null && !isNaN(Number(body.amount)) ? Number(body.amount) : null,
      source, enteredBy: userId, note: body.note ? String(body.note).slice(0, 1000) : null, status: "Active",
    });
  } else if (body.type === "dispute") {
    const category = DISPUTE_CATEGORIES.includes(body.category) ? body.category : "Other";
    await db.insert(invoiceDisputes).values({
      orgId: orgId!, invoiceId: inv.id, customerId: inv.customerId,
      category, reason: body.reason ? String(body.reason).slice(0, 2000) : null,
      source, raisedBy: userId, assignedTo: inv.collectionOwnerId ?? userId, status: "Open",
    });
  } else if (body.type === "clear") {
    await resolveOpenDisputes("Resolved");
    await supersedePromises();
  } else {
    return bad("Invalid type");
  }

  await recomputeInvoiceState(orgId!, inv.id);
  return ok({ ok: true });
}
