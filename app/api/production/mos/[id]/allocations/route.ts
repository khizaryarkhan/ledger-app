/**
 * GET    /api/production/mos/[id]/allocations → per material: its lots (earliest
 *        expiry first), what this order holds, and a suggested allocation
 * PUT    /api/production/mos/[id]/allocations → { itemId, picks: [{ lotId, qty, suggested? }] }
 *        replaces that material's allocation (empty picks = release it)
 * DELETE /api/production/mos/[id]/allocations → release everything the order holds
 *
 * An allocation reserves stock for the order; it posts nothing. See
 * lib/inventory/mo-allocations.ts.
 */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { allocationView, setMaterialAllocation, releaseAllocations } from "@/lib/inventory/mo-allocations";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  try { return ok(await allocationView(orgId!, params.id)); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message, 404); throw e; }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  const b = await req.json().catch(() => ({}));
  if (!b?.itemId) return bad("Which material?");
  try { return ok(await setMaterialAllocation(orgId!, params.id, String(b.itemId), Array.isArray(b.picks) ? b.picks : [], (session?.user as any)?.id ?? null)); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message, 409); throw e; }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  try { return ok(await releaseAllocations(orgId!, params.id)); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message, 404); throw e; }
}
