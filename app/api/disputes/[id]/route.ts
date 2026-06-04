import { db } from "@/db";
import { invoiceDisputes } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { recomputeInvoiceState } from "@/lib/portal";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const VALID = ["Open", "Under Review", "Resolved", "Rejected"];

/**
 * PATCH /api/disputes/[id]
 * Update a dispute's status. Per design, anyone with org access can resolve.
 * Body: { status, resolution? }
 * Resolving/rejecting recomputes invoice state (resumes automations if no
 * other open disputes remain).
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const body = await req.json().catch(() => ({}));

  const [dispute] = await db.select({ id: invoiceDisputes.id, invoiceId: invoiceDisputes.invoiceId })
    .from(invoiceDisputes)
    .where(and(eq(invoiceDisputes.id, params.id), eq(invoiceDisputes.orgId, orgId!)))
    .limit(1);
  if (!dispute) return bad("Dispute not found", 404);

  const userId = (session!.user as any).id as string;
  const patch: Record<string, any> = {};

  // Reassign (no status change required)
  if ("assignedTo" in body) patch.assignedTo = body.assignedTo || null;

  // Status transition
  if (body.status !== undefined) {
    if (!VALID.includes(body.status)) return bad("Invalid status");
    patch.status = body.status;
    const isClosing = body.status === "Resolved" || body.status === "Rejected";
    if (isClosing) {
      patch.resolvedBy = userId;
      patch.resolvedAt = new Date();
      if (body.outcome) patch.outcome = String(body.outcome).slice(0, 32);
      if (body.resolution) patch.resolution = String(body.resolution).slice(0, 2000);
    }
  }

  if (Object.keys(patch).length === 0) return bad("Nothing to update");

  await db.update(invoiceDisputes).set(patch).where(eq(invoiceDisputes.id, params.id));

  // Only recompute (which can move the invoice off "Disputed") when status changed
  if (body.status !== undefined) await recomputeInvoiceState(orgId!, dispute.invoiceId);
  return NextResponse.json({ ok: true });
}
