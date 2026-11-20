/**
 * PATCH  /api/inventory/expected-deliveries/[id]  { action: "cancel" | "reopen" }
 * DELETE /api/inventory/expected-deliveries/[id]  → only one not yet received
 *
 * A received delivery is changed only by voiding its receipt, which reopens it.
 */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { setDeliveryCancelled, deleteExpectedDelivery, expectedDeliveryErrorOf } from "@/lib/inventory/expected-delivery-server";

function fail(e: unknown) {
  const x = expectedDeliveryErrorOf(e);
  if (x) return bad(x.message, x.status);
  throw e;
}

async function guard() {
  const { error, orgId, role } = await requireOrg();
  if (error) return { error };
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return { error: modErr };
  if (!canPostInventoryTxn(role)) return { error: bad("You don't have permission for this action", 403) };
  return { orgId: orgId! };
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await guard();
  if (g.error) return g.error;
  const b = await req.json().catch(() => ({}));
  if (b?.action !== "cancel" && b?.action !== "reopen") return bad("action must be cancel or reopen");
  try { return ok(await setDeliveryCancelled(g.orgId!, params.id, b.action === "cancel")); } catch (e) { return fail(e); }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const g = await guard();
  if (g.error) return g.error;
  try { await deleteExpectedDelivery(g.orgId!, params.id); return ok({ id: params.id, deleted: true }); } catch (e) { return fail(e); }
}
