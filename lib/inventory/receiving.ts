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
import { goodsReceipts, goodsReceiptLines, tradeDocumentLines, organisations, inventoryLots, transactionLinks, journalLines, journalEntries } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import { loadItemCostInfo, commitReceipt, type ItemCostInfo } from "@/lib/inventory/valuation";
import { roleAccount } from "@/lib/accounting/account-roles-server";
import { resolveLocationId } from "@/lib/inventory/locations";
import { nextDocNumber } from "@/lib/accounting/numbering";
import { postDocument, updateDocument, hasSettlementLink, type DocRevaluation } from "@/lib/accounting/documents";
import { createLink } from "@/lib/accounting/links";
import { round2, round4, round6, roundQty } from "@/lib/inventory/round";
import { requiresApproval, stagePendingApproval } from "@/lib/inventory/approvals";
import { voidGoodsReceipt } from "@/lib/inventory/void";

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

/**
 * Re-runs postGoodsReceipt's own up-front, read-only checks (date, lines
 * present, items resolve and are tracked, currency/rate) — WITHOUT writing
 * anything — so a mistake in the correction itself is caught before the
 * original receipt is voided, not after. Deliberately duplicated rather than
 * extracted into postGoodsReceipt's own body: postGoodsReceipt stays the one,
 * unmodified create path; this is purely a pre-void safety check for edit.
 */
async function preflightReceipt(orgId: string, input: ReceiptInput) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.receiptDate)) err("A valid receipt date is required.");
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
  for (const r of rows) {
    const item = itemMap.get(r.itemId);
    if (!item) err(`Item ${r.itemId} not found.`);
    if (!item!.tracked) err(`${item!.name} isn't an inventory-tracked item — only tracked items can be received into stock.`);
  }
  await resolveLocationId(orgId, input.locationId, { label: "Receiving location" });
}

/**
 * Correct an already-posted receipt. This ledger is immutable and
 * reversal-only (see CLAUDE.md's "Accounting foundation" section) — there is
 * no in-place edit of a posted GL entry anywhere in this app, and a goods
 * receipt is no exception. "Editing" here means: validate the correction
 * first (preflightReceipt), void the original receipt (voidGoodsReceipt —
 * the SAME guards a manual void already enforces: refused if billed, refused
 * if the received stock has since been consumed/sold on), then post the
 * corrected lines as a fresh receipt. The PO's receivedQty is restored by the
 * void and re-advanced by the repost, so it ends up correct either way.
 */
