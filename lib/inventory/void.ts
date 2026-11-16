/**
 * Void (delete) inventory EVENTS — goods receipts, shipments, production runs.
 *
 * Same house rule as everything else: an event can be voided UNTIL something
 * depends on it. A receipt can't be voided once billed; a shipment once
 * invoiced; and any of them once the stock they moved has been consumed/sold on
 * (reverseInventoryByEntry enforces that). Voiding unwinds the GL entry, the
 * FIFO lot movements, the event rows, and the order (PO/SO) progress.
 *
 * neon-http has no transactions — we guard first (so nothing mutates on a
 * blocked void), then unwind.
 */

import { db } from "@/db";
import {
  goodsReceipts, goodsReceiptLines, salesShipments, shipmentLines,
  productionRuns, productionConsumptions, tradeDocumentLines,
  journalEntries, journalLines, transactionLinks, organisations, manufacturingOrders,
  jobWorkOrders, jobWorkReceipts, productionOutputs, moOutputs,
} from "@/db/schema";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { LedgerValidationError } from "@/lib/ledger";
import { reverseInventoryByEntry } from "@/lib/inventory/valuation";

const err = (m: string): never => { throw new LedgerValidationError(m); };

/** Delete a GL entry (lines + header + any links), guarding the period lock. */
export async function deleteEntry(orgId: string, entryId: string | null) {
  if (!entryId) return;
  const [entry] = await db.select({ date: journalEntries.entryDate }).from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId))).limit(1);
  if (!entry) return;
  const [org] = await db.select({ lock: organisations.bookCloseDate }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  if (org?.lock && entry.date <= org.lock) err(`The books are closed through ${org.lock}. Reopen the period to void this.`);
  await db.delete(transactionLinks).where(and(eq(transactionLinks.orgId, orgId), or(eq(transactionLinks.fromId, entryId), eq(transactionLinks.toId, entryId), eq(transactionLinks.contextEntryId, entryId))));
  await db.delete(journalLines).where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entryId)));
  await db.delete(journalEntries).where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId)));
}

export async function voidGoodsReceipt(orgId: string, receiptId: string) {
  const [r] = await db.select().from(goodsReceipts).where(and(eq(goodsReceipts.id, receiptId), eq(goodsReceipts.orgId, orgId))).limit(1);
  if (!r) err("Goods receipt not found.");
  if (Number(r!.billedAmount) > 0.005) err("This receipt has been billed — delete the bill first, then void the receipt.");
  const [billed] = await db.select({ id: transactionLinks.id }).from(transactionLinks)
    .where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.fromId, receiptId), eq(transactionLinks.relation, "receipt_bill"))).limit(1);
  if (billed) err("This receipt has a bill against it — delete the bill first.");

  // Unwind lots (throws if the received stock was already consumed/sold on).
  try { await reverseInventoryByEntry(orgId, r!.entryId ?? receiptId); }
  catch (e: any) { err(e?.message || "The received stock has already been used — undo those transactions first."); }

  // Restore PO received-qty for any linked lines.
  const lines = await db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.receiptId, receiptId));
  for (const l of lines) if (l.poLineId) await db.update(tradeDocumentLines)
    .set({ receivedQty: sql`greatest(${tradeDocumentLines.receivedQty} - ${l.qtyBase}, 0)` })
    .where(and(eq(tradeDocumentLines.id, l.poLineId), eq(tradeDocumentLines.orgId, orgId)));

  await deleteEntry(orgId, r!.entryId ?? null);
  await db.delete(goodsReceipts).where(and(eq(goodsReceipts.id, receiptId), eq(goodsReceipts.orgId, orgId))); // lines cascade
  return { id: receiptId, voided: true };
}

