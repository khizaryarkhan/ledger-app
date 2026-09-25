/**
 * Stock counts and write-downs (P-15, P-16).
 *
 * COUNT — set a lot to what was physically counted. The difference moves at
 * THAT LOT'S cost: a shortfall is issued out of the lot, a surplus comes back
 * into it, and either posts against Inventory adjustments. Stock found with no
 * lot to belong to becomes a new lot at a cost the counter states. A count may
 * not take a lot below what manufacturing orders have allocated from it —
 * release the allocation first, or the order would consume stock that is gone.
 *
 * WRITE-DOWN — lower one lot's unit cost (net realisable value, expiry,
 * damage, recall …). Only that lot changes; the reduction posts Dr Inventory
 * write-downs / Cr the stock account. A write-UP is refused: cost is not
 * raised by opinion.
 *
 * Both post one entry (series ADJ-) and are voidable: the entry is removed and
 * reverseInventoryByEntry undoes the stock side exactly.
 */

import { db } from "@/db";
import { inventoryLots, apItems } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { postJournalEntry, LedgerValidationError, type PostLine } from "@/lib/ledger";
import { loadItemCostInfo, planIssue, commitIssue, commitLotIncrease, commitReceipt, revalueLot, allocatedByLot } from "@/lib/inventory/valuation";
import { roleAccount } from "@/lib/accounting/account-roles-server";
import { resolveLocationId } from "@/lib/inventory/locations";
import { round2, round6, roundQty, QTY_EPSILON } from "@/lib/inventory/round";

const err = (m: string): never => { throw new LedgerValidationError(m); };
const num = (v: any) => Number(v ?? 0);

export const WRITEDOWN_REASONS = ["NRV", "Expiry", "Damage", "Recall", "Other"] as const;
export type WritedownReason = typeof WRITEDOWN_REASONS[number];

export type CountInput = {
  date: string;
  lines: { lotId: string; countedQty: number }[];
  /** Stock found that belongs to no lot: a new lot at the stated cost. */
  found?: { itemId: string; qty: number; unitCost: number; lotNo?: string | null; locationId?: string | null }[];
  notes?: string | null;
};

