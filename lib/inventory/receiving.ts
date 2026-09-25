/**
 * Goods receipt — the receiving step between a Purchase Order and a Bill.
 *
 *   Dr  Inventory Asset (per item, at cost)
 *     Cr  GR/IR clearing  (Goods Received Not Invoiced — accrued payable)
 *
 * and a FIFO cost lot is created for each line (lot/batch no captured here, not
 * on the PO). A Bill created from the receipt later debits GR/IR to clear it to
 * Accounts Payable. Receiving can be linked to PO lines (advancing their
 * received qty) or done ad-hoc with no PO. neon-http has no transactions — the
 * balanced JE posts first, then lots + subledger rows commit against its id.
 */

import { db } from "@/db";
import { goodsReceipts, goodsReceiptLines, tradeDocumentLines, organisations, inventoryLots } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import { loadItemCostInfo, commitReceipt } from "@/lib/inventory/valuation";
import { roleAccount } from "@/lib/accounting/account-roles-server";
import { resolveLocationId } from "@/lib/inventory/locations";
import { nextDocNumber } from "@/lib/accounting/numbering";
import { postDocument, type DocRevaluation } from "@/lib/accounting/documents";
import { createLink } from "@/lib/accounting/links";
import { round2, round4, round6, roundQty } from "@/lib/inventory/round";
import { requiresApproval, stagePendingApproval } from "@/lib/inventory/approvals";

const err = (m: string): never => { throw new LedgerValidationError(m); };

export type ReceiptLineInput = {
  itemId: string;
  skuId?: string | null;           // stock SKU received into (SI/FP)
  poId?: string | null;
  poLineId?: string | null;
  description?: string | null;
  qtyBase: number;                 // received quantity in the item's base UoM
  unitCost: number;                // transaction-currency cost per base UoM
  lotNo?: string | null;
  expiryDate?: string | null;                // GS1 AI (17)
  /** The supplier's own batch as printed, GS1 AI (10) — kept apart from lotNo, which is ours and unique. */
  supplierBatchNo?: string | null;
  productionDate?: string | null;            // GS1 AI (11)
  bestBeforeDate?: string | null;            // GS1 AI (15)
  /** Receive THIS line somewhere other than the receipt's location (e.g. straight into Quarantine). */
  locationId?: string | null;
};

export type ReceiptInput = {
  supplierId?: string | null;
  supplierLabel?: string | null;
  receiptDate: string;             // YYYY-MM-DD
  currency?: string | null;
  exchangeRate?: number | null;    // 1 {currency} = {rate} {home}
  notes?: string | null;
  /** Where the goods landed. Omitted resolves to the org's default location. */
  locationId?: string | null;
  lines: ReceiptLineInput[];
};

