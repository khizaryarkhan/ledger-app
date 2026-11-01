/**
 * POST /api/resources/time-entries/:id/approve: Submitted -> Approved.
 * Only the person's resource-manager chain, an org-wide approver or an org
 * admin; never your own. Leave usage is recorded in the shared lib.
 */

import { requireOrg, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { buildCtx, approveEntry, respond } from "@/lib/resources/time-entries-server";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const ctx = await buildCtx(orgId!, session, role);
  const res = await approveEntry(ctx, params.id);
  return respond(res);
}
