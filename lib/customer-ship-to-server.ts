/**
 * Customer delivery addresses (0141), the server half (imports db). Every write
 * goes through here. Pure rules: lib/customer-ship-to.ts.
 *
 * neon-http has no transactions: everything is checked before writing, and the
 * partial unique indexes in 0141 (one default, one row per code, one per GLN)
 * are the real guard against a race; a 23505 becomes the same message.
 */

import { db } from "@/db";
import { partyShipTo, parties, tradeDocuments } from "@/db/schema";
import { and, eq, ne, sql, asc, desc } from "drizzle-orm";
import { shipToValues, shipToCodeKey, type ShipToValues } from "@/lib/customer-ship-to";

export class ShipToError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const shipToErrorOf = (e: unknown) => (e instanceof ShipToError ? e : null);

const isUniqueViolation = (e: any) => e?.code === "23505" || /duplicate key|unique constraint/i.test(String(e?.message ?? ""));

async function requireCustomer(orgId: string, partyId: string) {
  const [p] = await db.select({ id: parties.id }).from(parties)
    .where(and(eq(parties.id, partyId), eq(parties.orgId, orgId), eq(parties.partyType, "customer"))).limit(1);
  if (!p) throw new ShipToError("Customer not found.", 404);
}

/** Friendly versions of the unique indexes: same code or GLN twice for one customer. */
async function assertNoClash(orgId: string, partyId: string, v: ShipToValues, exceptId?: string) {
  const others = await db.select({ id: partyShipTo.id, name: partyShipTo.name, code: partyShipTo.code, gln: partyShipTo.gln })
    .from(partyShipTo).where(and(eq(partyShipTo.orgId, orgId), eq(partyShipTo.partyId, partyId), ...(exceptId ? [ne(partyShipTo.id, exceptId)] : [])));
  if (v.code) {
    const hit = others.find(o => o.code && shipToCodeKey(o.code) === shipToCodeKey(v.code!));
    if (hit) throw new ShipToError(`The location code ${v.code} is already used for "${hit.name}". One code names one place, or an order could not be routed.`, 409);
  }
  if (v.gln) {
    const hit = others.find(o => o.gln === v.gln);
    if (hit) throw new ShipToError(`GLN ${v.gln} is already "${hit.name}".`, 409);
  }
}

/** Stand the current default down FIRST (no transactions): a brief window with none is recoverable, a failed write is not. */
async function standDownDefault(orgId: string, partyId: string, exceptId?: string) {
  await db.update(partyShipTo).set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(partyShipTo.orgId, orgId), eq(partyShipTo.partyId, partyId), eq(partyShipTo.isDefault, true), ...(exceptId ? [ne(partyShipTo.id, exceptId)] : [])));
}

export async function listShipTo(orgId: string, partyId: string, opts: { activeOnly?: boolean } = {}) {
  return db.select().from(partyShipTo)
    .where(and(eq(partyShipTo.orgId, orgId), eq(partyShipTo.partyId, partyId), ...(opts.activeOnly ? [eq(partyShipTo.status, "Active")] : [])))
    .orderBy(desc(partyShipTo.isDefault), asc(partyShipTo.name));
}

export async function createShipTo(orgId: string, partyId: string, body: any) {
  await requireCustomer(orgId, partyId);
  const r = shipToValues(body, { creating: true });
  if ("error" in r) throw new ShipToError(r.error);
  const v = r.values;
  if (v.status === "Inactive") v.isDefault = false;
  await assertNoClash(orgId, partyId, v);
  // The first active address a customer gets is its default: one place is obviously where it delivers.
  const existing = await listShipTo(orgId, partyId, { activeOnly: true });
  const isDefault = v.status !== "Inactive" && (v.isDefault === true || existing.length === 0);
  if (isDefault) await standDownDefault(orgId, partyId);
  try {
    const [row] = await db.insert(partyShipTo).values({ ...v, name: v.name!, orgId, partyId, isDefault } as any).returning();
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new ShipToError("Another delivery address for this customer was saved at the same moment with the same code, GLN or default. Reload and check.", 409);
    throw e;
  }
}