export async function postStockCount(orgId: string, input: CountInput, actorId: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) err("A valid count date is required.");
  const lines = (input.lines ?? []).map(l => ({ lotId: String(l.lotId), counted: roundQty(Math.max(0, Number(l.countedQty) || 0)) }));
  const found = (input.found ?? []).filter(f => f?.itemId && Number(f.qty) > 0);
  if (!lines.length && !found.length) err("Count at least one lot.");
  if (found.some(f => !(Number(f.unitCost) >= 0) || f.unitCost === null || f.unitCost === undefined)) err("Found stock needs a unit cost — it becomes a new lot at that cost.");

  const lots = lines.length ? await db.select().from(inventoryLots).where(and(eq(inventoryLots.orgId, orgId), inArray(inventoryLots.id, lines.map(l => l.lotId)))) : [];
  const byId = new Map(lots.map(l => [l.id, l]));
  const reserved = await allocatedByLot(orgId, lots.map(l => l.id), null);
  const items = await loadItemCostInfo(orgId, [...lots.map(l => l.itemId), ...found.map(f => f.itemId)]);

  type Delta = { lotId: string; itemId: string; delta: number; unitCost: number };
  const deltas: Delta[] = [];
  for (const l of lines) {
    const lot = byId.get(l.lotId);
    if (!lot) err("One of the counted lots was not found.");
    const item = items.get(lot!.itemId);
    if (!item?.tracked) err("Only stocked items are counted.");
    const held = reserved.get(lot!.id) ?? 0;
    if (l.counted + QTY_EPSILON < held) err(`Lot ${lot!.lotNo ?? ""}: ${roundQty(held)} of it is allocated to manufacturing orders, so the count can't be below that. Release the allocation first.`);
    const delta = roundQty(l.counted - num(lot!.remainingQty));
    if (Math.abs(delta) > QTY_EPSILON) deltas.push({ lotId: lot!.id, itemId: lot!.itemId, delta, unitCost: num(lot!.unitCost) });
  }
  if (!deltas.length && !found.length) err("Every counted lot already matches — nothing to adjust.");

  // Plan the losses (read-only) before anything is written.
  const issues: { itemId: string; plan: Awaited<ReturnType<typeof planIssue>> }[] = [];
  const lineAmts: { itemId: string; amount: number }[] = [];   // + gain, − loss
  for (const d of deltas) {
    const item = items.get(d.itemId)!;
    if (d.delta < 0) {
      const plan = await planIssue(orgId, item, -d.delta, { exactPicks: [{ lotId: d.lotId, qty: -d.delta }] });
      if (plan.shortfallQty > 0) err(`${item.name}: the lot no longer holds what the count says was lost — recount it.`);
      issues.push({ itemId: d.itemId, plan });
      lineAmts.push({ itemId: d.itemId, amount: -round2(plan.totalCost) });
    } else {
      lineAmts.push({ itemId: d.itemId, amount: round2(d.delta * d.unitCost) });
    }
  }
  for (const f of found) lineAmts.push({ itemId: f.itemId, amount: round2(Number(f.qty) * Number(f.unitCost)) });

  const lines2: PostLine[] = [];
  for (const [itemId, amount] of sumBy(lineAmts)) {
    if (Math.abs(amount) < 0.005) continue;
    const item = items.get(itemId)!;
    const adj = roleAccount(item, "INVENTORY_ADJUSTMENT");
    if (amount > 0) { lines2.push({ accountId: item.assetAccountId!, debit: amount, description: `Count gain — ${item.name}` }); lines2.push({ accountId: adj, credit: amount, description: `Count gain — ${item.name}` }); }
    else { lines2.push({ accountId: adj, debit: -amount, description: `Count loss — ${item.name}` }); lines2.push({ accountId: item.assetAccountId!, credit: -amount, description: `Count loss — ${item.name}` }); }
  }
  const entry = lines2.length ? await postJournalEntry({
    orgId, entryDate: input.date, memo: input.notes?.trim() || "Stock count", series: "Adjustment", sourceType: "StockCount", createdBy: actorId, lines: lines2,
  }) : null;
  const ref = entry?.id ?? `count-${Date.now()}`;

  for (const i of issues) await commitIssue(orgId, { itemId: i.itemId, plan: i.plan, movementType: "adjustment", refType: "StockCount", refId: ref, entryId: entry?.id ?? null, date: input.date, createdBy: actorId, note: input.notes ?? "Count loss" });
  for (const d of deltas.filter(x => x.delta > 0)) {
    await commitLotIncrease(orgId, { itemId: d.itemId, picks: [{ lotId: d.lotId, qty: d.delta, unitCost: d.unitCost }], movementType: "adjustment", refType: "StockCount", refId: ref, entryId: entry?.id ?? null, date: input.date, createdBy: actorId, note: input.notes ?? "Count gain", locationId: null });
  }
  for (const f of found) {
    const item = items.get(f.itemId)!;
    await commitReceipt(orgId, {
      itemId: f.itemId, qty: roundQty(Number(f.qty)), unitCost: round6(Number(f.unitCost)), productType: item.productType, lotNo: f.lotNo ?? null,
      sourceType: "adjustment", receivedDate: input.date, refType: "StockCount", refId: ref, entryId: entry?.id ?? null, createdBy: actorId,
      note: "Found in count", locationId: f.locationId ? await resolveLocationId(orgId, f.locationId, { label: "Location" }) : null,
    });
  }
  return { entryId: entry?.id ?? null, docNumber: entry?.docNumber ?? null, adjusted: deltas.length + found.length };
}

export type WritedownInput = { date: string; lotId: string; newUnitCost: number; reason: WritedownReason; notes?: string | null };