export async function postGoodsReceipt(orgId: string, input: ReceiptInput, actorId: string | null, opts?: { skipApprovalCheck?: boolean }) {
  const date = input.receiptDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err("A valid receipt date is required.");
  const rows = (input.lines ?? []).filter(l => l.itemId && Math.abs(Number(l.qtyBase) || 0) > 0);
  if (!rows.length) err("Add at least one line with an item and a received quantity.");

  const [org] = await db.select({ home: organisations.currency, mc: organisations.multicurrencyEnabled })
    .from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const home = org?.home ?? "PKR";
  const currency = (input.currency?.trim() || home).toUpperCase();
  const rate = currency === home ? 1 : (Number(input.exchangeRate) || 0);
  if (currency !== home) {
    if (!org?.mc) err("Enable multi-currency before receiving in a foreign currency.");
    if (!(rate > 0)) err("Enter a valid exchange rate.");
  }

  const itemMap = await loadItemCostInfo(orgId, rows.map(r => r.itemId));

  // Locations are resolved (and tenancy-checked) UP FRONT, before the journal
  // entry is posted. A bad or foreign location id must fail while nothing has
  // been written — not after a balanced entry is already in the ledger and only
  // the stock side is left to fail.
  const headerLocationId = await resolveLocationId(orgId, input.locationId, { label: "Receiving location" });
  const lineLocation = new Map<number, string>();
  for (let i = 0; i < rows.length; i++) {
    const override = rows[i].locationId;
    lineLocation.set(i, override ? await resolveLocationId(orgId, override, { label: "Line receiving location" }) : headerLocationId);
  }

  // Build the balanced entry: Dr each item's inventory asset (home), Cr GR/IR.
  const lines: PostLine[] = [];
  let grirTotal = 0;
  // GRNI is a role of each item's group, so one receipt may credit more than
  // one clearing account (a tenant that maps RM and FP to different GRNIs).
  const grniBy = new Map<string, number>();
  const commits: { r: ReceiptLineInput; homeUnit: number; amount: number; assetAcct: string; locationId: string }[] = [];
  for (let ri = 0; ri < rows.length; ri++) {
    const r = rows[ri];
    const item = itemMap.get(r.itemId);
    if (!item) err(`Item ${r.itemId} not found.`);
    if (!item!.tracked) err(`${item!.name} isn't an inventory-tracked item — only tracked items can be received into stock.`);
    const assetAcct = item!.assetAccountId;                 // the group's inventory role
    const grniAcct = roleAccount(item!, "GRNI");
    const qty = roundQty(Math.abs(Number(r.qtyBase) || 0));
    if (qty <= 0) continue;
    const homeUnit = round6((Number(r.unitCost) || 0) * rate);
    const amount = round4(qty * homeUnit);
    // Always receive into stock (a lot is created even at zero cost); only the
    // GL debit/GR-IR credit is added when there is a cost to capitalise.
    if (amount > 0) {
      lines.push({ accountId: assetAcct!, debit: round2(amount), description: `Received — ${item!.name}` });
      grirTotal = round2(grirTotal + round2(amount));
      grniBy.set(grniAcct, round2((grniBy.get(grniAcct) ?? 0) + round2(amount)));
    }
    commits.push({ r, homeUnit, amount, assetAcct: assetAcct!, locationId: lineLocation.get(ri)! });
  }
  if (!commits.length) err("Nothing to receive — check quantities.");
  for (const [acct, amt] of grniBy) if (amt > 0) lines.push({ accountId: acct, credit: amt, description: "Goods received not invoiced" });

  if (!opts?.skipApprovalCheck && await requiresApproval(orgId, "goods_receipt", grirTotal)) {
    const pending = await stagePendingApproval(orgId, "goods_receipt", input, grirTotal, actorId);
    return { pending: true, id: pending.id, amount: grirTotal } as any;
  }

  const receiptNo = await nextDocNumber(orgId, "GoodsReceipt");
  const entry = lines.length > 0 ? await postJournalEntry({
    orgId, entryDate: date, memo: input.notes?.trim() || `Goods receipt ${receiptNo}`,
    series: "GoodsReceipt", sourceType: "GoodsReceipt", docNumber: receiptNo, createdBy: actorId,
    reference: input.supplierLabel ?? null, lines,
  }) : null;

  const [receipt] = await db.insert(goodsReceipts).values({
    orgId, receiptNo, supplierId: input.supplierId ?? null, supplierLabel: input.supplierLabel ?? null,
    receiptDate: date, currency, exchangeRate: rate.toString(), status: "Posted",
    entryId: entry?.id ?? null, grirTotal: grirTotal.toString(), billedAmount: "0",
    locationId: headerLocationId,
    notes: input.notes?.trim() || null, createdBy: actorId,
  } as any).returning({ id: goodsReceipts.id });
  const receiptId = receipt.id;
  const refId = entry?.id ?? receiptId;

  // Create lots + subledger movements, receipt lines, and advance PO progress.
  const poAmounts = new Map<string, number>();
  for (const c of commits) {
    const item = itemMap.get(c.r.itemId)!;
    const qty = roundQty(Math.abs(Number(c.r.qtyBase) || 0));
    const lotId = await commitReceipt(orgId, {
      itemId: item.id, skuId: c.r.skuId ?? null, qty, unitCost: c.homeUnit, productType: item.productType, lotNo: c.r.lotNo ?? null, expiryDate: c.r.expiryDate ?? null,
      supplierBatchNo: c.r.supplierBatchNo ?? null, productionDate: c.r.productionDate ?? null, bestBeforeDate: c.r.bestBeforeDate ?? null,
      supplierId: input.supplierId ?? null, sourceType: "purchase", receivedDate: date,
      locationId: c.locationId,
      refType: "GoodsReceipt", refId, entryId: entry?.id ?? null, createdBy: actorId, note: c.r.description ?? null,
    }).catch(e => { console.error("[receiving lot]", e); return null; });
    await db.insert(goodsReceiptLines).values({
      orgId, receiptId, itemId: item.id, skuId: c.r.skuId ?? null, poId: c.r.poId ?? null, poLineId: c.r.poLineId ?? null,
      description: c.r.description ?? item.name, qtyBase: qty.toString(), unitCost: c.homeUnit.toString(),
      amount: c.amount.toString(), lotId: lotId ?? null, lotNo: c.r.lotNo ?? null, expiryDate: c.r.expiryDate ?? null,
    } as any);
    if (c.r.poLineId) {
      await db.update(tradeDocumentLines)
        .set({ receivedQty: sql`${tradeDocumentLines.receivedQty} + ${qty.toString()}` })
        .where(and(eq(tradeDocumentLines.id, c.r.poLineId), eq(tradeDocumentLines.orgId, orgId)));
    }
    if (c.r.poId) poAmounts.set(c.r.poId, round2((poAmounts.get(c.r.poId) ?? 0) + c.amount));
  }

  // Link each source PO to this receipt, so the PO's "Related transactions"
  // panel shows what's been received against it (mirrors the receipt_bill
  // link billFromReceipts creates further down the chain).
  for (const [poId, amount] of poAmounts) {
    await createLink(orgId, { fromType: "PurchaseOrder", fromId: poId, toType: "GoodsReceipt", toId: receiptId, relation: "po_receipt", amount, contextEntryId: refId }, actorId)
      .catch(e => console.error("[po_receipt link]", e));
  }

  return { id: receiptId, receiptNo, entryId: entry?.id ?? null, grirTotal };
}

