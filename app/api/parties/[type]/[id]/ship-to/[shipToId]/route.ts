/**
 * PATCH  /api/parties/customers/[id]/ship-to/[shipToId]  → edit (incl. Active/Inactive, default)
 * DELETE /api/parties/customers/[id]/ship-to/[shipToId]  → delete, refused once a sales order uses it
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { updateShipTo, deleteShipTo, shipToErrorOf } from "@/lib/customer-ship-to-server";

type P = { params: { type: string; id: string; shipToId: string } };

export async function PATCH(req: Request, { params }: P) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  if (params.type !== "customers") return bad("Delivery addresses are kept for customers only", 404);
  const b = await req.json().catch(() => ({}));
  try {
    return ok(await updateShipTo(orgId!, params.id, params.shipToId, b));
  } catch (e) {
    const s = shipToErrorOf(e);
    if (s) return bad(s.message, s.status);
    throw e;
  }
}

export async function DELETE(_req: Request, { params }: P) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  if (params.type !== "customers") return bad("Delivery addresses are kept for customers only", 404);
  try {
    await deleteShipTo(orgId!, params.id, params.shipToId);
    return ok({ id: params.shipToId, deleted: true });
  } catch (e) {
    const s = shipToErrorOf(e);
    if (s) return bad(s.message, s.status);
    throw e;
  }
}
