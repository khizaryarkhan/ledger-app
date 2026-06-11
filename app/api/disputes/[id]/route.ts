import { db } from "@/db";
import { invoiceDisputes, invoices, communications } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { recomputeInvoiceState } from "@/lib/portal";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";

const VALID = ["Open", "Under Review", "Resolved", "Rejected"];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const body = await req.json().catch(() => ({}));

  const [dispute] = await db
    .select({
      id: invoiceDisputes.id,
      invoiceId: invoiceDisputes.invoiceId,
      customerId: invoiceDisputes.customerId,
      category: invoiceDisputes.category,
      status: invoiceDisputes.status,
      projectId: invoices.projectId,
    })
    .from(invoiceDisputes)
    .leftJoin(invoices, eq(invoices.id, invoiceDisputes.invoiceId))
    .where(and(eq(invoiceDisputes.id, params.id), eq(invoiceDisputes.orgId, orgId!)))
    .limit(1);
  if (!dispute) return bad("Dispute not found", 404);

  const userId = (session!.user as any).id as string;
  const actorName: string = (session!.user as any).name || (session!.user as any).email || "Staff";
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

  // Write a communications record so the board chatbox shows a complete thread
  if (body.status !== undefined && dispute.customerId) {
    let commBody = "";
    let commSubject = "";
    if (body.status === "Under Review") {
      commSubject = `Dispute acknowledged · ${dispute.category}`;
      commBody = `Marked as under review.`;
    } else if (body.status === "Resolved") {
      const outcome = body.outcome ? String(body.outcome) : "Resolved";
      commSubject = `Dispute resolved · ${outcome}`;
      commBody = `Outcome: ${outcome}${body.resolution ? `\n${body.resolution}` : ""}`;
    } else if (body.status === "Rejected") {
      commSubject = `Dispute rejected`;
      commBody = `Rejected${body.resolution ? `: ${body.resolution}` : "."}`;
    }
    if (commBody) {
      await db.insert(communications).values({
        orgId: orgId!,
        customerId: dispute.customerId,
        invoiceId: dispute.invoiceId ?? undefined,
        projectId: dispute.projectId ?? undefined,
        direction: "Outbound",
        channel: "Dispute",
        subject: commSubject,
        body: commBody,
        sender: actorName,
        authorId: userId,
        matchedBy: "Manual",
        isDraft: false,
      }).catch(() => {});
    }
  }

  if (body.status !== undefined) await recomputeInvoiceState(orgId!, dispute.invoiceId);
  return NextResponse.json({ ok: true });
}
