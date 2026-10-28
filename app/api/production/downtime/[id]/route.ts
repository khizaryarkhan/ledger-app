/** PATCH / DELETE /api/production/downtime/[id] — end, correct or remove a stoppage. */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { updateDowntime, deleteDowntime } from "@/lib/inventory/downtime";
import { LedgerValidationError } from "@/lib/ledger";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  const b = await req.json().catch(() => ({}));
  try { return ok(await updateDowntime(orgId!, params.id, b ?? {})); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message); console.error("[downtime update]", e); return bad("Could not update downtime", 500); }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  return ok(await deleteDowntime(orgId!, params.id));
}