export async function editGoodsReceipt(orgId: string, receiptId: string, input: ReceiptInput, actorId: string | null) {
  await preflightReceipt(orgId, input);
  await voidGoodsReceipt(orgId, receiptId);
  return postGoodsReceipt(orgId, input, actorId);
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
 * Build the GRNI (+ optional purchase-price-variance) lines for billing `qty`
 * of one goods-receipt line at its own recorded cost — and, if `invoicePrice`
 * differs from that, the P-03 price-variance split. Shared by billFromReceipts
 * (create) and editBillFromReceipts (in-place correction) so the two can never
 * compute this differently; what changes between them is only where `qty` and
 * `invoicePrice` come from.
 */
function receiptLineBillCalc(
  it: ItemCostInfo, l: typeof goodsReceiptLines.$inferSelect, qty: number, fx: number,
  invoicePrice: number | undefined, lot: typeof inventoryLots.$inferSelect | undefined, taxRateId: string | null,
): { lines: any[]; amount: number; revaluation?: DocRevaluation } {
  const toTxn = (homeAmount: number) => round2(homeAmount / fx);
  // Match the receipt's rounding basis (round4 then round2) so GR/IR clears
  // to exactly zero when a receipt line is fully billed.
  const amount = round2(round4(qty * Number(l.unitCost)));
  const lines: any[] = [{ accountId: roleAccount(it, "GRNI"), itemId: null, description: l.description ?? "Received goods", qty, rate: round6(Number(l.unitCost) / fx), amount: toTxn(amount), taxRateId }];
  let revaluation: DocRevaluation | undefined;
  // The invoice at a different price: GRNI still clears at the receipt's
  // value (above); the difference is its own line, to purchase price
  // variance, and the part of it on stock still in the lot is then moved
  // into the lot's cost.
  if (invoicePrice != null && Number.isFinite(invoicePrice) && invoicePrice >= 0 && qty > 0) {
    // Invoice prices are entered in the bill's (the receipt's) currency.
    const diff = round2(round2(qty * invoicePrice * fx) - amount);
    if (Math.abs(diff) >= 0.005) {
      const ppv = it.accounts?.roles.PURCHASE_PRICE_VARIANCE;
      if (!ppv) err(`${it.name}: its posting group has no Purchase price variance account — map it under Accounting → Setup → Posting Groups.`);
      lines.push({ accountId: ppv, itemId: null, description: `Price difference — ${it.name}`, qty, rate: round6(diff / fx / qty), amount: toTxn(diff), taxRateId });
      const stillHeld = lot && Number(lot.origQty) > 0 ? Math.min(1, Math.max(0, Number(lot.remainingQty) / Number(lot.origQty))) : 0;
      const toStock = round2(diff * stillHeld);
      if (lot && Math.abs(toStock) >= 0.005) revaluation = { lotId: lot.id, amount: toStock, assetAccountId: it.assetAccountId!, ppvAccountId: ppv!, itemName: it.name };
    }
  }
  return { lines, amount, revaluation };
}

/**
 * The journal_lines row each billed receipt line's GRNI debit landed on, so a
 * caller can link to it. `touched` must be in the SAME order the lines were
 * built in: buildSalesPurchaseLines' Bill branch preserves input.lines order
 * for every debit line and appends tax/control lines strictly afterward, so
 * the first N journal_lines rows (ordered by lineNo, N = total rows touched
 * produced) correspond 1:1, in order, to the billed lines — including when a
 * receipt line produced two rows (GRNI + a price-variance line). The GRNI row
 * (the first of each group) is the one a receipt_bill link points at.
 */
async function postedGrniRows(orgId: string, entryId: string, touched: { rowCount: number }[]): Promise<string[]> {
  const totalRows = touched.reduce((s, t) => s + t.rowCount, 0);
  const posted = await db.select({ id: journalLines.id }).from(journalLines)
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entryId))).orderBy(journalLines.lineNo).limit(totalRows);
  const out: string[] = [];
  let offset = 0;
  for (const t of touched) { out.push(posted[offset]?.id ?? null as any); offset += t.rowCount; }
  return out;
}

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

  const lineRows = await db.select().from(goodsReceiptLines)
    .where(and(eq(goodsReceiptLines.orgId, orgId), inArray(goodsReceiptLines.receiptId, input.receiptIds)));

  // Each line clears the GRNI of its item's group — the account its receipt
  // credited — so GR/IR nets to zero per account, not just in total.
  const lineItems = await loadItemCostInfo(orgId, lineRows.map(l => l.itemId).filter(Boolean) as string[]);

  // Bill the un-billed remainder of each receipt line (qty basis).
  const billLines: any[] = [];
  const touched: { lineId: string; qty: number; amount: number; rowCount: number }[] = [];
  const priceFor = new Map((input.prices ?? []).filter(p => p?.lineId && Number.isFinite(Number(p.unitCost)) && Number(p.unitCost) >= 0).map(p => [String(p.lineId), Number(p.unitCost)]));
  const revaluations: DocRevaluation[] = [];
  const lotIds = lineRows.map(l => l.lotId).filter(Boolean) as string[];
  const lots = lotIds.length ? await db.select().from(inventoryLots).where(and(eq(inventoryLots.orgId, orgId), inArray(inventoryLots.id, lotIds))) : [];
  const lotById = new Map(lots.map(l => [l.id, l]));
  for (const l of lineRows) {
    const rem = roundQty(Number(l.qtyBase) - Number(l.billedQty));
    if (rem <= 0) continue;
    const amount = round2(round4(rem * Number(l.unitCost)));
    if (amount <= 0) continue;
    const it = l.itemId ? lineItems.get(l.itemId) : undefined;
    if (!it) err(`The item on receipt line "${l.description ?? l.id}" no longer exists.`);
    const lot = l.lotId ? lotById.get(l.lotId) : undefined;
    const calc = receiptLineBillCalc(it!, l, rem, fx, priceFor.get(l.id), lot, input.taxRateId ?? null);
    billLines.push(...calc.lines);
    touched.push({ lineId: l.id, qty: rem, amount: calc.amount, rowCount: calc.lines.length });
    if (calc.revaluation) revaluations.push(calc.revaluation);
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

  // Link EACH BILLED LINE (not each receipt) to the bill, carrying its own
  // qty + amount + the exact journal_lines row it produced — the foundation
  // for the matching-table UI and for editBillFromReceipts below. linksFor()
  // collapses these back into one "Related transactions" row per receipt.
  const grniRowIds = await postedGrniRows(orgId, entry.id, touched);
  const lineById = new Map(lineRows.map(l => [l.id, l]));
  const perReceipt = new Map<string, number>();
  for (let i = 0; i < touched.length; i++) {
    const t = touched[i];
    const gl = lineById.get(t.lineId);
    if (!gl) continue;
    await createLink(orgId, {
      fromType: "GoodsReceipt", fromId: gl.receiptId, fromLineId: t.lineId,
      toType: "Bill", toId: entry.id, toLineId: grniRowIds[i] ?? null,
      relation: "receipt_bill", amount: t.amount, qty: t.qty, contextEntryId: entry.id,
    }, actorId).catch(e => console.error("[receipt_bill link]", e));
    await db.update(goodsReceiptLines).set({ billedQty: sql`${goodsReceiptLines.billedQty} + ${t.qty.toString()}` })
      .where(and(eq(goodsReceiptLines.id, t.lineId), eq(goodsReceiptLines.orgId, orgId)));
    if (gl.poLineId) await db.update(tradeDocumentLines).set({ billedQty: sql`${tradeDocumentLines.billedQty} + ${t.qty.toString()}` })
      .where(and(eq(tradeDocumentLines.id, gl.poLineId), eq(tradeDocumentLines.orgId, orgId)));
    perReceipt.set(gl.receiptId, round2((perReceipt.get(gl.receiptId) ?? 0) + t.amount));
  }
  const totalBilled = round2(touched.reduce((s, t) => s + t.amount, 0));
  for (const [rid, amt] of perReceipt) {
    await db.update(goodsReceipts).set({ billedAmount: sql`${goodsReceipts.billedAmount} + ${amt.toString()}`, updatedAt: new Date() })
      .where(and(eq(goodsReceipts.id, rid), eq(goodsReceipts.orgId, orgId)));
  }

  return { id: entry.id, docNumber: entry.docNumber, txnNo: entry.txnNo, billed: totalBilled };
}

