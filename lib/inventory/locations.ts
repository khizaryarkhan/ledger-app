/**
 * Stock locations — the physical places inventory sits.
 *
 * Deliberately distinct from the `Location` GL dimension (ap_dimensions), which
 * is a reporting tag on a journal line. This is a real place with real stock in
 * it; an org may have both and they need not agree.
 *
 * SECURITY — this file is the single choke point for turning a client-supplied
 * location id into one this org may actually post to. `resolveLocationId()` is
 * called by every stock-moving path, so the tenancy check lives here once
 * instead of in each caller, where one omission would be a cross-tenant write.
 * A Postgres foreign key proves a location row EXISTS; only this check proves it
 * belongs to the caller. Same reasoning as ownsInOrg() in lib/api.ts, and the
 * same reasoning that put the pay-link org check in one resolver rather than in
 * all seven send paths.
 *
 * neon-http has NO transactions — see the ensureDefaultLocation note on how the
 * one race that matters is closed by a unique index rather than a lock.
 */

import { db } from "@/db";
import { stockLocations, inventoryLotLocations, inventoryLots } from "@/db/schema";
import { and, eq, ne, sql, asc, inArray } from "drizzle-orm";

export const LOCATION_TYPES = ["Store", "WIP", "FinishedGoods", "Transit", "Quarantine"] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

export const LOCATION_TYPE_LABELS: Record<LocationType, string> = {
  Store:         "Store",
  WIP:           "Work in progress",
  FinishedGoods: "Finished goods",
  Transit:       "In transit",
  Quarantine:    "Quarantine",
};

/** Human explanation of what each type is for — shown in the location form. */
export const LOCATION_TYPE_HINTS: Record<LocationType, string> = {
  Store:         "Raw materials and bought-in stock, before it is issued to production.",
  WIP:           "Material issued to a production order and not yet received back as output.",
  FinishedGoods: "Completed output, ready to ship.",
  Transit:       "Stock that has left one location and not yet arrived at the next.",
  Quarantine:    "Received but not yet inspected or accepted. Not available to issue.",
};

/**
 * Locations stock may NOT be freely issued from by ordinary documents.
 * Quarantine is holding material that has not passed inspection — shipping or
 * consuming it is exactly the mistake the location exists to prevent. A
 * deliberate transfer out of Quarantine is still allowed; that is the release
 * step, and it is a decision someone makes rather than a side effect of picking.
 */
export const NON_ISSUABLE_TYPES: ReadonlySet<string> = new Set<string>(["Quarantine"]);

export class LocationError extends Error {}
const fail = (m: string): never => { throw new LocationError(m); };

const n4 = (n: number) => (Math.round((Number(n) || 0) * 1e4) / 1e4).toFixed(4);

export type LocationRow = typeof stockLocations.$inferSelect;

/** Every location in the org, default first, then by code. */
export async function listLocations(orgId: string, opts: { includeInactive?: boolean } = {}): Promise<LocationRow[]> {
  const rows = await db.select().from(stockLocations)
    .where(opts.includeInactive
      ? eq(stockLocations.orgId, orgId)
      : and(eq(stockLocations.orgId, orgId), eq(stockLocations.status, "Active")))
    .orderBy(asc(stockLocations.code));
  return rows.sort((a, b) => (a.isDefault === b.isDefault ? 0 : a.isDefault ? -1 : 1));
}

/**
 * The org's default location, created on first use if it has none.
 *
 * Created ON DEMAND rather than seeded for every org, on the same reasoning that
 * keeps the Suspense account out of every chart of accounts: a Receivables-only
 * tenant should never see a "Main Store" appear because of work done for
 * somebody else. Migration 0087 back-fills one only for orgs that already hold
 * stock; everyone else arrives here the first time they receive something.
 *
 * RACE: two concurrent first-receipts could both find no default and both
 * insert. There are no transactions to serialise them, so the partial unique
 * index `stock_locations_org_default_unique` decides the winner and the loser's
 * insert throws — at which point re-reading finds the winner's row. The outcome
 * is one default either way, which is the property that actually matters.
 */
