/**
 * GET /api/inventory/locations/[id]/stock
 *
 * What is physically at one location, item by item and lot by lot, in FIFO
 * order. Read-only, and the basis of the transfer screen's picker — an operator
 * should choose from the lots actually in front of them rather than typing an
 * item code and discovering at post time that the stock is somewhere else.
 */

import { db } from "@/db";
import { apItems } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, inArray } from "drizzle-orm";
import { stockAtLocation, resolveLocationId, LocationError } from "@/lib/inventory/locations";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;

  try {
    // Resolved rather than used raw: this is a client-supplied id, and the
    // resolver is what proves it belongs to the caller's organisation.
    const locationId = await resolveLocationId(orgId!, params.id, { label: "Location" });
    const rows = await stockAtLocation(orgId!, locationId);

    const itemIds = rows.map(r => r.itemId);
    const items = itemIds.length
      ? await db.select({
          id: apItems.id, name: apItems.name, code: apItems.code,
          baseUom: apItems.baseUom, productType: apItems.productType,
        })
          .from(apItems)
          .where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, itemIds)))
      : [];
    const byId = new Map(items.map(i => [i.id, i]));

    return ok(
      rows
        .map(r => ({ ...r, item: byId.get(r.itemId) ?? null }))
        .sort((a, b) => (a.item?.name ?? "").localeCompare(b.item?.name ?? "")),
    );
  } catch (e: any) {
    if (e instanceof LocationError) return bad(e.message, 404);
    console.error("[locations] stock read failed:", e);
    return bad("Failed to read stock at this location", 500);
  }
}
