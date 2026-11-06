/**
 * GET  /api/resources/me/approvals                             -> { queue, replies }
 * POST /api/resources/me/approvals { ids, action, reason? }    -> { results: [{ id, ok, error? }] }, one per id
 *
 * `replies` is the other half of a return: what people wrote back about time
 * THIS approver sent back. It rides on the same request because an approver
 * who has to go looking for replies will not look.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { buildCtx, approvalQueue, decideMany } from "@/lib/resources/time-entries-server";
import { repliesForApprover } from "@/lib/resources/approval-server";

const MAX_BULK = 500;

export async function GET() {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true, teamAction: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const ctx = await buildCtx(orgId!, session, role);
  const [queue, replies] = await Promise.all([
    approvalQueue(ctx),
    repliesForApprover(orgId!, ctx.userId),
  ]);
  return ok({ queue, replies });
}

export async function POST(req: Request) {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true, teamAction: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const body = await req.json().catch(() => ({}));
  const ids: unknown = body?.ids;
  const action = body?.action;
  if (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => typeof i === "string")) return bad("ids must be a non-empty list");
  if (ids.length > MAX_BULK) return bad(`At most ${MAX_BULK} entries at a time`);
  if (action !== "approve" && action !== "reject") return bad("action must be approve or reject");

  const ctx = await buildCtx(orgId!, session, role);
  const results = await decideMany(ctx, ids as string[], action, body?.reason);
  return ok({ results });
}
