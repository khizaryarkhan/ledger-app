/**
 * Maker-checker: should this posting be staged for a second, different
 * user's approval instead of posting immediately? Job Work dispatch is
 * gated unconditionally (material leaves custody with no offsetting
 * document in hand — the highest-risk step); Manufacturing Order
 * completion/Goods Receipt/Shipment are gated above an org-configurable
 * value threshold. Checked by each posting function (lib/inventory/
 * jobwork.ts, mo-completion.ts, receiving.ts, shipping.ts) BEFORE any
 * write — if gated, the caller stages the request via stagePendingApproval
 * and returns `{ pending: true, id }` instead of posting.
 */

import { db } from "@/db";
import { approvalThresholds, pendingApprovals } from "@/db/schema";
import { and, eq } from "drizzle-orm";

// "production_build" is the configured THRESHOLD an admin sets (Settings →
// Approvals) for producing stock — kept under this name rather than renamed
// to "mo_completion" because it predates Manufacturing Orders and an org's
// existing threshold amount must survive the rename unchanged. "mo_completion"
// is the entity type an actual completion is STAGED under (checked against
// production_build's threshold via requiresApproval, above); approving one
// re-runs completeMoRun with the recorded input. The two names describe the
// same control from two sides — the limit, and the thing being limited — not
// two features.
export type ApprovalEntityType = "jobwork_dispatch" | "production_build" | "mo_completion" | "goods_receipt" | "shipment";

export async function requiresApproval(orgId: string, entityType: ApprovalEntityType, amount: number): Promise<boolean> {
  const [row] = await db.select().from(approvalThresholds)
    .where(and(eq(approvalThresholds.orgId, orgId), eq(approvalThresholds.entityType, entityType))).limit(1);
  if (row?.alwaysRequire) return true;
  if (row?.thresholdAmount != null && amount >= Number(row.thresholdAmount)) return true;
  // Before an admin has configured anything, Job Work dispatch still gates —
  // it's the one control that should never silently be "off by default".
  if (!row && entityType === "jobwork_dispatch") return true;
  return false;
}

export async function stagePendingApproval(orgId: string, entityType: ApprovalEntityType, payload: unknown, amount: number, requestedBy: string | null) {
  const [row] = await db.insert(pendingApprovals).values({
    orgId, entityType, payloadJson: payload as any, amount: amount.toFixed(2), requestedBy: requestedBy ?? null,
  } as any).returning();
  return row;
}
