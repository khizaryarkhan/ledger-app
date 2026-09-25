/**
 * GET    /api/inventory/adjustments              → recent stock counts and write-downs
 * GET    /api/inventory/adjustments?lotsFor=<id> → an item's open lots (for the drawers)
 * POST   /api/inventory/adjustments              → { kind: "count", date, lines, found? } | { kind: "writedown", date, lotId, newUnitCost, reason }
 * DELETE /api/inventory/adjustments?entryId=     → void one
 *
 * See lib/inventory/adjustments.ts.
 */

import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { LedgerValidationError } from "@/lib/ledger";
import { postStockCount, writeDownLot, listAdjustments, lotsForItem } from "@/lib/inventory/adjustments";
import { voidStockAdjustment } from "@/lib/inventory/void";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const lotsFor = new URL(req.url).searchParams.get("lotsFor");
  if (lotsFor) return ok(await lotsForItem(orgId!, lotsFor));
  return ok(await listAdjustments(orgId!));
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  const b = await req.json().catch(() => ({}));
  const actor = (session?.user as any)?.id ?? null;
  try {
    if (b?.kind === "writedown") return ok(await writeDownLot(orgId!, b, actor));
    if (b?.kind === "count") return ok(await postStockCount(orgId!, b, actor));
    return bad("kind must be count or writedown");
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[adjustments]", e);
    return bad("Could not post the adjustment", 500);
  }
}

export async function DELETE(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  const entryId = new URL(req.url).searchParams.get("entryId");
  if (!entryId) return bad("Which adjustment?");
  try { return ok(await voidStockAdjustment(orgId!, entryId)); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message, 409); throw e; }
}
