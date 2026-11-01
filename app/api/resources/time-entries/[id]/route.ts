/**
 * PATCH  /api/resources/time-entries/:id   -> edit a Draft or Rejected entry
 * DELETE /api/resources/time-entries/:id   -> delete a Draft or Rejected entry
 *
 * Once Submitted, use submit/approve/reject; once Approved or Posted the row
 * is immutable here (posted time is corrected like any other posted document).
 */

import { requireOrg, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { buildCtx, updateEntry, deleteEntry, respond } from "@/lib/resources/time-entries-server";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const ctx = await buildCtx(orgId!, session, role);
  const body = await req.json().catch(() => ({}));
  const res = await updateEntry(ctx, params.id, body ?? {});
  return respond(res);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const ctx = await buildCtx(orgId!, session, role);
  const res = await deleteEntry(ctx, params.id);
  return respond(res);
}
