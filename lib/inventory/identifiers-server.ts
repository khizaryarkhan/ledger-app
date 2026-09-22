/**
 * Barcodes per packaging level — the server half (imports db). Every write to
 * item_identifiers goes through prepareIdentifiers() then writeIdentifiers(), so the rules hold
 * whichever screen, API or (later) the mobile scanner sets a code.
 */

import { db } from "@/db";
import { itemIdentifiers, apItems } from "@/db/schema";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";
import { classifyBarcode, showBarcode, PACK_LEVELS, type PackLevel, type Barcode } from "@/lib/inventory/identifiers";

export type IdentifierOwner = { itemSkuId?: string | null; supplierSkuId?: string | null };
/** Input shape from the drawers: one code per level, "" / null to clear it. */
export type IdentifierMap = Partial<Record<PackLevel, string | null>>;
type Prepared = { level: PackLevel; barcode: Barcode }[];

export class IdentifierError extends Error {}

/**
 * Validate a set of codes for one owner WITHOUT writing anything. Run it
 * before the owning row is created or changed: neon-http has no transactions,
 * so the only safe order is "check everything, then write".
 *
 * Refuses:
 *  - a malformed code, or a GTIN with a wrong check digit;
 *  - the same code on two levels of one owner (a bag and its carton are
 *    different quantities — one code cannot mean both);
 *  - a code that already identifies a DIFFERENT item. The same GTIN on
 *    another link for the SAME item is allowed: two distributors selling one
 *    manufacturer's product both carry the manufacturer's GTIN.
 */
export async function prepareIdentifiers(orgId: string, itemId: string, map: IdentifierMap | null | undefined, allowed: readonly PackLevel[] = PACK_LEVELS): Promise<Prepared | null> {
  if (map == null) return null;                     // not sent = leave the codes alone
  const out: Prepared = [];
  for (const level of PACK_LEVELS) {
    if (!(level in map)) continue;
    const c = classifyBarcode(map[level]);
    if ("error" in c) throw new IdentifierError(`${levelName(level)}: ${c.error}`);
    if (!c.barcode) continue;
    if (!allowed.includes(level)) throw new IdentifierError(`${levelName(level)}: this packaging has no ${levelName(level).toLowerCase()} level to put a barcode on.`);
    out.push({ level, barcode: c.barcode });
  }
  const seen = new Map<string, PackLevel>();
  for (const p of out) {
    const k = `${p.barcode.scheme}:${p.barcode.code}`;
    if (seen.has(k)) throw new IdentifierError(`${showBarcode(p.barcode)} is entered for both the ${levelName(seen.get(k)!).toLowerCase()} and the ${levelName(p.level).toLowerCase()} — each level is a different quantity and needs its own barcode.`);
    seen.set(k, p.level);
  }
  if (out.length) {
    const clash = await db.select({ code: itemIdentifiers.code, scheme: itemIdentifiers.scheme, name: apItems.name })
      .from(itemIdentifiers).innerJoin(apItems, eq(apItems.id, itemIdentifiers.itemId))
      .where(and(eq(itemIdentifiers.orgId, orgId), inArray(itemIdentifiers.code, out.map(p => p.barcode.code)), ne(itemIdentifiers.itemId, itemId)))
      .limit(1);
    if (clash.length) {
      const c = clash[0];
      throw new IdentifierError(`${showBarcode(c)} is already the barcode of "${c.name}". One barcode can only identify one item, or a scan could not tell them apart.`);
    }
  }
  return out;
}

/** Replace the owner's codes with the prepared set. `null` prepared = untouched. */
export async function writeIdentifiers(orgId: string, itemId: string, owner: IdentifierOwner, prepared: Prepared | null) {
  if (prepared == null) return;
  await db.delete(itemIdentifiers).where(and(eq(itemIdentifiers.orgId, orgId), eq(itemIdentifiers.itemId, itemId), ...ownerWhere(owner)));
  if (!prepared.length) return;
  await db.insert(itemIdentifiers).values(prepared.map(p => ({
    orgId, itemId,
    itemSkuId: owner.itemSkuId ?? null, supplierSkuId: owner.supplierSkuId ?? null,
    scheme: p.barcode.scheme, code: p.barcode.code, packLevel: p.level,
  })));
}

/** Every code on an item, for the register's GET. */
export async function identifiersForItem(orgId: string, itemId: string) {
  return db.select().from(itemIdentifiers).where(and(eq(itemIdentifiers.orgId, orgId), eq(itemIdentifiers.itemId, itemId)));
}

function ownerWhere(o: IdentifierOwner) {
  if (o.supplierSkuId) return [eq(itemIdentifiers.supplierSkuId, o.supplierSkuId)];
  if (o.itemSkuId) return [eq(itemIdentifiers.itemSkuId, o.itemSkuId)];
  return [isNull(itemIdentifiers.supplierSkuId), isNull(itemIdentifiers.itemSkuId)];
}

function levelName(l: PackLevel) {
  return ({ unit: "Unit", inner: "Inner pack", addl_inner: "Additional inner pack", outer: "Outer pack" } as const)[l];
}

/** Map a prepare/write error to an API 400, anything else rethrown. */
export const identifierErrorMessage = (e: unknown) => (e instanceof IdentifierError ? e.message : null);