export type EditBillFromReceiptsInput = {
  billDate?: string;
  dueDate?: string | null;
  reference?: string | null;
  memo?: string | null;
  /** Only the lines being corrected — every other line on the Bill is carried
   *  forward unchanged (see editBillFromReceipts' own doc comment). */
  lines: { linkId: string; qty: number; unitCost?: number }[];
};

/**
 * Correct the qty and/or invoice price of one or more already-billed receipt
 * lines, IN PLACE — same Bill id, same BILL- number (QBO parity, unlike a
 * Goods Receipt's own void-and-repost correction). Safe across accounting
 * periods by construction: the Goods Receipt's own journal entry (Dr
 * Inventory / Cr GR/IR), dated on ITS OWN date, is never touched — only the
 * Bill's own entry (dated on the BILL's own date) is reposted, and only the
 * receipt line's running "how much has been billed so far" counters change,
 * which are bookkeeping metadata, not a dated posting, so a closed GRN period
 * has no bearing on this. Which receipt lines are ON this Bill can't change
 * here (add/remove a line is a delete-and-recreate case, consistent with how
 * every other structural document change already works in this app) — only
 * their qty/price can.
 *
 * `linkId` identifies the existing transaction_links (relation=receipt_bill)
 * row for the line being corrected. A line NOT named in `input.lines` is
 * reproduced byte-identical from the Bill's own stored sourcePayload — this
 * is also how a line's own already-applied price-variance (P-03) survives an
 * edit to a DIFFERENT line on the same Bill, with no separate bookkeeping of
 * "what price was used" needed: the original posted line IS the record.
 */
