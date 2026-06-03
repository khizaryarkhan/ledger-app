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
  if (!VALID.includes(body.status)) return bad("Invalid status");

  const [dispute] = await db.select({ id: invoiceDisputes.id, invoiceId: invoiceDisputes.invoiceId })
    .from(invoiceDisputes)
    .where(and(eq(invoiceDisputes.id, params.id), eq(invoiceDisputes.orgId, orgId!)))
    .limit(1);
  if (!dispute) return bad("Dispute not found", 404);

  const isClosing = body.status === "Resolved" || body.status === "Rejected";
  const userId = (session!.user as any).id as string;

  await db.update(invoiceDisputes).set({
    status: body.status,
    resolution: body.resolution ? String(body.resolution).slice(0, 2000) : null,
    ...(isClosing ? { resolvedBy: userId, resolvedAt: new Date() } : {}),
  }).where(eq(invoiceDisputes.id, params.id));

  await recomputeInvoiceState(orgId!, dispute.invoiceId);
  return NextResponse.json({ ok: true });
}