export async function ensureDefaultLocation(orgId: string): Promise<string> {
  const [existing] = await db.select({ id: stockLocations.id })
    .from(stockLocations)
    .where(and(eq(stockLocations.orgId, orgId), eq(stockLocations.isDefault, true)))
    .limit(1);
  if (existing) return existing.id;

  try {
    const [created] = await db.insert(stockLocations).values({
      orgId, code: "MAIN", name: "Main Store", type: "Store", isDefault: true,
      note: "Created automatically on first stock movement.",
    } as any).returning({ id: stockLocations.id });
    if (created?.id) return created.id;
  } catch {
    /* lost the race, or the code "MAIN" is already taken — fall through and re-read */
  }

  const [afterRace] = await db.select({ id: stockLocations.id })
    .from(stockLocations)
    .where(and(eq(stockLocations.orgId, orgId), eq(stockLocations.isDefault, true)))
    .limit(1);
  if (afterRace) return afterRace.id;

  // No default exists and we could not create one — almost certainly because an
  // org has locations but none flagged default (possible only by direct DB
  // edit). Promote the lowest-coded Active location rather than failing the
  // receipt: refusing to record stock that physically arrived is worse than
  // choosing a location deterministically.
  const [fallback] = await db.select({ id: stockLocations.id })
    .from(stockLocations)
    .where(and(eq(stockLocations.orgId, orgId), eq(stockLocations.status, "Active")))
    .orderBy(asc(stockLocations.code))
    .limit(1);
  if (fallback) return fallback.id;

  return fail("This organisation has no stock location. Add one under Supply Chain → Setup → Locations before recording stock.");
}

export type ResolveOpts = {
  /** Reject a location stock may not be issued from (Quarantine). */
  forIssue?: boolean;
  /** What the location is for, used in the error message. */
  label?: string;
};

/**
 * Turn a client-supplied location id into one this org may post to.
 *
 * THIS IS A TENANCY BOUNDARY. `id` arrives from a request body. A foreign key
 * would prove the row exists in some org; only this proves it exists in THIS
 * one. Never bypass it by writing a caller-supplied id straight onto a lot or a
 * movement.
 *
 * null/undefined means "the caller did not choose" and resolves to the org
 * default, which is what keeps every pre-existing posting path working.
 */
export async function resolveLocationId(
  orgId: string,
  id: string | null | undefined,
  opts: ResolveOpts = {},
): Promise<string> {
  if (!id) return ensureDefaultLocation(orgId);

  const [row] = await db.select({
    id: stockLocations.id, status: stockLocations.status,
    type: stockLocations.type, name: stockLocations.name,
  })
    .from(stockLocations)
    .where(and(eq(stockLocations.id, id), eq(stockLocations.orgId, orgId)))
    .limit(1);

  // Deliberately the same message for "does not exist" and "belongs to another
  // org" — distinguishing them would confirm the existence of another tenant's
  // row to whoever guessed the id.
  if (!row) return fail(`${opts.label ?? "Location"} not found in this organisation.`);
  if (row.status !== "Active") return fail(`Location "${row.name}" is inactive — reactivate it or pick another.`);
  if (opts.forIssue && NON_ISSUABLE_TYPES.has(row.type)) {
    return fail(`"${row.name}" is a ${LOCATION_TYPE_LABELS[row.type as LocationType] ?? row.type} location — stock there has not been released. Transfer it out before issuing.`);
  }
  return row.id;
}

/** Resolve several at once; each is validated individually. */
export async function resolveLocationIds(
  orgId: string,
  ids: (string | null | undefined)[],
  opts: ResolveOpts = {},
): Promise<string[]> {
  const out: string[] = [];
  for (const id of ids) out.push(await resolveLocationId(orgId, id, opts));
  return out;
}

