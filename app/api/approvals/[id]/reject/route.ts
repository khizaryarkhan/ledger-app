/** POST /api/approvals/[id]/reject → mark a pending request Rejected. No posting. */

import { db } from "@/db";
import { pendingApprovals, manufacturingOrders } from "@/db/schema";
import { requireOrg, ok, bad, requireRole } from "@/lib/api";
import { and, eq } from "drizzle-orm";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!role || !requireRole(role, "company_admin")) return bad("Admins only", 403);
  const body = await req.json().catch(() => ({}));
  const reason = String(body?.reason ?? "").trim();
  if (!reason) return bad("A reason is required to reject a request");

  const [pending] = await db.select().from(pendingApprovals)
    .where(and(eq(pendingApprovals.id, params.id), eq(pendingApprovals.orgId, orgId!))).limit(1);
  if (!pending) return bad("Approval request not found", 404);
  // A request being posted RIGHT NOW cannot be rejected; one stuck "Approving" for over 10 minutes (the poster died) can, which
  // is also what frees the order it locked.
  const stuck = pending.status === "Approving" && pending.approvedAt && Date.now() - new Date(pending.approvedAt as any).getTime() > 10 * 60_000;
  if (pending.status !== "Pending" && !stuck) return bad(pending.status === "Approving" ? "This request is being posted right now. Try again in a few minutes." : "This request has already been decided", 409);

  // Atomic: only the status we just read can be rejected.
  const done = await db.update(pendingApprovals).set({
    status: "Rejected", approvedBy: (session?.user as any)?.id ?? null, approvedAt: new Date(), rejectedReason: reason,
  }).where(and(eq(pendingApprovals.id, pending.id), eq(pendingApprovals.orgId, orgId!), eq(pendingApprovals.status, pending.status)))
    .returning({ id: pendingApprovals.id });
  if (!done.length) return bad("This request has already been decided", 409);
  if (pending.entityType === "mo_completion") {
    const moId = (pending.payloadJson as any)?.moId;
    if (moId) await db.update(manufacturingOrders).set({ completionPendingAt: null })
      .where(and(eq(manufacturingOrders.id, moId), eq(manufacturingOrders.orgId, orgId!)));
  }
  return ok({ rejected: true });
}
