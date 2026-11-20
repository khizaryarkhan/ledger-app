/**
 * GET    /api/inventory/shipping/[id]/packages              → packages (with SSCC and contents) + packing per line
 * POST   /api/inventory/shipping/[id]/packages              { packType, parentId?, grossWeightKg?, contents: [{ shipmentLineId, qtyBase }] }
 *                                                         → add one package; its SSCC is allocated from the org's GS1 prefix
 * DELETE /api/inventory/shipping/[id]/packages?packageId=   → remove one (refused while cartons sit on it)
 *
 * Packing records the logistic units a ship notice (X12 856 / DESADV) lists.
 * It moves no stock and posts nothing. Rules: lib/inventory/sscc(-server).ts.
 */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { shipmentPacking, addShipmentPackage, removeShipmentPackage, ssccErrorOf } from "@/lib/inventory/sscc-server";

function fail(e: unknown) {
  const s = ssccErrorOf(e);
  if (s) return bad(s.message, s.status);
  throw e;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  try { return ok(await shipmentPacking(orgId!, params.id)); } catch (e) { return fail(e); }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  const b = await req.json().catch(() => ({}));
  try { return ok(await addShipmentPackage(orgId!, params.id, b, (session?.user as any)?.id ?? null)); } catch (e) { return fail(e); }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  const packageId = new URL(req.url).searchParams.get("packageId");
  if (!packageId) return bad("packageId required");
  try { await removeShipmentPackage(orgId!, params.id, packageId); return ok({ id: packageId, deleted: true }); } catch (e) { return fail(e); }
}