export type BillFromReceiptsInput = {
  receiptIds: string[];
  billDate: string;                // YYYY-MM-DD
  dueDate?: string | null;
  reference?: string | null;       // supplier bill no.
  taxRateId?: string | null;       // applied to each line
  memo?: string | null;
  /**
   * The supplier's INVOICE unit price per receipt line (home currency, per base
   * unit), where it differs from what the receipt recorded. P-03: the share of
   * the difference on stock still in the lot is added to that lot's cost; the
   * share on stock already used goes to Purchase price variance.
   */
  prices?: { lineId: string; unitCost: number }[];
};

/**
 * Create a supplier Bill from one or more posted goods receipts. Bills the
 * un-billed accrued cost of each receipt line against the GR/IR clearing
 * account, so posting clears GR/IR to Accounts Payable (Dr GR/IR / Cr A/P).
 * All receipts must be the same supplier. Amounts are the home-currency accrued
 * cost, so GR/IR clears exactly.
 */
export async function billFromReceipts(orgId: string, input: BillFromReceiptsInput, actorId: string | null) {
  if (!input.receiptIds?.length) err("Select at least one receipt to bill.");

  const receipts = await db.select().from(goodsReceipts)
    .where(and(eq(goodsReceipts.orgId, orgId), inArray(goodsReceipts.id, input.receiptIds)));
  if (!receipts.length) err("Receipts not found.");
  const supplierIds = [...new Set(receipts.map(r => r.supplierId ?? "—"))];
  if (supplierIds.length > 1) err("All selected receipts must be for the same supplier.");
  const supplierId = receipts[0].supplierId ?? null;
  const supplierLabel = receipts[0].supplierLabel ?? null;

  // P-02: bill in the RECEIPTS' currency, at their rate. GR/IR holds the home
  // value the receipt recorded; converting the bill back at that same rate is
  // what lets it clear exactly — the FX difference belongs to the payment
  // (settlePayment), not here. Before this no currency was passed at all, so a
  // foreign-currency receipt could not be billed.
  const [org] = await db.select({ home: organisations.currency }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const home = (org?.home ?? "PKR").toUpperCase();
  const ccys = [...new Set(receipts.map(r => (r.currency || home).toUpperCase()))];
  if (ccys.length > 1) err("The selected receipts are in different currencies — bill them separately.");
  const currency = ccys[0];
  const rates = [...new Set(receipts.map(r => Number(r.exchangeRate) || 1))];
  if (currency !== home && rates.length > 1) err("The selected receipts were received at different exchange rates — bill them separately so each clears at its own rate.");
  const fx = currency === home ? 1 : rates[0];
  const toTxn = (homeAmount: number) => round2(homeAmount / fx);

  const lineRows = await db.select().from(goodsReceiptLines)
    .where(and(eq(goodsReceiptLines.orgId, orgId), inArray(goodsReceiptLines.receiptId, input.receiptIds)));

  // Each line clears the GRNI of its item's group — the account its receipt
  // credited — so GR/IR nets to zero per account, not just in total.
  const lineItems = await loadItemCostInfo(orgId, lineRows.map(l => l.itemId).filter(Boolean) as string[]);

  // Bill the un-billed remainder of each receipt line (qty basis).
  const billLines: any[] = [];
  const touched: { lineId: string; qty: number; amount: number }[] = [];
  const priceFor = new Map((input.prices ?? []).filter(p => p?.lineId && Number.isFinite(Number(p.unitCost)) && Number(p.unitCost) >= 0).map(p => [String(p.lineId), Number(p.unitCost)]));
  const revaluations: DocRevaluation[] = [];
  const lotIds = lineRows.map(l => l.lotId).filter(Boolean) as string[];
  const lots = lotIds.length ? await db.select().from(inventoryLots).where(and(eq(inventoryLots.orgId, orgId), inArray(inventoryLots.id, lotIds))) : [];
  const lotById = new Map(lots.map(l => [l.id, l]));
  for (const l of lineRows) {
    const rem = roundQty(Number(l.qtyBase) - Number(l.billedQty));
    if (rem <= 0) continue;
    // Match the receipt's rounding basis (round4 then round2) so GR/IR clears
    // to exactly zero when a receipt line is fully billed.
    const amount = round2(round4(rem * Number(l.unitCost)));
    if (amount <= 0) continue;
    const it = l.itemId ? lineItems.get(l.itemId) : undefined;
    if (!it) err(`The item on receipt line "${l.description ?? l.id}" no longer exists.`);
    billLines.push({ accountId: roleAccount(it!, "GRNI"), itemId: null, description: l.description ?? "Received goods", qty: rem, rate: round6(Number(l.unitCost) / fx), amount: toTxn(amount), taxRateId: input.taxRateId ?? null });
    touched.push({ lineId: l.id, qty: rem, amount });
    // The invoice at a different price: GRNI still clears at the receipt's
    // value (above); the difference is its own line, to purchase price
    // variance, and the part of it on stock still in the lot is then moved
    // into the lot's cost.
    if (priceFor.has(l.id)) {
      // Invoice prices are entered in the bill's (the receipts') currency.
      const diff = round2(round2(rem * priceFor.get(l.id)! * fx) - amount);
      if (Math.abs(diff) >= 0.005) {
        const ppv = it!.accounts?.roles.PURCHASE_PRICE_VARIANCE;
        if (!ppv) err(`${it!.name}: its posting group has no Purchase price variance account — map it under Accounting → Setup → Posting Groups.`);
        billLines.push({ accountId: ppv, itemId: null, description: `Price difference — ${it!.name}`, qty: rem, rate: round6(diff / fx / rem), amount: toTxn(diff), taxRateId: input.taxRateId ?? null });
        const lot = l.lotId ? lotById.get(l.lotId) : undefined;
        const stillHeld = lot && Number(lot.origQty) > 0 ? Math.min(1, Math.max(0, Number(lot.remainingQty) / Number(lot.origQty))) : 0;
        const toStock = round2(diff * stillHeld);
        if (lot && Math.abs(toStock) >= 0.005) revaluations.push({ lotId: lot.id, amount: toStock, assetAccountId: it!.assetAccountId!, ppvAccountId: ppv!, itemName: it!.name });
      }
    }
  }
  if (!billLines.length) err("These receipts are already fully billed.");

  const entry = await postDocument(orgId, {
    type: "Bill", date: input.billDate,
    memo: input.memo?.trim() || `Bill for goods received (${receipts.map(r => r.receiptNo).filter(Boolean).join(", ")})`,
    partyType: "Vendor", partyId: supplierId, partyLabel: supplierLabel,
    ...(currency !== home ? { currency, exchangeRate: fx } : {}),
    dueDate: input.dueDate ?? null, reference: input.reference?.trim() || null,
    lines: billLines,
  }, actorId, { revaluations });

  // Link receipts → bill, and advance billed progress.
  const totalBilled = round2(touched.reduce((s, t) => s + t.amount, 0));
  for (const r of receipts) {
    await createLink(orgId, { fromType: "GoodsReceipt", fromId: r.id, toType: "Bill", toId: entry.id, relation: "receipt_bill", amount: 0, contextEntryId: entry.id }, actorId)
      .catch(e => console.error("[receipt_bill link]", e));
  }
  const lineById = new Map(lineRows.map(l => [l.id, l]));
  const perReceipt = new Map<string, number>();
  for (const t of touched) {
    await db.update(goodsReceiptLines).set({ billedQty: sql`${goodsReceiptLines.billedQty} + ${t.qty.toString()}` })
      .where(and(eq(goodsReceiptLines.id, t.lineId), eq(goodsReceiptLines.orgId, orgId)));
    const gl = lineById.get(t.lineId);
    if (gl?.poLineId) await db.update(tradeDocumentLines).set({ billedQty: sql`${tradeDocumentLines.billedQty} + ${t.qty.toString()}` })
      .where(and(eq(tradeDocumentLines.id, gl.poLineId), eq(tradeDocumentLines.orgId, orgId)));
    if (gl) perReceipt.set(gl.receiptId, round2((perReceipt.get(gl.receiptId) ?? 0) + t.amount));
  }
  for (const [rid, amt] of perReceipt) {
    await db.update(goodsReceipts).set({ billedAmount: sql`${goodsReceipts.billedAmount} + ${amt.toString()}`, updatedAt: new Date() })
      .where(and(eq(goodsReceipts.id, rid), eq(goodsReceipts.orgId, orgId)));
  }

  return { id: entry.id, docNumber: entry.docNumber, txnNo: entry.txnNo, billed: totalBilled };
}