export type LocationInput = {
  code: string; name: string; type?: string; parentId?: string | null;
  inventoryAccountId?: string | null; address?: string | null; note?: string | null;
  status?: string; isDefault?: boolean;
};

function validate(b: LocationInput) {
  const code = String(b.code ?? "").trim();
  const name = String(b.name ?? "").trim();
  if (!code) fail("A location code is required — it is how staff refer to the place on a picking list.");
  if (code.length > 32) fail("Location code is limited to 32 characters.");
  if (!name) fail("A location name is required.");
  if (b.type && !LOCATION_TYPES.includes(b.type as LocationType)) fail(`Unknown location type "${b.type}".`);
  return { code, name };
}

export async function createLocation(orgId: string, b: LocationInput): Promise<LocationRow> {
  const { code, name } = validate(b);

  // Parent must be in the same org — a client-supplied id, so the same tenancy
  // rule as resolveLocationId applies.
  if (b.parentId) await resolveLocationId(orgId, b.parentId, { label: "Parent location" });

  const [dupe] = await db.select({ id: stockLocations.id }).from(stockLocations)
    .where(and(eq(stockLocations.orgId, orgId), sql`lower(${stockLocations.code}) = ${code.toLowerCase()}`))
    .limit(1);
  if (dupe) fail(`Location code "${code}" is already used in this organisation.`);

  // First location in an org becomes the default whatever the caller asked, so
  // an org can never end up with locations but nothing to resolve to.
  const [any] = await db.select({ id: stockLocations.id }).from(stockLocations)
    .where(eq(stockLocations.orgId, orgId)).limit(1);
  const makeDefault = !any || !!b.isDefault;
  if (makeDefault && any) await clearDefault(orgId);

  const [row] = await db.insert(stockLocations).values({
    orgId, code, name,
    type: (b.type as LocationType) ?? "Store",
    parentId: b.parentId ?? null,
    inventoryAccountId: b.inventoryAccountId ?? null,
    address: b.address ?? null, note: b.note ?? null,
    status: b.status === "Inactive" ? "Inactive" : "Active",
    isDefault: makeDefault,
  } as any).returning();
  return row;
}

async function clearDefault(orgId: string) {
  await db.update(stockLocations).set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(stockLocations.orgId, orgId), eq(stockLocations.isDefault, true)));
}

export async function updateLocation(orgId: string, id: string, b: Partial<LocationInput>): Promise<LocationRow> {
  const [current] = await db.select().from(stockLocations)
    .where(and(eq(stockLocations.id, id), eq(stockLocations.orgId, orgId))).limit(1);
  if (!current) fail("Location not found in this organisation.");

  const patch: Record<string, any> = { updatedAt: new Date() };

  if (b.code != null) {
    const code = String(b.code).trim();
    if (!code) fail("A location code is required.");
    const [dupe] = await db.select({ id: stockLocations.id }).from(stockLocations)
      .where(and(
        eq(stockLocations.orgId, orgId),
        sql`lower(${stockLocations.code}) = ${code.toLowerCase()}`,
        ne(stockLocations.id, id),
      )).limit(1);
    if (dupe) fail(`Location code "${code}" is already used in this organisation.`);
    patch.code = code;
  }
  if (b.name != null) {
    const name = String(b.name).trim();
    if (!name) fail("A location name is required.");
    patch.name = name;
  }
  if (b.type != null) {
    if (!LOCATION_TYPES.includes(b.type as LocationType)) fail(`Unknown location type "${b.type}".`);
    patch.type = b.type;
  }
  if (b.parentId !== undefined) {
    if (b.parentId) {
      if (b.parentId === id) fail("A location cannot be its own parent.");
      await resolveLocationId(orgId, b.parentId, { label: "Parent location" });
      if (await wouldCycle(orgId, id, b.parentId)) fail("That parent is inside this location — it would create a loop.");
    }
    patch.parentId = b.parentId ?? null;
  }
  if (b.inventoryAccountId !== undefined) patch.inventoryAccountId = b.inventoryAccountId ?? null;
  if (b.address !== undefined) patch.address = b.address ?? null;
  if (b.note !== undefined) patch.note = b.note ?? null;

  if (b.status != null) {
    const status = b.status === "Inactive" ? "Inactive" : "Active";
    if (status === "Inactive") {
      if (current!.isDefault) fail("The default location cannot be deactivated. Make another location the default first.");
      const held = await stockHeldAt(orgId, id);
      if (held > 0) fail(`"${current!.name}" still holds ${held} unit(s) of stock. Transfer it out before deactivating.`);
    }
    patch.status = status;
  }

  if (b.isDefault) {
    if (current!.status === "Inactive" && b.status !== "Active") fail("An inactive location cannot be the default.");
    await clearDefault(orgId);
    patch.isDefault = true;
  }

  const [row] = await db.update(stockLocations).set(patch)
    .where(and(eq(stockLocations.id, id), eq(stockLocations.orgId, orgId))).returning();
  return row;
}

