/** POST /api/resources/time-entries/:id/submit: Draft or Rejected -> Submitted (owner or org admin) */

import { requireOrg, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { buildCtx, submitEntry, respond } from "@/lib/resources/time-entries-server";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const ctx = await buildCtx(orgId!, session, role);
  const res = await submitEntry(ctx, params.id);
  return respond(res);
}
