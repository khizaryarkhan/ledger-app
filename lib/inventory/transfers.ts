/**
 * Stock transfer — move inventory between locations.
 *
 * A transfer changes WHERE stock is, never what it cost. No lot is created, no
 * lot balance changes, and the FIFO cost layer keeps its identity and its place
 * in the queue — only the placement (inventory_lot_locations) moves. That is
 * why this file does NOT go through commitIssue/commitReceipt: both of those
 * change the lot's remaining balance, which would be wrong here and would also
 * re-date the cost layer, quietly corrupting FIFO order.
 *
 * GL: NONE (P-18). Which account stock sits in is decided by the item's
 * posting group role, never by where it is — so moving it, including to a
 * subcontractor's site, changes nothing in the books. The per-location
 * `stock_locations.inventory_account_id` override is no longer read: receipts
 * never honoured it, so a transfer that did was the only thing that could put
 * stock into an account nothing else would ever relieve. The reclass branch
 * below is kept only so an entry is still posted if a future rule ever makes
 * the two sides differ; today they are always the same account.
 *
 * Transfers are the RELEASE mechanism out of a Quarantine location — so unlike
 * a sale or a production issue, the source is deliberately NOT checked with
 * forIssue. Releasing inspected stock is a decision someone makes, not a side
 * effect of picking.
 *
 * neon-http has no transactions — plan read-only, post the entry (if any), then
 * move placements keyed to it, same discipline as receiving.ts and shipping.ts.
 */

import { db } from "@/db";
import {
  stockTransfers, stockTransferLines, stockLocations,
  inventoryLots, inventoryMovements, apItems,
} from "@/db/schema";
import { and, eq, inArray, desc, sql } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import { loadItemCostInfo, planIssue, recalcItemCache } from "@/lib/inventory/valuation";
import { resolveLocationId, placeQty, takeQty } from "@/lib/inventory/locations";
import { nextDocNumber } from "@/lib/accounting/numbering";
import { round2, round4, round6, roundQty } from "@/lib/inventory/round";

const err = (m: string): never => { throw new LedgerValidationError(m); };

export type TransferLineInput = {
  itemId: string;
  skuId?: string | null;
  /** Move these exact lots. Omitted lets FIFO choose from the source location. */
  lotIds?: string[];
  qtyBase: number;
  description?: string | null;
};

export type TransferInput = {
  transferDate: string;          // YYYY-MM-DD
  fromLocationId: string;
  toLocationId: string;
  notes?: string | null;
  lines: TransferLineInput[];
};

