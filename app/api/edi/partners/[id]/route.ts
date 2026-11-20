/**
 * PATCH  /api/edi/partners/[id] → change a profile (fields not sent are kept)
 * DELETE /api/edi/partners/[id] → only a profile that has exchanged no files; otherwise switch it off
 */
import { ok, requireOrg } from "@/lib/api";
import { updatePartner, deletePartner } from "@/lib/edi/edi-server";
import { ediGuard, ediFail } from "../../_shared";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await ediGuard(await requireOrg(), "admin");
  if (g.error) return g.error;
  const b = await req.json().catch(() => ({}));
  const { partyId: _ignored, ...rest } = b ?? {};
  try { return ok(await updatePartner(g.orgId!, params.id, rest)); } catch (e) { return ediFail(e); }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const g = await ediGuard(await requireOrg(), "admin");
  if (g.error) return g.error;
  try { await deletePartner(g.orgId!, params.id); return ok({ id: params.id, deleted: true }); } catch (e) { return ediFail(e); }
}