export async function voidShipment(orgId: string, shipmentId: string) {
  const [s] = await db.select().from(salesShipments).where(and(eq(salesShipments.id, shipmentId), eq(salesShipments.orgId, orgId))).limit(1);
  if (!s) err("Shipment not found.");
  if (Number(s!.invoicedAmount) > 0.005) err("This shipment has been invoiced — delete the invoice first, then void the shipment.");
  const [inv] = await db.select({ id: transactionLinks.id }).from(transactionLinks)
    .where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.fromId, shipmentId), eq(transactionLinks.relation, "shipment_invoice"))).limit(1);
  if (inv) err("This shipment has an invoice against it — delete the invoice first.");

  // Restores the relieved lots.
  try { await reverseInventoryByEntry(orgId, s!.entryId ?? shipmentId); }
  catch (e: any) { err(e?.message || "Could not unwind this shipment's stock movements."); }

  const lines = await db.select().from(shipmentLines).where(eq(shipmentLines.shipmentId, shipmentId));
  for (const l of lines) if (l.soLineId) await db.update(tradeDocumentLines)
    .set({ receivedQty: sql`greatest(${tradeDocumentLines.receivedQty} - ${l.qtyBase}, 0)` })
    .where(and(eq(tradeDocumentLines.id, l.soLineId), eq(tradeDocumentLines.orgId, orgId)));

  await deleteEntry(orgId, s!.entryId ?? null);
  await db.delete(salesShipments).where(and(eq(salesShipments.id, shipmentId), eq(salesShipments.orgId, orgId)));
  return { id: shipmentId, voided: true };
}

export async function voidProductionRun(orgId: string, runId: string) {
  const [run] = await db.select().from(productionRuns).where(and(eq(productionRuns.id, runId), eq(productionRuns.orgId, orgId))).limit(1);
  if (!run) err("Production run not found.");
  // Read before the run is deleted — its output rows cascade with it.
  const moOuts = (run as any)?.moId
    ? await db.select({ skuId: productionOutputs.skuId, packs: productionOutputs.qtyPacks }).from(productionOutputs)
        .where(and(eq(productionOutputs.orgId, orgId), eq(productionOutputs.runId, runId)))
    : [];

  const moId: string | null = (run as any).moId ?? null;
  if (moId) {
    // Do not unwind a run while its order is mid-completion (the claim of a dead process expires after 5 minutes).
    const [mo] = await db.select({ at: manufacturingOrders.completingAt }).from(manufacturingOrders)
      .where(and(eq(manufacturingOrders.id, moId), eq(manufacturingOrders.orgId, orgId))).limit(1);
    if (mo?.at && Date.now() - new Date(mo.at).getTime() < 5 * 60_000) err("This order is being completed right now. Try again in a moment.");
  }

  // Restores consumed input lots and removes the produced output lot — throws
  // if the produced stock has since been sold or consumed in another build.
  try { await reverseInventoryByEntry(orgId, run!.entryId ?? runId); }
  catch (e: any) { err(e?.message || "The produced stock has already been used — undo those transactions first."); }

  await deleteEntry(orgId, run!.entryId ?? null);
  await db.delete(productionRuns).where(and(eq(productionRuns.id, runId), eq(productionRuns.orgId, orgId))); // consumptions cascade

  // A completion of a Manufacturing Order (0099): take its packs back off the order. The consumed lots
  // are back in stock but NOT re-allocated — production picks them again, knowingly. A partial run leaves
  // the order InProgress; voiding the final run reopens it. The run pointer goes to the latest REMAINING run.
  if (moId) {
    try {
      for (const o of moOuts) {
        await db.update(moOutputs).set({ completedQty: sql`greatest(0, ${moOutputs.completedQty} - ${String(o.packs)})` })
          .where(and(eq(moOutputs.orgId, orgId), eq(moOutputs.moId, moId), o.skuId ? eq(moOutputs.skuId, o.skuId) : sql`${moOutputs.skuId} is null`));
      }
      const [latest] = await db.select({ id: productionRuns.id }).from(productionRuns)
        .where(and(eq(productionRuns.orgId, orgId), eq(productionRuns.moId, moId), eq(productionRuns.status, "Completed")))
        .orderBy(desc(productionRuns.createdAt)).limit(1);
      await db.update(manufacturingOrders).set({
        status: sql`case when ${manufacturingOrders.status} = 'Completed' then 'InProgress' else ${manufacturingOrders.status} end`,
        completedAt: sql`case when ${manufacturingOrders.status} = 'Completed' then null else ${manufacturingOrders.completedAt} end`,
        productionRunId: latest?.id ?? null, updatedAt: new Date(),
      }).where(and(eq(manufacturingOrders.orgId, orgId), eq(manufacturingOrders.id, moId)));
    } catch (e) {
      // The entry, stock and run are already gone; only the order's counters are stale. Say exactly which.
      console.error(`[void production run] run ${runId} of MO ${moId} was voided but the order's progress was not updated — fix completed_qty / status by hand`, e);
      throw e;
    }
  } else {
    // Older builds from an MO, before completions were runs: drop the MO back
    // to Released so it can be re-built.
    await db.update(manufacturingOrders)
      .set({ status: "Released", productionRunId: null, updatedAt: new Date() })
      .where(and(eq(manufacturingOrders.orgId, orgId), eq(manufacturingOrders.productionRunId, runId)));
  }

  return { id: runId, voided: true };
}

