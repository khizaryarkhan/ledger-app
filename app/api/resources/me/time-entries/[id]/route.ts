/** PATCH / DELETE /api/resources/me/time-entries/:id: edit or delete one of your own Draft or Rejected entries. */

import { requireOrg, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { buildCtx, updateEntry, deleteEntry, respond } from "@/lib/resources/time-entries-server";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const ctx = await buildCtx(orgId!, session, role);
  const body = await req.json().catch(() => ({}));
  // The owner is fixed: this route never moves an entry to another person.
  const { resourceId: _ignored, ...rest } = body ?? {};
  const res = await updateEntry(ctx, params.id, rest, { selfOnly: true });
  return respond(res);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const ctx = await buildCtx(orgId!, session, role);
  const res = await deleteEntry(ctx, params.id, { selfOnly: true });
  return respond(res);
}