/** Walking up from `parentId`, do we reach `id`? Guards against a parent loop. */
async function wouldCycle(orgId: string, id: string, parentId: string): Promise<boolean> {
  let cursor: string | null = parentId;
  // Bounded rather than while(true): a pre-existing loop in the data must not
  // hang the request while we prove the new one would also loop.
  for (let hops = 0; cursor && hops < 50; hops++) {
    if (cursor === id) return true;
    const [row]: { parentId: string | null }[] = await db.select({ parentId: stockLocations.parentId })
      .from(stockLocations)
      .where(and(eq(stockLocations.id, cursor), eq(stockLocations.orgId, orgId))).limit(1);
    cursor = row?.parentId ?? null;
  }
  return false;
}

/** Total base-UoM quantity currently placed at a location. */
export async function stockHeldAt(orgId: string, locationId: string): Promise<number> {
  const [row] = await db.select({ total: sql<string>`coalesce(sum(${inventoryLotLocations.qty}), 0)` })
    .from(inventoryLotLocations)
    .where(and(eq(inventoryLotLocations.orgId, orgId), eq(inventoryLotLocations.locationId, locationId)));
  return Math.round(Number(row?.total ?? 0) * 1e4) / 1e4;
}

/**
 * Delete a location. Refused while it holds stock, while it is the default, and
 * while anything still points at it — the FK is ON DELETE RESTRICT, so the
 * database would refuse anyway; this turns that into a sentence someone can act
 * on instead of a constraint-violation stack trace.
 */
export async function deleteLocation(orgId: string, id: string): Promise<void> {
  const [row] = await db.select().from(stockLocations)
    .where(and(eq(stockLocations.id, id), eq(stockLocations.orgId, orgId))).limit(1);
  if (!row) fail("Location not found in this organisation.");
  if (row!.isDefault) fail("The default location cannot be deleted. Make another location the default first.");

  const held = await stockHeldAt(orgId, id);
  if (held > 0) fail(`"${row!.name}" still holds ${held} unit(s) of stock. Transfer it out before deleting.`);

  const [child] = await db.select({ id: stockLocations.id }).from(stockLocations)
    .where(and(eq(stockLocations.orgId, orgId), eq(stockLocations.parentId, id))).limit(1);
  if (child) fail(`"${row!.name}" has locations inside it. Move or delete those first.`);

  await db.delete(stockLocations).where(and(eq(stockLocations.id, id), eq(stockLocations.orgId, orgId)));
}

// ── Placement primitives, used by the valuation engine ──────────────────────
// Kept here rather than in valuation.ts so that everything which knows what a
// location IS lives in one file.