/**
 * Void a job work order — dispatch-only, or dispatch + any number of partial
 * receipts, + a close/wastage write-off if the order was closed. Refuses if
 * any receipt's processing-fee bill has already been created (mirrors
 * voidGoodsReceipt's guard — each receipt IS an ordinary goods_receipts row,
 * see lib/inventory/jobwork.ts's receiveFromJobWork), or if any received
 * stock has been consumed downstream (reverseInventoryByEntry enforces that).
 * Unwinds newest-first: the wastage entry (if closed), then every receipt
 * tranche, then the dispatch leg (restores the originally sent item's lot).
 */
export async function voidJobWorkOrder(orgId: string, jwoId: string) {
  const [jwo] = await db.select().from(jobWorkOrders).where(and(eq(jobWorkOrders.id, jwoId), eq(jobWorkOrders.orgId, orgId))).limit(1);
  if (!jwo) err("Job work order not found.");

  const receipts = await db.select().from(jobWorkReceipts).where(and(eq(jobWorkReceipts.orgId, orgId), eq(jobWorkReceipts.jobWorkOrderId, jwoId)));

  // Guard every receipt's fee bill BEFORE mutating anything.
  for (const r of receipts) {
    if (!r.receiptId) continue;
    const [receipt] = await db.select().from(goodsReceipts).where(and(eq(goodsReceipts.id, r.receiptId), eq(goodsReceipts.orgId, orgId))).limit(1);
    if (receipt && Number(receipt.billedAmount) > 0.005) err("A processing-fee bill has been created for one of this order's receipts — delete the bill first, then void.");
    const [billed] = await db.select({ id: transactionLinks.id }).from(transactionLinks)
      .where(and(eq(transactionLinks.orgId, orgId), eq(transactionLinks.fromId, r.receiptId), eq(transactionLinks.relation, "receipt_bill"))).limit(1);
    if (billed) err("One of this order's receipts has a bill against it — delete the bill first.");
  }

  if (jwo!.wastageEntryId) await deleteEntry(orgId, jwo!.wastageEntryId); // GL-only, no inventory to unwind

  for (const r of receipts) {
    try { await reverseInventoryByEntry(orgId, r.receiveEntryId ?? r.id); }
    catch (e: any) { err(e?.message || "The received stock has already been used — undo those transactions first."); }
    await deleteEntry(orgId, r.receiveEntryId ?? null);
    if (r.receiptId) await db.delete(goodsReceipts).where(and(eq(goodsReceipts.id, r.receiptId), eq(goodsReceipts.orgId, orgId))); // lines cascade
  }
  await db.delete(jobWorkReceipts).where(and(eq(jobWorkReceipts.orgId, orgId), eq(jobWorkReceipts.jobWorkOrderId, jwoId)));

  // Restores the sent item's lot — throws if it's somehow already been
  // consumed further (shouldn't happen: dispatched material only ever leaves
  // via this same job work order's receipts, already unwound above).
  try { await reverseInventoryByEntry(orgId, jwo!.dispatchEntryId ?? jwoId); }
  catch (e: any) { err(e?.message || "Could not unwind this job work order's dispatch."); }
  await deleteEntry(orgId, jwo!.dispatchEntryId ?? null);

  await db.delete(jobWorkOrders).where(and(eq(jobWorkOrders.id, jwoId), eq(jobWorkOrders.orgId, orgId)));
  return { id: jwoId, voided: true };
}

/** Void a stock count or a write-down: remove its entry and undo its stock side exactly. */
export async function voidStockAdjustment(orgId: string, entryId: string) {
  const [e] = await db.select({ id: journalEntries.id, type: journalEntries.sourceType }).from(journalEntries)
    .where(and(eq(journalEntries.id, entryId), eq(journalEntries.orgId, orgId))).limit(1);
  if (!e || !["StockCount", "WriteDown"].includes(e.type ?? "")) err("Stock adjustment not found.");
  try { await reverseInventoryByEntry(orgId, entryId); }
  catch (x: any) { err(x?.message || "Stock this adjustment added has since been used — undo that first."); }
  await deleteEntry(orgId, entryId);
  return { id: entryId, voided: true };
}