export async function postStockTransfer(orgId: string, input: TransferInput, actorId: string | null) {
  const date = input.transferDate;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) err("A valid transfer date is required.");

  const rows = (input.lines ?? []).filter(l => l.itemId && Math.abs(Number(l.qtyBase) || 0) > 0);
  if (!rows.length) err("Add at least one line with an item and a quantity to move.");

  // Both resolved (and tenancy-checked) before anything is written. The source
  // is NOT checked with forIssue — see the file header: a transfer is how stock
  // legitimately leaves Quarantine.
  const fromLocationId = await resolveLocationId(orgId, input.fromLocationId, { label: "Source location" });
  const toLocationId   = await resolveLocationId(orgId, input.toLocationId,   { label: "Destination location" });
  if (fromLocationId === toLocationId) err("The source and destination locations are the same — nothing would move.");

  const [fromLoc] = await db.select().from(stockLocations)
    .where(and(eq(stockLocations.id, fromLocationId), eq(stockLocations.orgId, orgId))).limit(1);
  const [toLoc] = await db.select().from(stockLocations)
    .where(and(eq(stockLocations.id, toLocationId), eq(stockLocations.orgId, orgId))).limit(1);

  const itemMap = await loadItemCostInfo(orgId, rows.map(r => r.itemId));

  // ── Plan (read-only) ────────────────────────────────────────────────────
  type PlannedMove = {
    itemId: string; itemName: string; skuId: string | null; lotId: string;
    qty: number; unitCost: number; amount: number;
    fromAccountId: string; toAccountId: string; description: string | null;
  };
  const moves: PlannedMove[] = [];

  for (const r of rows) {
    const item = itemMap.get(r.itemId);
    if (!item) err(`Item ${r.itemId} not found.`);
    if (!item!.tracked) err(`${item!.name} isn't inventory-tracked — there is no stock of it to move.`);

    const qty = roundQty(Math.abs(Number(r.qtyBase) || 0));
    const plan = await planIssue(orgId, item!, qty, {
      skuId: r.skuId ?? null,
      locationId: fromLocationId,
      restrictLotIds: r.lotIds?.length ? r.lotIds : undefined,
      // Moving stock that an MO has allocated is allowed: it changes where the
      // lot is, not whose it is, and the allocation stays on the lot.
      ignoreAllocations: true,
    });

    if (plan.shortfallQty > 0) {
      const available = roundQty(qty - plan.shortfallQty);
      err(
        `${item!.name}: only ${available} of ${qty} is available at ${fromLoc?.name ?? "the source location"}` +
        (r.lotIds?.length ? " in the selected lot(s)." : ".")
      );
    }

    // Same account both sides: the item's group inventory role. See header.
    const itemAsset = item!.assetAccountId!;
    const fromAccountId = itemAsset;
    const toAccountId   = itemAsset;

    for (const pick of plan.picks) {
      // planIssue with a locationId can only return located picks or a
      // shortfall, and the shortfall was rejected above — so this is defensive.
      if (!pick.lotId) continue;
      moves.push({
        itemId: item!.id, itemName: item!.name, skuId: r.skuId ?? null, lotId: pick.lotId,
        qty: roundQty(pick.qty), unitCost: round6(pick.unitCost),
        amount: round4(pick.qty * pick.unitCost),
        fromAccountId, toAccountId, description: r.description ?? null,
      });
    }
  }

  if (!moves.length) err("Nothing to move — check the quantities.");

  // ── GL, only when the two sides land in different accounts ───────────────
  const glLines: PostLine[] = [];
  let totalCost = 0;
  const reclass = new Map<string, number>();   // "from>to" -> amount
  for (const m of moves) {
    totalCost = round4(totalCost + m.amount);
    if (m.fromAccountId === m.toAccountId) continue;
    const key = `${m.fromAccountId}>${m.toAccountId}`;
    reclass.set(key, round2((reclass.get(key) ?? 0) + m.amount));
  }
  for (const [key, amount] of reclass) {
    if (amount <= 0) continue;
    const [fromAcct, toAcct] = key.split(">");
    glLines.push({ accountId: toAcct,   debit:  amount, description: `Stock transferred in — ${toLoc?.name ?? ""}` });
    glLines.push({ accountId: fromAcct, credit: amount, description: `Stock transferred out — ${fromLoc?.name ?? ""}` });
  }

  const transferNo = await nextDocNumber(orgId, "StockTransfer");
  const entry = glLines.length
    ? await postJournalEntry({
        orgId, entryDate: date,
        memo: input.notes?.trim() || `Stock transfer ${transferNo} — ${fromLoc?.name} → ${toLoc?.name}`,
        series: "StockTransfer", sourceType: "StockTransfer", docNumber: transferNo, createdBy: actorId,
        reference: `${fromLoc?.code ?? ""} → ${toLoc?.code ?? ""}`, lines: glLines,
      })
    : null;

  const [transfer] = await db.insert(stockTransfers).values({
    orgId, transferNo, transferDate: date,
    fromLocationId, toLocationId, status: "Posted",
    entryId: entry?.id ?? null, totalCost: totalCost.toString(),
    notes: input.notes?.trim() || null, createdBy: actorId,
  } as any).returning({ id: stockTransfers.id });
  const transferId = transfer.id;
  const refId = entry?.id ?? transferId;

  // ── Commit: placements only. Lot balances are untouched by design. ───────
  const touchedItems = new Set<string>();
  for (const m of moves) {
    const taken = await takeQty(orgId, m.lotId, fromLocationId, m.qty);
    if (taken <= 0) {
      // The plan was read moments ago and something else moved it since. Place
      // nothing (stock that was not taken must not appear at the destination —
      // that would create inventory out of nothing) and say so loudly.
      console.error(`[stock transfer] nothing to take: lot=${m.lotId} from=${fromLocationId} wanted=${m.qty} transfer=${transferId}`);
      continue;
    }
    await placeQty(orgId, m.lotId, toLocationId, taken);
    if (taken < m.qty) {
      console.error(`[stock transfer] partial take: lot=${m.lotId} wanted=${m.qty} moved=${taken} transfer=${transferId}`);
    }

    await db.insert(inventoryMovements).values({
      orgId, itemId: m.itemId, skuId: m.skuId, lotId: m.lotId,
      movementType: "transfer",
      qty: taken.toString(), unitCost: m.unitCost.toString(), totalCost: round4(taken * m.unitCost).toString(),
      fromLocationId, toLocationId,
      refType: "StockTransfer", refId, entryId: entry?.id ?? null,
      movementDate: date, note: m.description, createdBy: actorId,
    } as any);

    await db.insert(stockTransferLines).values({
      orgId, transferId, itemId: m.itemId, skuId: m.skuId, lotId: m.lotId,
      qty: taken.toString(), unitCost: m.unitCost.toString(), amount: round4(taken * m.unitCost).toString(),
      description: m.description,
    } as any);

    touchedItems.add(m.itemId);
  }

  // Total on-hand has not changed, but recalculating is cheap and keeps this
  // path identical in shape to every other stock-moving path — one less place
  // where someone has to remember an exception.
  for (const itemId of touchedItems) await recalcItemCache(orgId, itemId);

  return { id: transferId, transferNo, entryId: entry?.id ?? null, totalCost, lines: moves.length };
}

