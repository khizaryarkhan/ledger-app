/**
 * GET  /api/inventory/locations   → every stock location, with what it holds
 * POST /api/inventory/locations   → create one
 *
 * Locations are MASTER DATA, so creating and editing them is admin-only —
 * matching items, SKUs and BOMs. Moving stock between them is a floor
 * operation and lives at /api/inventory/transfers, which only needs
 * canPostInventoryTxn.
 */

import { roundQty } from "@/lib/inventory/round";
import { db } from "@/db";
import { stockLocations, inventoryLotLocations } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, sql } from "drizzle-orm";
import {
  listLocations, createLocation, LocationError,
  LOCATION_TYPES, LOCATION_TYPE_LABELS, LOCATION_TYPE_HINTS,
} from "@/lib/inventory/locations";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;

  const rows = await listLocations(orgId!, { includeInactive: true });

  // How much each location holds, so the list can show it and the UI can
  // explain WHY a delete or deactivate is refused before the user tries.
  // Aggregated in a subquery and joined, never GROUP BY on the parent row —
  // see CLAUDE.md; that pattern is what broke Payables → Suppliers.
  const held = await db
    .select({
      locationId: inventoryLotLocations.locationId,
      qty: sql<string>`sum(${inventoryLotLocations.qty})`,
      lots: sql<number>`count(distinct ${inventoryLotLocations.lotId})::int`,
    })
    .from(inventoryLotLocations)
    .where(eq(inventoryLotLocations.orgId, orgId!))
    .groupBy(inventoryLotLocations.locationId);
  const heldBy = new Map(held.map(h => [h.locationId, h]));

  return ok({
    types: LOCATION_TYPES.map(t => ({ value: t, label: LOCATION_TYPE_LABELS[t], hint: LOCATION_TYPE_HINTS[t] })),
    locations: rows.map(r => ({
      ...r,
      onHandQty: roundQty(Number(heldBy.get(r.id)?.qty ?? 0)),
      lotCount: Number(heldBy.get(r.id)?.lots ?? 0),
    })),
  });
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  const b = await req.json().catch(() => ({}));
  try {
    const row = await createLocation(orgId!, {
      code: b?.code, name: b?.name, type: b?.type,
      parentId: b?.parentId ?? null,
      inventoryAccountId: b?.inventoryAccountId ?? null,
      address: b?.address ?? null, note: b?.note ?? null,
      status: b?.status, isDefault: !!b?.isDefault,
    });
    return ok(row);
  } catch (e: any) {
    if (e instanceof LocationError) return bad(e.message);
    console.error("[locations] create failed:", e);
    return bad("Failed to create the location", 500);
  }
}
