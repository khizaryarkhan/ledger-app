/**
 * POST /api/approvals/[id]/approve
 *
 * Segregation of duties: role >= company_admin AND the approver must be a
 * DIFFERENT user from whoever requested it. Re-invokes the original posting
 * function with the stored payload (skipApprovalCheck: true, so it can't
 * loop back into another pending row) — this is the only place the actual
 * inventory/GL write happens for a gated transaction.
 */

import { completeMoRun } from "@/lib/inventory/mo-completion";
import { db } from "@/db";
import { pendingApprovals, manufacturingOrders } from "@/db/schema";
import { requireOrg, ok, bad, requireRole } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { LedgerValidationError } from "@/lib/ledger";
import { dispatchToJobWorker } from "@/lib/inventory/jobwork";
import { postGoodsReceipt } from "@/lib/inventory/receiving";
import { postShipment } from "@/lib/inventory/shipping";
import { postTimesheets } from "@/lib/payroll/timesheet-posting";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!role || !requireRole(role, "company_admin")) return bad("Admins only", 403);
  const approverId = (session?.user as any)?.id ?? null;

  const [pending] = await db.select().from(pendingApprovals)
    .where(and(eq(pendingApprovals.id, params.id), eq(pendingApprovals.orgId, orgId!))).limit(1);
  if (!pending) return bad("Approval request not found", 404);
  if (pending.status === "Approving") return bad("This request is being posted right now. If it stays like this for more than 10 minutes it can be rejected from Approvals.", 409);
  if (pending.status !== "Pending") return bad("This request has already been decided", 409);
  if (pending.requestedBy && approverId && pending.requestedBy === approverId) {
    return bad("You can't approve your own request — a different user must approve it", 403);
  }

  // Claim atomically: two admins (or a double click) must not both post it. approvedAt doubles as the claim time, so a
  // request whose poster died can be recognised as stuck (the reject route accepts it after 10 minutes).
  const claimed = await db.update(pendingApprovals).set({ status: "Approving", approvedAt: new Date() })
    .where(and(eq(pendingApprovals.id, pending.id), eq(pendingApprovals.orgId, orgId!), eq(pendingApprovals.status, "Pending")))
    .returning({ id: pendingApprovals.id });
  if (!claimed.length) return bad("This request has already been decided", 409);

  const isMo = pending.entityType === "mo_completion";
  const moId = isMo ? (pending.payloadJson as any)?.moId : null;
  const clearMoLock = async () => {
    if (!moId) return;
    await db.update(manufacturingOrders).set({ completionPendingAt: null })
      .where(and(eq(manufacturingOrders.id, moId), eq(manufacturingOrders.orgId, orgId!)))
      .catch(e => console.error("[approval approve] could not clear completion_pending_at", moId, e));
  };

  let result: any;
  try {
    const opts = { skipApprovalCheck: true } as const;
    switch (pending.entityType) {
      case "jobwork_dispatch": result = await dispatchToJobWorker(orgId!, pending.payloadJson as any, pending.requestedBy, opts); break;
      case "mo_completion": {
        const payload = pending.payloadJson as any;
        result = await completeMoRun(orgId!, payload.moId, payload, pending.requestedBy, opts);
        break;
      }
      case "goods_receipt": result = await postGoodsReceipt(orgId!, pending.payloadJson as any, pending.requestedBy, opts); break;
      case "shipment": result = await postShipment(orgId!, pending.payloadJson as any, pending.requestedBy, opts); break;
      case "timesheet_batch": result = await postTimesheets(orgId!, pending.payloadJson as any, pending.requestedBy, opts); break;
      default:
        await db.update(pendingApprovals).set({ status: "Pending" }).where(and(eq(pendingApprovals.id, pending.id), eq(pendingApprovals.orgId, orgId!)));
        return bad(`Unknown approval entity type: ${pending.entityType}`, 500);
    }
  } catch (e: any) {
    // Posting failed: nothing was kept (completion compensates), so the request goes back to Pending and can be retried or
    // rejected. The order's pending-completion lock STAYS: a live Pending request still exists for it.
    await db.update(pendingApprovals).set({ status: "Pending", approvedAt: null }).where(and(eq(pendingApprovals.id, pending.id), eq(pendingApprovals.orgId, orgId!), eq(pendingApprovals.status, "Approving")))
      .catch(x => console.error("[approval approve] could not return request to Pending", pending.id, x));
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[approval approve]", e);
    return bad("Could not post the approved transaction", 500);
  }

  // The transaction has POSTED. From here nothing may put the request back to Pending (that would allow a second post):
  // retry the bookkeeping, and if it still fails leave it Approving and say so loudly.
  const decided = { status: "Approved", approvedBy: approverId, approvedAt: new Date(), resultId: result?.id ?? null };
  let recorded = false;
  for (let i = 0; i < 3 && !recorded; i++) {
    try {
      await db.update(pendingApprovals).set(decided).where(and(eq(pendingApprovals.id, pending.id), eq(pendingApprovals.orgId, orgId!)));
      recorded = true;
    } catch (x) { console.error("[approval approve] could not record Approved (attempt " + (i + 1) + ")", pending.id, x); }
  }
  if (!recorded) console.error("[approval approve] POSTED but the request could not be marked Approved. It stays Approving; DO NOT re-approve. Request", pending.id, "result", result?.id);
  await clearMoLock();
  return ok({ approved: true, result });
}