/** Transfers for the register, newest first. */
export async function listStockTransfers(orgId: string, opts: { limit?: number; locationId?: string | null } = {}) {
  const limit = Math.min(Math.max(Number(opts.limit) || 100, 1), 500);
  const rows = await db.select({
    id: stockTransfers.id,
    transferNo: stockTransfers.transferNo,
    transferDate: stockTransfers.transferDate,
    status: stockTransfers.status,
    totalCost: stockTransfers.totalCost,
    entryId: stockTransfers.entryId,
    notes: stockTransfers.notes,
    fromLocationId: stockTransfers.fromLocationId,
    toLocationId: stockTransfers.toLocationId,
  })
    .from(stockTransfers)
    .where(eq(stockTransfers.orgId, orgId))
    .orderBy(desc(stockTransfers.transferDate), desc(stockTransfers.createdAt))
    .limit(limit);

  const locIds = [...new Set(rows.flatMap(r => [r.fromLocationId, r.toLocationId]))];
  const locs = locIds.length
    ? await db.select({ id: stockLocations.id, code: stockLocations.code, name: stockLocations.name })
        .from(stockLocations).where(and(eq(stockLocations.orgId, orgId), inArray(stockLocations.id, locIds)))
    : [];
  const byId = new Map(locs.map(l => [l.id, l]));

  const filtered = opts.locationId
    ? rows.filter(r => r.fromLocationId === opts.locationId || r.toLocationId === opts.locationId)
    : rows;

  return filtered.map(r => ({
    ...r,
    fromLocation: byId.get(r.fromLocationId) ?? null,
    toLocation: byId.get(r.toLocationId) ?? null,
  }));
}

/** One transfer with its lines, for the detail drawer. */
export async function stockTransferDetail(orgId: string, id: string) {
  const [header] = await db.select().from(stockTransfers)
    .where(and(eq(stockTransfers.id, id), eq(stockTransfers.orgId, orgId))).limit(1);
  if (!header) return null;

  const lines = await db.select({
    id: stockTransferLines.id,
    itemId: stockTransferLines.itemId,
    itemName: apItems.name,
    lotId: stockTransferLines.lotId,
    lotNo: inventoryLots.lotNo,
    qty: stockTransferLines.qty,
    unitCost: stockTransferLines.unitCost,
    amount: stockTransferLines.amount,
    description: stockTransferLines.description,
  })
    .from(stockTransferLines)
    .leftJoin(apItems, eq(apItems.id, stockTransferLines.itemId))
    .leftJoin(inventoryLots, eq(inventoryLots.id, stockTransferLines.lotId))
    .where(and(eq(stockTransferLines.transferId, id), eq(stockTransferLines.orgId, orgId)));

  const locs = await db.select({ id: stockLocations.id, code: stockLocations.code, name: stockLocations.name })
    .from(stockLocations)
    .where(and(eq(stockLocations.orgId, orgId), inArray(stockLocations.id, [header.fromLocationId, header.toLocationId])));
  const byId = new Map(locs.map(l => [l.id, l]));

  return {
    ...header,
    fromLocation: byId.get(header.fromLocationId) ?? null,
    toLocation: byId.get(header.toLocationId) ?? null,
    lines,
  };
}
