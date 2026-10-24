/**
 * GET /api/accounting/bill-suggestions?supplierId=X
 *
 * Powers the "Add from purchase order or goods receipt" panel on the New Bill
 * screen — QBO's "Add to Bill" panel. Lists, for one supplier: open Purchase
 * Orders with a billable (non-stocked) remaining balance, and posted Goods
 * Receipts with an unbilled balance.
 *
 * PO lines carry full line data (item, qty, rate, tax, dimensions) so the
 * New Bill form can drop them straight into its editable Items table as a
 * normal line the user can still adjust before saving — "Add" stages, it
 * never posts by itself (see components/new-document-form.tsx's addPoToBill).
 *
 * A PO line for a STOCKED item is never offered here — see
 * lib/accounting/trade-documents.ts's convertTradeDoc doc comment: billing a
 * stocked item straight from a PO (skipping the receipt) is how BILL-0004
 * double-counted stock in production. Those items must be billed from their
 * Goods Receipt instead, which is why both lists are returned side by side —
 * the two source types aren't interchangeable, and a Goods Receipt's lines
 * stay a read-only summary rather than editable Items (its accounting is
 * GR/IR clearing, not a normal expense/item line — see billFromReceipts).
 */

import { db } from "@/db";
import { tradeDocuments, tradeDocumentLines, apItems, goodsReceipts, goodsReceiptLines } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isTracked } from "@/lib/inventory/item-kinds";
import { and, eq, inArray } from "drizzle-orm";

const num = (v: any) => Number(v ?? 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const supplierId = new URL(req.url).searchParams.get("supplierId");
  if (!supplierId) return bad("supplierId is required");

  // Both Purchase Orders and Goods Receipts are Supply Chain data — an org
  // without that module simply has nothing to suggest here, not an error on
  // the Bill screen (same "hide the affordance" rule the pay-link surfaces
  // and the location picker already follow).
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return ok({ purchaseOrders: [], goodsReceipts: [] });

  const CLOSED = new Set(["Closed", "Cancelled", "Converted"]);
  const pos = await db.select().from(tradeDocuments)
    .where(and(eq(tradeDocuments.orgId, orgId!), eq(tradeDocuments.kind, "PurchaseOrder"), eq(tradeDocuments.partyId, supplierId)));
  const openPos = pos.filter(p => !CLOSED.has(p.status));

  let purchaseOrders: any[] = [];
  if (openPos.length) {
    const poIds = openPos.map(p => p.id);
    const lines = await db.select().from(tradeDocumentLines).where(inArray(tradeDocumentLines.documentId, poIds));
    const itemIds = [...new Set(lines.map(l => l.itemId).filter(Boolean) as string[])];
    const items = itemIds.length
      ? await db.select({ id: apItems.id, name: apItems.name, productType: apItems.productType }).from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, itemIds)))
      : [];
    const itemById = new Map(items.map(i => [i.id, i]));
    purchaseOrders = openPos.map(po => {
      const poLines = lines.filter(l => l.documentId === po.id);
      const open = poLines
        .map(l => ({ line: l, remaining: round2(num(l.amount) - num(l.invoicedAmount)), stocked: l.itemId ? isTracked(itemById.get(l.itemId)?.productType) : false }))
        .filter(l => l.remaining > 0.005);
      const addable = open.filter(l => !l.stocked);
      if (!addable.length) return null;
      return {
        id: po.id, docNumber: po.docNumber, issueDate: po.issueDate, currency: po.currency,
        balance: round2(addable.reduce((s, l) => s + l.remaining, 0)),
        // Full editable-line shape — dropped straight into the New Bill
        // form's Items table (see its addPoToBill), not posted here.
        lines: addable.map(({ line: l, remaining }) => {
          // Common case (nothing on this line billed yet): show the real
          // ordered qty/rate. Rare case (a PREVIOUS bill already took part of
          // this line, via a direct split or an earlier convertTradeDoc call):
          // there is no "remaining quantity" to attach a rate to without
          // double-counting qty already billed, so it degrades to one line
          // for the remaining money at qty 1 — still exactly the right amount.
          const fullyUnbilled = Math.abs(num(l.invoicedAmount)) < 0.005;
          const qty = fullyUnbilled ? (num(l.qty) || 1) : 1;
          const rate = fullyUnbilled ? (num(l.rate) || remaining) : remaining;
          return {
            lineId: l.id, poId: po.id, itemId: l.itemId, itemName: l.itemId ? (itemById.get(l.itemId)?.name ?? null) : null,
            description: l.description ?? null, qty, rate, amount: remaining,
            taxRateId: l.taxRateId ?? null, classId: l.classId ?? null, locationId: l.locationId ?? null,
          };
        }),
        lineCount: addable.length,
        hasStockedRemaining: open.some(l => l.stocked),
      };
    }).filter(Boolean);
  }

  const receipts = await db.select().from(goodsReceipts)
    .where(and(eq(goodsReceipts.orgId, orgId!), eq(goodsReceipts.supplierId, supplierId), eq(goodsReceipts.status, "Posted")));
  let goodsReceiptsOut: any[] = [];
  if (receipts.length) {
    const receiptIds = receipts.map(r => r.id);
    const rlines = await db.select().from(goodsReceiptLines).where(inArray(goodsReceiptLines.receiptId, receiptIds));
    const openByReceipt = new Map<string, number>();
    for (const l of rlines) {
      const openQty = num(l.qtyBase) - num(l.billedQty);
      if (openQty <= 1e-6) continue;
      const openAmt = round2(openQty * num(l.unitCost));
      if (openAmt > 0.005) openByReceipt.set(l.receiptId, round2((openByReceipt.get(l.receiptId) ?? 0) + openAmt));
    }
    goodsReceiptsOut = receipts
      .filter(r => openByReceipt.has(r.id))
      .map(r => {
        const fx = num(r.exchangeRate) || 1;
        return { id: r.id, receiptNo: r.receiptNo, receiptDate: r.receiptDate, currency: r.currency, balance: round2((openByReceipt.get(r.id) ?? 0) / fx) };
      });
  }

  return ok({ purchaseOrders, goodsReceipts: goodsReceiptsOut });
}
