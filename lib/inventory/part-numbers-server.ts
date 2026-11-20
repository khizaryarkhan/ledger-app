/**
 * Part-number cross-references, the server half (imports db). Every write to
 * item_part_numbers goes through here, so the "one partner code means one thing"
 * rule holds whichever screen or (later) EDI import sets a code. Pure rules:
 * lib/inventory/part-numbers.ts.
 *
 * neon-http has no transactions: every check runs before anything is written,
 * and the unique indexes in 0140 are the real guard against a race (a 23505 is
 * turned into a plain message).
 */

import { db } from "@/db";
import { itemPartNumbers, apItems, parties, itemSkus } from "@/db/schema";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { PackLevel } from "@/lib/inventory/identifiers";
import {
  preparePartNumberMap, normalisePartNumber, partLevelName, partNumbersByLevel, customerLevels,
  type PartNumberMap, type PreparedPart, type PartSide,
} from "@/lib/inventory/part-numbers";

export class PartNumberError extends Error {}
export const partNumberErrorMessage = (e: unknown) => (e instanceof PartNumberError ? e.message : null);

const isUniqueViolation = (e: any) => e?.code === "23505" || /duplicate key|unique constraint/i.test(String(e?.message ?? ""));

/**
 * Refuse a code this partner already uses for something else. `ownRows` are the
 * ids this save replaces, so re-saving the same code on the same owner is fine.
 */
async function assertNoPartnerClash(orgId: string, partyId: string, side: PartSide, parts: PreparedPart[], ownRows: string[]) {
  if (!parts.length) return;
  const clash = await db.select({ id: itemPartNumbers.id, code: itemPartNumbers.code, level: itemPartNumbers.packLevel, name: apItems.name })
    .from(itemPartNumbers).innerJoin(apItems, eq(apItems.id, itemPartNumbers.itemId))
    .where(and(eq(itemPartNumbers.orgId, orgId), eq(itemPartNumbers.partyId, partyId), eq(itemPartNumbers.side, side),
      inArray(itemPartNumbers.codeKey, parts.map(p => p.key))));
  const other = clash.find(c => !ownRows.includes(c.id));
  if (other) {
    throw new PartNumberError(`${other.code} is already this ${side}'s part number for "${other.name}" (${partLevelName(other.level as PackLevel).toLowerCase()}). One ${side} code can only mean one item and pack, or an order line could not be matched.`);
  }
}

/* ------------------------------- Supplier side ------------------------------- */

/**
 * Validate a supplier link's part numbers WITHOUT writing. `supplierSkuId` is
 * null for a link not created yet (nothing of its own to exclude).
 */
export async function prepareSupplierPartNumbers(orgId: string, supplierId: string, supplierSkuId: string | null, map: PartNumberMap | null | undefined, allowed: readonly PackLevel[]): Promise<PreparedPart[] | null> {
  const p = preparePartNumberMap(map, allowed);
  if (p.ok === false) throw new PartNumberError(p.error);
  if (!p.parts) return null;
  const own = supplierSkuId
    ? (await db.select({ id: itemPartNumbers.id }).from(itemPartNumbers).where(and(eq(itemPartNumbers.orgId, orgId), eq(itemPartNumbers.supplierSkuId, supplierSkuId)))).map(r => r.id)
    : [];
  await assertNoPartnerClash(orgId, supplierId, "supplier", p.parts, own);
  return p.parts;
}

/** Replace a link's part numbers with the prepared set. `null` = untouched. */
export async function writeSupplierPartNumbers(orgId: string, itemId: string, supplierId: string, supplierSkuId: string, parts: PreparedPart[] | null) {
  if (parts == null) return;
  await db.delete(itemPartNumbers).where(and(eq(itemPartNumbers.orgId, orgId), eq(itemPartNumbers.supplierSkuId, supplierSkuId)));
  if (!parts.length) return;
  try {
    await db.insert(itemPartNumbers).values(parts.map(p => ({
      orgId, itemId, partyId: supplierId, side: "supplier", supplierSkuId, packLevel: p.level, code: p.code, codeKey: p.key,
    })));
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    // Lost a race with another save after the pre-check. The link's old codes were
    // already removed above; say so rather than report a clean save.
    console.error("[part-numbers] supplier link part numbers lost a race; codes not saved", { orgId, supplierSkuId });
    throw new PartNumberError("Another change to this supplier's part numbers was saved at the same moment, so these part numbers were not saved. Open the link again and re-enter them.");
  }
}

/** { supplierSkuId: { level: code } } for document lines. */
export async function supplierPartNumbersFor(orgId: string, supplierSkuIds: string[]): Promise<Map<string, PartNumberMap>> {
  const out = new Map<string, PartNumberMap>();
  if (!supplierSkuIds.length) return out;
  const rows = await db.select({ sid: itemPartNumbers.supplierSkuId, packLevel: itemPartNumbers.packLevel, code: itemPartNumbers.code })
    .from(itemPartNumbers).where(and(eq(itemPartNumbers.orgId, orgId), inArray(itemPartNumbers.supplierSkuId, supplierSkuIds)));
  const grouped = new Map<string, { packLevel: string; code: string }[]>();
  for (const r of rows) if (r.sid) grouped.set(r.sid, [...(grouped.get(r.sid) ?? []), r]);
  grouped.forEach((v, k) => out.set(k, partNumbersByLevel(v)));
  return out;
}

/* ------------------------------- Customer side ------------------------------- */

export type CustomerPartInput = { customerId: string; itemId: string; itemSkuId?: string | null; packLevel?: string | null; code: string };

/**
 * Set (add or replace) one customer's part number for one of our items, at one
 * level. The customer, item and SKU are re-checked against the org: none of them
 * comes from a trusted source.
 */