export async function editBillFromReceipts(orgId: string, billEntryId: string, input: EditBillFromReceiptsInput, actorId: string | null) {
  const [entry] = await db.select().from(journalEntries)
    .where(and(eq(journalEntries.id, billEntryId), eq(journalEntries.orgId, orgId))).limit(1);
  if (!entry) err("Transaction not found.");
  if (entry.sourceType !== "Bill") err("This isn't a Bill.");
  if (entry.status === "Reversed") err("This Bill has been reversed and can't be edited.");

  const existingLinks = await db.select().from(transactionLinks)
    .where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.toId, billEntryId), eq(transactionLinks.toType, "Bill"), eq(transactionLinks.relation, "receipt_bill")));
  if (!existingLinks.length) err("This Bill wasn't created from a goods receipt, so it can't be corrected here.");

  if (await hasSettlementLink(orgId, billEntryId)) err("This document has payments or credits applied to it — remove those first before editing.");

  const [org] = await db.select({ home: organisations.currency, lock: organisations.bookCloseDate }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const home = (org?.home ?? "PKR").toUpperCase();
  const date = input.billDate ?? entry.entryDate;
  if (org?.lock && (entry.entryDate <= org.lock || date <= org.lock)) err(`The books are closed through ${org.lock}. Reopen the period to edit here.`);

  // The Bill's own posting input, stored verbatim at creation/last edit — its
  // `.lines` IS the exact billLines array (no tax/control lines; postDocument
  // appends those itself), so an unedited line is reproduced from here with
  // no reconstruction needed at all, and a changed one is simply replaced.
  const base: any = entry.sourcePayload ?? {};
  const baseLines: any[] = Array.isArray(base.lines) ? base.lines : [];
  const currency = (base.currency || home).toUpperCase();
  const fx = currency === home ? 1 : (Number(base.exchangeRate) || 1);

  const edits = new Map((input.lines ?? []).filter(l => l?.linkId && Number.isFinite(Number(l.qty)) && Number(l.qty) > 0).map(l => [l.linkId, l]));
  if (!edits.size) err("Nothing to change.");
  for (const id of edits.keys()) if (!existingLinks.some(lk => lk.id === id)) err("That line isn't on this Bill.");

  // Map each link to its position in baseLines via the journal_lines row it
  // points at (toLineId) — the two arrays share the same order and the same
  // count (see billFromReceipts/postedGrniRows's own comment on this).
  const postedRows = await db.select({ id: journalLines.id }).from(journalLines)
    .where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, billEntryId))).orderBy(journalLines.lineNo);
  const indexOfRowId = new Map(postedRows.map((r, i) => [r.id, i]));
  const ordered = existingLinks
    .map(lk => ({ lk, idx: lk.toLineId ? indexOfRowId.get(lk.toLineId) : undefined }))
    .filter((x): x is { lk: typeof existingLinks[number]; idx: number } => x.idx != null)
    .sort((a, b) => a.idx - b.idx);
  if (ordered.length !== existingLinks.length) err("This Bill's lines could not be matched to its ledger entry — reconcile before editing.");

  // Load every receipt line + item + lot being edited, once.
  const editedLineIds = [...edits.keys()].map(id => existingLinks.find(lk => lk.id === id)!.fromLineId).filter(Boolean) as string[];
  const grLines = editedLineIds.length ? await db.select().from(goodsReceiptLines).where(and(eq(goodsReceiptLines.orgId, orgId), inArray(goodsReceiptLines.id, editedLineIds))) : [];
  const grLineById = new Map(grLines.map(l => [l.id, l]));
  const itemMap = await loadItemCostInfo(orgId, grLines.map(l => l.itemId).filter(Boolean) as string[]);
  const lotIds = grLines.map(l => l.lotId).filter(Boolean) as string[];
  const lots = lotIds.length ? await db.select().from(inventoryLots).where(and(eq(inventoryLots.orgId, orgId), inArray(inventoryLots.id, lotIds))) : [];
  const lotById = new Map(lots.map(l => [l.id, l]));

  const newBillLines: any[] = [];
  const revaluations: DocRevaluation[] = [];
  // Per-line qty/amount deltas to apply to goods_receipt_lines/tradeDocumentLines
  // once the repost succeeds (revert the old contribution, apply the new one).
  const deltas: { receiptLineId: string; poLineId: string | null; receiptId: string; qtyDelta: number; amountDelta: number }[] = []; // receiptId used to post the delta onto goods_receipts.billedAmount
  // Fresh receipt_bill links to (re)create once the new journal_lines exist.
  const relinkPlan: { receiptId: string; receiptLineId: string; qty: number; amount: number; rowCount: number }[] = [];

  for (const { lk, idx } of ordered) {
    const edit = edits.get(lk.id);
    if (!edit) {
      // Unchanged — carry its existing line(s) forward byte-identical. A
      // price-variance companion line (if any) always immediately follows
      // its GRNI line (see receiptLineBillCalc), so it rides along for free.
      const group = [baseLines[idx]];
      const next = baseLines[idx + 1];
      if (next && typeof next.description === "string" && next.description.startsWith("Price difference — ")) group.push(next);
      newBillLines.push(...group.filter(Boolean));
      relinkPlan.push({ receiptId: lk.fromId, receiptLineId: lk.fromLineId!, qty: Number(lk.qty ?? 0), amount: Number(lk.amount), rowCount: group.filter(Boolean).length });
      continue;
    }
    const gl = lk.fromLineId ? grLineById.get(lk.fromLineId) : undefined;
    if (!gl) err("A billed receipt line could not be found — it may have been removed.");
    const it = gl!.itemId ? itemMap.get(gl!.itemId) : undefined;
    if (!it) err(`The item on receipt line "${gl!.description ?? gl!.id}" no longer exists.`);
    const oldQty = Number(lk.qty ?? 0);
    const available = roundQty(Number(gl!.qtyBase) - Number(gl!.billedQty) + oldQty);
    const newQty = roundQty(Number(edit.qty));
    if (newQty <= 0) err("Enter a quantity greater than zero, or leave this line unchanged.");
    if (newQty > available + 0.000001) err(`Only ${available} ${gl!.description ? "of \"" + gl!.description + "\"" : ""} is available to bill on this line.`);
    const lot = gl!.lotId ? lotById.get(gl!.lotId) : undefined;
    const calc = receiptLineBillCalc(it!, gl!, newQty, fx, edit.unitCost, lot, baseLines[idx]?.taxRateId ?? null);
    newBillLines.push(...calc.lines);
    if (calc.revaluation) revaluations.push(calc.revaluation);
    deltas.push({ receiptLineId: gl!.id, poLineId: gl!.poLineId ?? null, receiptId: gl!.receiptId, qtyDelta: roundQty(newQty - oldQty), amountDelta: round2(calc.amount - Number(lk.amount)) });
    relinkPlan.push({ receiptId: gl!.receiptId, receiptLineId: gl!.id, qty: newQty, amount: calc.amount, rowCount: calc.lines.length });
  }
  if (!newBillLines.length) err("A Bill needs at least one line.");

  await updateDocument(orgId, billEntryId, {
    type: "Bill", date,
    memo: input.memo !== undefined ? (input.memo?.trim() || null) : (entry.memo ?? null),
    partyType: "Vendor", partyId: base.partyId ?? null, partyLabel: base.partyLabel ?? null,
    ...(currency !== home ? { currency, exchangeRate: fx } : {}),
    dueDate: input.dueDate !== undefined ? input.dueDate : (base.dueDate ?? null),
    reference: input.reference !== undefined ? (input.reference?.trim() || null) : (base.reference ?? null),
    lines: newBillLines,
  }, actorId, { revaluations });

  // Apply the quantity/amount deltas to the receipt lines' running counters —
  // metadata, not a dated posting, so this never touches a closed period.
  for (const d of deltas) {
    if (d.qtyDelta !== 0) {
      await db.update(goodsReceiptLines).set({ billedQty: sql`${goodsReceiptLines.billedQty} + ${d.qtyDelta.toString()}` })
        .where(and(eq(goodsReceiptLines.id, d.receiptLineId), eq(goodsReceiptLines.orgId, orgId)));
      if (d.poLineId) await db.update(tradeDocumentLines).set({ billedQty: sql`${tradeDocumentLines.billedQty} + ${d.qtyDelta.toString()}` })
        .where(and(eq(tradeDocumentLines.id, d.poLineId), eq(tradeDocumentLines.orgId, orgId)));
    }
    if (d.amountDelta !== 0) await db.update(goodsReceipts).set({ billedAmount: sql`${goodsReceipts.billedAmount} + ${d.amountDelta.toString()}`, updatedAt: new Date() })
      .where(and(eq(goodsReceipts.id, d.receiptId), eq(goodsReceipts.orgId, orgId)));
  }

  // Replace EVERY receipt_bill link for this Bill — editing deletes and
  // reinserts ALL of the entry's journal_lines (updateDocument's own in-place
  // mechanism), so every existing toLineId is now stale, not just the edited
  // lines'. Fresh links are created in the same grniIdx order newBillLines
  // was assembled in, matching the freshly reposted rows 1:1.
  await db.delete(transactionLinks).where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.toId, billEntryId), eq(transactionLinks.toType, "Bill"), eq(transactionLinks.relation, "receipt_bill")));
  const newGrniRowIds = await postedGrniRows(orgId, billEntryId, relinkPlan.map(r => ({ rowCount: r.rowCount })));
  for (let i = 0; i < relinkPlan.length; i++) {
    const r = relinkPlan[i];
    await createLink(orgId, {
      fromType: "GoodsReceipt", fromId: r.receiptId, fromLineId: r.receiptLineId,
      toType: "Bill", toId: billEntryId, toLineId: newGrniRowIds[i] ?? null,
      relation: "receipt_bill", amount: r.amount, qty: r.qty, contextEntryId: billEntryId,
    }, actorId).catch(e => console.error("[receipt_bill relink]", e));
  }

  return { id: billEntryId, edited: true };
}
