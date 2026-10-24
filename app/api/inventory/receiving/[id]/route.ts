/** GET /api/inventory/receiving/[id] → receipt header + lines (with item names and lot GS1 metadata). */

import { db } from "@/db";
import { goodsReceipts, goodsReceiptLines, apItems, inventoryLots } from "@/db/schema";
import { requireOrg, ok, bad, canPostInventoryTxn } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, asc, inArray } from "drizzle-orm";
import { voidGoodsReceipt } from "@/lib/inventory/void";
import { editGoodsReceipt, type ReceiptInput } from "@/lib/inventory/receiving";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const [receipt] = await db.select().from(goodsReceipts).where(and(eq(goodsReceipts.id, params.id), eq(goodsReceipts.orgId, orgId!))).limit(1);
  if (!receipt) return bad("Receipt not found", 404);
  const lines = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.receiptId, params.id)).orderBy(asc(goodsReceiptLines.createdAt));
  const ids = [...new Set(lines.map(l => l.itemId))];
  const items = ids.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, ids))) : [];
  const byId = new Map(items.map(i => [i.id, i]));
  // supplierBatchNo/productionDate/bestBeforeDate live on the LOT, not the
  // receipt line (goods_receipt_lines has only lotNo/expiryDate) — join them
  // back in so an edit form can fully resume what was originally entered.
  const lotIds = [...new Set(lines.map(l => l.lotId).filter((x): x is string => !!x))];
  const lots = lotIds.length
    ? await db.select({ id: inventoryLots.id, supplierBatchNo: inventoryLots.supplierBatchNo, productionDate: inventoryLots.productionDate, bestBeforeDate: inventoryLots.bestBeforeDate })
      .from(inventoryLots).where(and(eq(inventoryLots.orgId, orgId!), inArray(inventoryLots.id, lotIds)))
    : [];
  const lotById = new Map(lots.map(l => [l.id, l]));
  return ok({
    receipt,
    lines: lines.map(l => ({
      ...l, item: byId.get(l.itemId) ?? null,
      supplierBatchNo: (l.lotId && lotById.get(l.lotId)?.supplierBatchNo) || null,
      productionDate: (l.lotId && lotById.get(l.lotId)?.productionDate) || null,
      bestBeforeDate: (l.lotId && lotById.get(l.lotId)?.bestBeforeDate) || null,
    })),
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  try { return ok(await voidGoodsReceipt(orgId!, params.id)); }
  catch (e: any) { if (e instanceof LedgerValidationError) return bad(e.message, 409); console.error("[receiving void]", e); return bad("Could not void receipt", 500); }
}

/**
 * Correct an already-posted receipt. The ledger has no in-place edit (see
 * lib/inventory/receiving.ts's editGoodsReceipt doc comment) — this validates
 * the correction, voids the original (refused if billed or if the stock has
 * since moved, same as a manual void), and posts the corrected lines as one
 * user action.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!canPostInventoryTxn(role)) return bad("You don't have permission for this action", 403);
  const body = (await req.json().catch(() => ({}))) as ReceiptInput;
  try {
    const res = await editGoodsReceipt(orgId!, params.id, body, (session?.user as any)?.id ?? null);
    return ok(res);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message, 409);
    console.error("[receiving edit]", e);
    return bad("Could not save the correction", 500);
  }
}
