/**
 * GET   /api/inventory/receiving/bill?ids=a,b         → the receipts' unbilled lines, staging-time (PO qty / received / billed so far)
 * GET   /api/inventory/receiving/bill?billEntryId=X    → the matching table for an ALREADY-POSTED receipt-matched Bill
 * POST  /api/inventory/receiving/bill                  → create a Bill from receipts (clears GR/IR → A/P)
 * PATCH /api/inventory/receiving/bill                  → correct the qty/price of one or more already-billed lines, in place
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { db } from "@/db";
import { goodsReceipts, goodsReceiptLines, apItems, tradeDocumentLines, transactionLinks } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { requireModule } from "@/lib/modules-server";
import { billFromReceipts, editBillFromReceipts, type BillFromReceiptsInput, type EditBillFromReceiptsInput } from "@/lib/inventory/receiving";
import { LedgerValidationError } from "@/lib/ledger";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const url = new URL(req.url);
  const billEntryId = url.searchParams.get("billEntryId");

  if (billEntryId) {
    // The matching table for a Bill already posted from one or more receipts —
    // Item / PO Qty / Received / Billed so far (every bill) / This bill's Qty.
    const links = await db.select().from(transactionLinks)
      .where(and(eq(transactionLinks.orgId, orgId!), eq(transactionLinks.toId, billEntryId), eq(transactionLinks.toType, "Bill"), eq(transactionLinks.relation, "receipt_bill")));
    if (!links.length) return ok([]);
    const lineIds = links.map(l => l.fromLineId).filter(Boolean) as string[];
    const grLines = lineIds.length ? await db.select({
      id: goodsReceiptLines.id, receiptId: goodsReceiptLines.receiptId, poLineId: goodsReceiptLines.poLineId,
      itemName: apItems.name, baseUom: apItems.baseUom, qtyBase: goodsReceiptLines.qtyBase, billedQty: goodsReceiptLines.billedQty,
      description: goodsReceiptLines.description,
    }).from(goodsReceiptLines).leftJoin(apItems, eq(apItems.id, goodsReceiptLines.itemId))
      .where(and(eq(goodsReceiptLines.orgId, orgId!), inArray(goodsReceiptLines.id, lineIds))) : [];
    const grLineById = new Map(grLines.map(l => [l.id, l]));
    const poLineIds = grLines.map(l => l.poLineId).filter(Boolean) as string[];
    const poLines = poLineIds.length ? await db.select({ id: tradeDocumentLines.id, orderedBaseQty: tradeDocumentLines.orderedBaseQty }).from(tradeDocumentLines).where(inArray(tradeDocumentLines.id, poLineIds)) : [];
    const poLineById = new Map(poLines.map(l => [l.id, l]));
    const receiptIds = [...new Set(grLines.map(l => l.receiptId))];
    const receipts = receiptIds.length ? await db.select({ id: goodsReceipts.id, receiptNo: goodsReceipts.receiptNo, currency: goodsReceipts.currency, exchangeRate: goodsReceipts.exchangeRate }).from(goodsReceipts).where(inArray(goodsReceipts.id, receiptIds)) : [];
    const receiptById = new Map(receipts.map(r => [r.id, r]));
    return ok(links.map(lk => {
      const gl = lk.fromLineId ? grLineById.get(lk.fromLineId) : undefined;
      const po = gl?.poLineId ? poLineById.get(gl.poLineId) : undefined;
      const r = gl ? receiptById.get(gl.receiptId) : undefined;
      const fx = Number(r?.exchangeRate) || 1;
      const qty = Number(lk.qty ?? 0);
      return {
        linkId: lk.id,
        receiptId: gl?.receiptId ?? null, receiptNo: r?.receiptNo ?? null,
        itemName: gl?.itemName ?? gl?.description ?? "Item", baseUom: gl?.baseUom ?? "",
        poQty: po ? Number(po.orderedBaseQty) : null,
        receivedQty: gl ? Number(gl.qtyBase) : null,
        billedQty: gl ? Number(gl.billedQty) : null, // cumulative, across every bill against this receipt line
        qty, rate: qty > 0 ? Math.round((Number(lk.amount) / qty / fx) * 1e6) / 1e6 : 0,
        amount: Math.round((Number(lk.amount) / fx) * 100) / 100,
        currency: r?.currency || null,
      };
    }));
  }

  const ids = (url.searchParams.get("ids") ?? "").split(",").map(x => x.trim()).filter(Boolean);
  if (!ids.length) return ok([]);
  const rows = await db.select({
    id: goodsReceiptLines.id, receiptNo: goodsReceipts.receiptNo, itemName: apItems.name, baseUom: apItems.baseUom,
    qtyBase: goodsReceiptLines.qtyBase, billedQty: goodsReceiptLines.billedQty, unitCost: goodsReceiptLines.unitCost,
    poLineId: goodsReceiptLines.poLineId,
    currency: goodsReceipts.currency, exchangeRate: goodsReceipts.exchangeRate,
  }).from(goodsReceiptLines)
    .innerJoin(goodsReceipts, eq(goodsReceipts.id, goodsReceiptLines.receiptId))
    .leftJoin(apItems, eq(apItems.id, goodsReceiptLines.itemId))
    .where(and(eq(goodsReceiptLines.orgId, orgId!), inArray(goodsReceiptLines.receiptId, ids)));
  const poLineIds = rows.map(r => r.poLineId).filter(Boolean) as string[];
  const poLines = poLineIds.length ? await db.select({ id: tradeDocumentLines.id, orderedBaseQty: tradeDocumentLines.orderedBaseQty }).from(tradeDocumentLines).where(inArray(tradeDocumentLines.id, poLineIds)) : [];
  const poLineById = new Map(poLines.map(l => [l.id, l]));
  // Prices are shown and entered in the receipt's own currency — what the
  // supplier's invoice says. unit_cost is stored in home currency.
  return ok(rows.map(r => {
    const fx = Number(r.exchangeRate) || 1;
    const po = r.poLineId ? poLineById.get(r.poLineId) : undefined;
    return {
      ...r, open: Math.max(0, Number(r.qtyBase) - Number(r.billedQty)),
      unitCost: Math.round((Number(r.unitCost) / fx) * 1e6) / 1e6, currency: r.currency || null,
      poQty: po ? Number(po.orderedBaseQty) : null,
    };
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

export async function PATCH(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const body = (await req.json().catch(() => ({}))) as EditBillFromReceiptsInput & { billEntryId?: string };
  if (!body.billEntryId) return bad("billEntryId is required.");
  try {
    const res = await editBillFromReceipts(orgId!, body.billEntryId, body, (session?.user as any)?.id ?? null);
    return ok(res);
  } catch (e: any) {
    if (e instanceof LedgerValidationError) return bad(e.message);
    console.error("[receiving] bill edit failed:", e);
    return bad("Failed to update bill", 500);
  }
}
