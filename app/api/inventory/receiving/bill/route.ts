/**
 * GET  /api/inventory/receiving/bill?ids=a,b → the receipts' unbilled lines (for the invoice-price column)
 * POST /api/inventory/receiving/bill        → create a Bill from receipts (clears GR/IR → A/P)
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { db } from "@/db";
import { goodsReceipts, goodsReceiptLines, apItems } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireModule } from "@/lib/modules-server";
import { billFromReceipts, type BillFromReceiptsInput } from "@/lib/inventory/receiving";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const ids = (new URL(req.url).searchParams.get("ids") ?? "").split(",").map(x => x.trim()).filter(Boolean);
  if (!ids.length) return ok([]);
  const rows = await db.select({
    id: goodsReceiptLines.id, receiptNo: goodsReceipts.receiptNo, itemName: apItems.name, baseUom: apItems.baseUom,
    qtyBase: goodsReceiptLines.qtyBase, billedQty: goodsReceiptLines.billedQty, unitCost: goodsReceiptLines.unitCost,
    currency: goodsReceipts.currency, exchangeRate: goodsReceipts.exchangeRate,
  }).from(goodsReceiptLines)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.receiptId))
    .leftJoin(apItems, eq(apItems.id, goodsReceiptLines.itemId))
    .where(and(eq(goodsReceiptLines.orgId, orgId!), inArray(goodsReceiptLines.receiptId, ids)));
  // Prices are shown and entered in the receipt's own currency — what the
  // supplier's invoice says. unit_cost is stored in home currency.
  return ok(rows.map(r => {
    const fx = Number(r.exchangeRate) || 1;
    return { ...r, open: Math.max(0, Number(r.qtyBase) - Number(r.billedQty)), unitCost: Math.round((Number(r.unitCost) / fx) * 1e6) / 1e6, currency: r.currency || null };
  }).filter(r => r.open > 1e-6));
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const body = (await req.json().catch(() => ({}))) as BillFromReceiptsInput;
  try {
    const res = await billFromReceipts(orgId!, body, (session?.user as any)?.id ?? null);
    return ok(res);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[receiving] bill failed:", e);
    return bad("Failed to create bill", 500);
  }
}