export async function setCustomerPartNumber(orgId: string, input: CustomerPartInput) {
  const [customer] = await db.select({ id: parties.id }).from(parties)
    .where(and(eq(parties.id, String(input.customerId ?? "")), eq(parties.orgId, orgId), eq(parties.partyType, "customer"))).limit(1);
  if (!customer) throw new PartNumberError("Customer not found.");
  const [item] = await db.select({ id: apItems.id }).from(apItems).where(and(eq(apItems.id, String(input.itemId ?? "")), eq(apItems.orgId, orgId))).limit(1);
  if (!item) throw new PartNumberError("Item not found.");
  const skuId = input.itemSkuId ? String(input.itemSkuId) : null;
  let sku: any = null;
  if (skuId) {
    [sku] = await db.select().from(itemSkus).where(and(eq(itemSkus.id, skuId), eq(itemSkus.orgId, orgId), eq(itemSkus.itemId, item.id))).limit(1);
    if (!sku) throw new PartNumberError("That sales SKU does not belong to this item.");
  }
  const level = (input.packLevel || "unit") as PackLevel;
  const n = normalisePartNumber(input.code);
  if (n.ok === false) throw new PartNumberError(n.error);
  if (!n.code) throw new PartNumberError("Enter the customer's part number.");
  if (!customerLevels(sku).includes(level)) {
    throw new PartNumberError(sku ? `That SKU has no ${partLevelName(level).toLowerCase()} level.` : "Without a sales SKU a part number names the item's base unit. Pick a SKU to give a pack its own number.");
  }
  // The row this replaces: same customer, item, SKU and level.
  const own = await db.select({ id: itemPartNumbers.id }).from(itemPartNumbers).where(and(
    eq(itemPartNumbers.orgId, orgId), eq(itemPartNumbers.partyId, customer.id), eq(itemPartNumbers.side, "customer"),
    eq(itemPartNumbers.itemId, item.id), skuId ? eq(itemPartNumbers.itemSkuId, skuId) : isNull(itemPartNumbers.itemSkuId),
    eq(itemPartNumbers.packLevel, level)));
  await assertNoPartnerClash(orgId, customer.id, "customer", [{ level, code: n.code, key: n.key! }], own.map(r => r.id));
  try {
    if (own.length) {
      const [row] = await db.update(itemPartNumbers).set({ code: n.code, codeKey: n.key! })
        .where(and(eq(itemPartNumbers.id, own[0].id), eq(itemPartNumbers.orgId, orgId))).returning();
      return row;
    }
    const [row] = await db.insert(itemPartNumbers).values({
      orgId, itemId: item.id, partyId: customer.id, side: "customer", itemSkuId: skuId, packLevel: level, code: n.code, codeKey: n.key!,
    }).returning();
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new PartNumberError(`${n.code} was just saved for something else of this customer's. Reload and check.`);
    throw e;
  }
}

/** Remove one customer part number. Scoped to the org and to the customer side. */
export async function deleteCustomerPartNumber(orgId: string, id: string) {
  const r = await db.delete(itemPartNumbers)
    .where(and(eq(itemPartNumbers.id, id), eq(itemPartNumbers.orgId, orgId), eq(itemPartNumbers.side, "customer"))).returning({ id: itemPartNumbers.id });
  return r.length > 0;
}

/** Every customer part number for an item, with names, for the item panel. */
export async function customerPartNumbersForItem(orgId: string, itemId: string) {
  return db.select({
    id: itemPartNumbers.id, customerId: itemPartNumbers.partyId, customerName: parties.name,
    itemSkuId: itemPartNumbers.itemSkuId, skuName: itemSkus.skuName, packLevel: itemPartNumbers.packLevel, code: itemPartNumbers.code,
  }).from(itemPartNumbers)
    .innerJoin(parties, eq(parties.id, itemPartNumbers.partyId))
    .leftJoin(itemSkus, eq(itemSkus.id, itemPartNumbers.itemSkuId))
    .where(and(eq(itemPartNumbers.orgId, orgId), eq(itemPartNumbers.itemId, itemId), eq(itemPartNumbers.side, "customer")))
    .orderBy(parties.name, itemPartNumbers.code);
}

/* --------------------------------- Lookup --------------------------------- */

/**
 * What a partner's code means: one item (+ the supplier link or sales SKU) at
 * one pack level, or null. Exact key match only: an unknown code is a question
 * for a person (the EDI review queue), never a near match.
 */
export async function resolvePartNumber(orgId: string, partyId: string, side: PartSide, code: string) {
  const n = normalisePartNumber(code);
  if (!n.ok || !n.key) return null;
  const [row] = await db.select({
    itemId: itemPartNumbers.itemId, supplierSkuId: itemPartNumbers.supplierSkuId, itemSkuId: itemPartNumbers.itemSkuId, packLevel: itemPartNumbers.packLevel,
  }).from(itemPartNumbers)
    .where(and(eq(itemPartNumbers.orgId, orgId), eq(itemPartNumbers.partyId, partyId), eq(itemPartNumbers.side, side), eq(itemPartNumbers.codeKey, n.key)))
    .limit(1);
  return row ?? null;
}

/** Supplier-side part numbers on an item, for the register's GET. */
export async function supplierPartNumbersForItem(orgId: string, itemId: string) {
  return db.select({ supplierSkuId: itemPartNumbers.supplierSkuId, packLevel: itemPartNumbers.packLevel, code: itemPartNumbers.code })
    .from(itemPartNumbers).where(and(eq(itemPartNumbers.orgId, orgId), eq(itemPartNumbers.itemId, itemId), eq(itemPartNumbers.side, "supplier")));
}