/** Add quantity to a lot's placement at a location (creates the row if new). */
export async function placeQty(orgId: string, lotId: string, locationId: string, qty: number): Promise<void> {
  const q = Math.round((Number(qty) || 0) * 1e4) / 1e4;
  if (q <= 0) return;
  // One statement, so two concurrent receipts into the same lot+location cannot
  // read-modify-write over each other — there are no transactions to hold them
  // apart. The unique index makes the conflict target exact.
  await db.execute(sql`
    INSERT INTO inventory_lot_locations (org_id, lot_id, location_id, qty)
    VALUES (${orgId}, ${lotId}, ${locationId}, ${n4(q)})
    ON CONFLICT (lot_id, location_id)
    DO UPDATE SET qty = inventory_lot_locations.qty + ${n4(q)}, updated_at = now()
  `);
}

/**
 * Remove quantity from a lot's placement. Clamped at zero and the row is dropped
 * when it empties, so the table stays proportional to live stock.
 * Returns what was actually taken, which can be less than asked if a concurrent
 * write got there first — the caller decides what that means.
 */
export async function takeQty(orgId: string, lotId: string, locationId: string, qty: number): Promise<number> {
  const q = Math.round((Number(qty) || 0) * 1e4) / 1e4;
  if (q <= 0) return 0;
  // A CTE, because RETURNING reports the NEW row and so cannot say how much was
  // actually removed once `greatest(..., 0)` has clamped it: asking for 3 from a
  // row holding 2 takes 2, not 3, and the caller must know that. `prev` captures
  // the value before the update, and the whole thing is still ONE statement —
  // which is the only atomicity available here (neon-http has no transactions).
  const res: any = await db.execute(sql`
    WITH prev AS (
      SELECT id, qty FROM inventory_lot_locations
       WHERE org_id = ${orgId} AND lot_id = ${lotId} AND location_id = ${locationId}
    ), upd AS (
      UPDATE inventory_lot_locations t
         SET qty = greatest(t.qty - ${n4(q)}, 0), updated_at = now()
        FROM prev
       WHERE t.id = prev.id
      RETURNING t.qty AS new_qty, prev.qty AS old_qty
    )
    SELECT new_qty, (old_qty - new_qty) AS taken FROM upd
  `);
  const rows = Array.isArray(res) ? res : res?.rows ?? [];
  const row = rows[0];
  if (!row) return 0;
  if (Number(row.new_qty) <= 0) {
    await db.delete(inventoryLotLocations).where(and(
      eq(inventoryLotLocations.orgId, orgId),
      eq(inventoryLotLocations.lotId, lotId),
      eq(inventoryLotLocations.locationId, locationId),
    ));
  }
  return Math.round(Number(row.taken ?? 0) * 1e4) / 1e4;
}

export type LotPlacement = { locationId: string; qty: number; type: string; issuable: boolean };

/** Where each of these lots currently sits. Keyed by lot id. */
export async function placementsForLots(orgId: string, lotIds: string[]): Promise<Map<string, LotPlacement[]>> {
  const ids = [...new Set(lotIds.filter(Boolean))];
  const map = new Map<string, LotPlacement[]>();
  if (!ids.length) return map;
  // Joined to stock_locations so the pick order below is by location CODE and
  // therefore stable, rather than by whatever order the rows come back in.
  const rows = await db.select({
    lotId: inventoryLotLocations.lotId,
    locationId: inventoryLotLocations.locationId,
    qty: inventoryLotLocations.qty,
    code: stockLocations.code,
    type: stockLocations.type,
  })
    .from(inventoryLotLocations)
    .innerJoin(stockLocations, eq(stockLocations.id, inventoryLotLocations.locationId))
    .where(and(eq(inventoryLotLocations.orgId, orgId), inArray(inventoryLotLocations.lotId, ids)))
    .orderBy(asc(stockLocations.code));
  for (const r of rows) {
    const q = Number(r.qty ?? 0);
    if (q <= 0) continue;
    const list = map.get(r.lotId) ?? [];
    list.push({ locationId: r.locationId, qty: q, type: r.type, issuable: !NON_ISSUABLE_TYPES.has(r.type) });
    map.set(r.lotId, list);
  }
  return map;
}

