/** POST /api/resources/time-entries/:id/reject: Submitted -> Rejected, { reason } required */

import { requireOrg, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { buildCtx, rejectEntry, respond } from "@/lib/resources/time-entries-server";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const ctx = await buildCtx(orgId!, session, role);
  const body = await req.json().catch(() => ({}));
  const res = await rejectEntry(ctx, params.id, body?.reason);
  return respond(res);
}
