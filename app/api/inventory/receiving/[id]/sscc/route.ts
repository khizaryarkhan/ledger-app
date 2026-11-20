/**
 * GET    /api/inventory/receiving/[id]/sscc       → SSCCs recorded on this goods receipt
 * POST   /api/inventory/receiving/[id]/sscc       { sscc } → record one, read from the supplier's pallet / carton label
 * DELETE /api/inventory/receiving/[id]/sscc?id=   → remove one
 *
 * Accepts 18 digits, "(00)…" or the raw "00…" scan; the check digit must be
 * right. Records what arrived; moves no stock. Rules: lib/inventory/sscc.ts.
 */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { receiptSsccs, addReceiptSscc, removeReceiptSscc, ssccErrorOf } from "@/lib/inventory/sscc-server";

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
  try { return ok(await receiptSsccs(orgId!, params.id)); } catch (e) { return fail(e); }
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  const b = await req.json().catch(() => ({}));
  try { return ok(await addReceiptSscc(orgId!, params.id, b?.sscc, (session?.user as any)?.id ?? null)); } catch (e) { return fail(e); }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  try { await removeReceiptSscc(orgId!, params.id, id); return ok({ id, deleted: true }); } catch (e) { return fail(e); }
}