export async function updateShipTo(orgId: string, partyId: string, id: string, body: any) {
  const [existing] = await db.select().from(partyShipTo)
    .where(and(eq(partyShipTo.id, id), eq(partyShipTo.orgId, orgId), eq(partyShipTo.partyId, partyId))).limit(1);
  if (!existing) throw new ShipToError("Delivery address not found.", 404);
  const r = shipToValues(body, { creating: false });
  if ("error" in r) throw new ShipToError(r.error);
  const v = r.values;
  // Deactivating the default drops the default with it; nothing is promoted silently.
  if (v.status === "Inactive") v.isDefault = false;
  if (v.isDefault && (v.status ?? existing.status) === "Inactive") throw new ShipToError("An inactive delivery address can't be the default.");
  await assertNoClash(orgId, partyId, { ...v, code: v.code !== undefined ? v.code : existing.code, gln: v.gln !== undefined ? v.gln : existing.gln }, id);
  if (v.isDefault && !existing.isDefault) await standDownDefault(orgId, partyId, id);
  try {
    const [row] = await db.update(partyShipTo).set({ ...v, updatedAt: new Date() } as any)
      .where(and(eq(partyShipTo.id, id), eq(partyShipTo.orgId, orgId))).returning();
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new ShipToError("Another delivery address for this customer was saved at the same moment with the same code, GLN or default. Reload and check.", 409);
    throw e;
  }
}

/**
 * Delete only while no sales order names it. A used one is deactivated instead:
 * the FK would otherwise null the order's delivery address and the order would
 * quietly stop saying where it goes.
 */
export async function deleteShipTo(orgId: string, partyId: string, id: string) {
  const [existing] = await db.select({ id: partyShipTo.id }).from(partyShipTo)
    .where(and(eq(partyShipTo.id, id), eq(partyShipTo.orgId, orgId), eq(partyShipTo.partyId, partyId))).limit(1);
  if (!existing) throw new ShipToError("Delivery address not found.", 404);
  const [used] = await db.select({ n: sql<number>`count(*)::int` }).from(tradeDocuments)
    .where(and(eq(tradeDocuments.orgId, orgId), eq(tradeDocuments.customerShipToId, id)));
  if (Number(used?.n ?? 0) > 0) {
    throw new ShipToError(`${used.n} sales order${Number(used.n) === 1 ? " is" : "s are"} delivered to this address, so it can't be deleted. Set it to Inactive instead.`, 409);
  }
  await db.delete(partyShipTo).where(and(eq(partyShipTo.id, id), eq(partyShipTo.orgId, orgId)));
}

/**
 * The delivery address a new Sales Order takes. A client-supplied id must be an
 * ACTIVE address of THIS customer in THIS org. `undefined` = not said: the
 * customer's default, if it has one. `null` / "" = explicitly none.
 */
export async function resolveSalesOrderShipTo(orgId: string, partyId: string | null | undefined, requested: string | null | undefined): Promise<string | null> {
  if (!partyId) {
    if (requested) throw new ShipToError("Pick the customer before its delivery address.");
    return null;
  }
  if (requested === null || requested === "") return null;
  if (requested === undefined) {
    const [d] = await db.select({ id: partyShipTo.id }).from(partyShipTo)
      .where(and(eq(partyShipTo.orgId, orgId), eq(partyShipTo.partyId, partyId), eq(partyShipTo.isDefault, true), eq(partyShipTo.status, "Active"))).limit(1);
    return d?.id ?? null;
  }
  const [row] = await db.select({ id: partyShipTo.id, status: partyShipTo.status }).from(partyShipTo)
    .where(and(eq(partyShipTo.id, String(requested)), eq(partyShipTo.orgId, orgId), eq(partyShipTo.partyId, partyId))).limit(1);
  if (!row) throw new ShipToError("That delivery address is not one of this customer's.");
  if (row.status !== "Active") throw new ShipToError("That delivery address is inactive.");
  return row.id;
}

/**
 * What a customer's place identifier means (for an inbound order's N1*ST): GLN
 * first, then the customer's own location code. Exact match only; an unknown
 * place is a question for a person, never a guess. Active addresses only.
 */
export async function findShipTo(orgId: string, partyId: string, ident: { gln?: string | null; code?: string | null }) {
  const rows = await listShipTo(orgId, partyId, { activeOnly: true });
  const gln = ident.gln?.replace(/[\s-]/g, "");
  if (gln) { const hit = rows.find(r => r.gln === gln); if (hit) return hit; }
  if (ident.code?.trim()) { const k = shipToCodeKey(ident.code); const hit = rows.find(r => r.code && shipToCodeKey(r.code) === k); if (hit) return hit; }
  return null;
}