export async function writeDownLot(orgId: string, input: WritedownInput, actorId: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) err("A valid date is required.");
  if (!(WRITEDOWN_REASONS as readonly string[]).includes(input.reason)) err("Choose a reason: NRV, Expiry, Damage, Recall or Other.");
  const [lot] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.id, String(input.lotId)), eq(inventoryLots.orgId, orgId))).limit(1);
  if (!lot) err("Lot not found.");
  const rem = num(lot!.remainingQty);
  if (rem <= QTY_EPSILON) err("That lot holds nothing to write down.");
  const newCost = Number(input.newUnitCost);
  if (!(newCost >= 0)) err("Enter the lot's new unit cost (zero or more).");
  if (newCost > num(lot!.unitCost) + 1e-9) err("A write-down can only lower a lot's cost.");
  const amount = round2((num(lot!.unitCost) - newCost) * rem);
  if (amount < 0.005) err("That is no change to the lot's value.");
  const item = (await loadItemCostInfo(orgId, [lot!.itemId])).get(lot!.itemId)!;
  const acct = roleAccount(item, "INVENTORY_WRITEDOWN");
  const entry = await postJournalEntry({
    orgId, entryDate: input.date, series: "Adjustment", sourceType: "WriteDown", createdBy: actorId,
    memo: `Write-down (${input.reason}) — ${item.name} lot ${lot!.lotNo ?? ""}${input.notes?.trim() ? ` · ${input.notes.trim()}` : ""}`,
    lines: [
      { accountId: acct, debit: amount, description: `Write-down (${input.reason}) — ${item.name}` },
      { accountId: item.assetAccountId!, credit: amount, description: `Write-down (${input.reason}) — lot ${lot!.lotNo ?? ""}` },
    ],
  });
  await revalueLot(orgId, { lotId: lot!.id, deltaTotal: -amount, refType: "WriteDown", refId: entry.id, entryId: entry.id, date: input.date, createdBy: actorId, note: `${input.reason}${input.notes ? ` · ${input.notes}` : ""}` });
  return { entryId: entry.id, docNumber: entry.docNumber, amount };
}

function sumBy(rows: { itemId: string; amount: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.itemId, round2((m.get(r.itemId) ?? 0) + r.amount));
  return m;
}

/** Recent counts and write-downs, for the Stock Adjustments screen. */
export async function listAdjustments(orgId: string) {
  const { journalEntries, journalLines } = await import("@/db/schema");
  const { desc, sql } = await import("drizzle-orm");
  const rows = await db.select({
    id: journalEntries.id, docNumber: journalEntries.docNumber, date: journalEntries.entryDate, kind: journalEntries.sourceType, memo: journalEntries.memo,
    amount: sql<string>`(select coalesce(sum(${journalLines.debit}),0) from ${journalLines} where ${journalLines.entryId} = ${journalEntries.id})`,
  }).from(journalEntries)
    .where(and(eq(journalEntries.orgId, orgId), inArray(journalEntries.sourceType, ["StockCount", "WriteDown"])))
    .orderBy(desc(journalEntries.entryDate), desc(journalEntries.createdAt)).limit(200);
  return rows.map(r => ({ ...r, amount: num(r.amount) / 2 }));
}

/** Open lots of an item, for the count and write-down drawers. */
export async function lotsForItem(orgId: string, itemId: string) {
  const rows = await db.select().from(inventoryLots)
    .where(and(eq(inventoryLots.orgId, orgId), eq(inventoryLots.itemId, itemId), eq(inventoryLots.status, "Open")));
  const reserved = await allocatedByLot(orgId, rows.map(r => r.id), null);
  const [it] = await db.select({ baseUom: apItems.baseUom }).from(apItems).where(eq(apItems.id, itemId)).limit(1);
  return rows.map(r => ({ id: r.id, lotNo: r.lotNo, remaining: num(r.remainingQty), unitCost: num(r.unitCost), expiryDate: r.expiryDate, receivedDate: r.receivedDate, allocated: roundQty(reserved.get(r.id) ?? 0), baseUom: it?.baseUom ?? null }));
}