/**
 * Everything sitting at one location, item by item and lot by lot.
 *
 * This is what makes a transfer pickable rather than guesswork: the operator
 * sees the lots actually in front of them, with the quantity that is really
 * there, instead of typing an item code and finding out at post time that the
 * stock is in another store.
 */
export async function stockAtLocation(orgId: string, locationId: string) {
  const rows = await db.select({
    itemId: inventoryLots.itemId,
    skuId: inventoryLots.skuId,
    lotId: inventoryLots.id,
    lotNo: inventoryLots.lotNo,
    unitCost: inventoryLots.unitCost,
    expiryDate: inventoryLots.expiryDate,
    receivedDate: inventoryLots.receivedDate,
    qty: inventoryLotLocations.qty,
  })
    .from(inventoryLotLocations)
    .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryLotLocations.lotId))
    .where(and(
      eq(inventoryLotLocations.orgId, orgId),
      eq(inventoryLotLocations.locationId, locationId),
    ))
    // FIFO order, so the list reads in the same order a pick would consume it.
    .orderBy(asc(inventoryLots.receivedDate), asc(inventoryLots.createdAt));

  const byItem = new Map<string, {
    itemId: string; qty: number; value: number;
    lots: { lotId: string; lotNo: string | null; skuId: string | null; qty: number; unitCost: number; expiryDate: string | null; receivedDate: string | null }[];
  }>();

  for (const r of rows) {
    const q = Number(r.qty ?? 0);
    if (q <= 0) continue;
    const cost = Number(r.unitCost ?? 0);
    const cur = byItem.get(r.itemId) ?? { itemId: r.itemId, qty: 0, value: 0, lots: [] };
    cur.qty += q;
    cur.value += q * cost;
    cur.lots.push({
      lotId: r.lotId, lotNo: r.lotNo, skuId: r.skuId,
      qty: Math.round(q * 1e4) / 1e4, unitCost: cost,
      expiryDate: r.expiryDate as any, receivedDate: r.receivedDate as any,
    });
    byItem.set(r.itemId, cur);
  }

  return [...byItem.values()].map(v => ({
    ...v,
    qty: Math.round(v.qty * 1e4) / 1e4,
    value: Math.round(v.value * 1e4) / 1e4,
  }));
}

/** On-hand quantity and value per location for one item. */
export async function onHandByLocation(orgId: string, itemId: string) {
  const rows = await db.select({
    locationId: stockLocations.id,
    code: stockLocations.code,
    name: stockLocations.name,
    type: stockLocations.type,
    qty: inventoryLotLocations.qty,
    unitCost: inventoryLots.unitCost,
  })
    .from(inventoryLotLocations)
    .innerJoin(inventoryLots, eq(inventoryLots.id, inventoryLotLocations.lotId))
    .innerJoin(stockLocations, eq(stockLocations.id, inventoryLotLocations.locationId))
    .where(and(eq(inventoryLotLocations.orgId, orgId), eq(inventoryLots.itemId, itemId)))
    .orderBy(asc(stockLocations.code));

  const map = new Map<string, { locationId: string; code: string; name: string; type: string; qty: number; value: number }>();
  for (const r of rows) {
    const q = Number(r.qty ?? 0);
    if (q <= 0) continue;
    const cur = map.get(r.locationId) ?? { locationId: r.locationId, code: r.code, name: r.name, type: r.type, qty: 0, value: 0 };
    cur.qty += q;
    cur.value += q * Number(r.unitCost ?? 0);
    map.set(r.locationId, cur);
  }
  return [...map.values()].map(v => ({
    ...v,
    qty: Math.round(v.qty * 1e4) / 1e4,
    value: Math.round(v.value * 1e4) / 1e4,
  }));
}
