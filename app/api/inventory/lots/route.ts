/**
 * GET /api/inventory/lots?q=<lot code>
 *
 * Search lots by code — regardless of Open/Depleted status, since tracing a
 * fully-consumed lot's history is exactly the point of traceability. Distinct
 * from /api/inventory/reports?type=lots (Stock Valuation Detail), which only
 * lists currently-open lots for the on-hand-value report.
 */

import { db } from "@/db";
import { inventoryLots, apItems } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, desc, eq, ilike, sql } from "drizzle-orm";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const sp = new URL(req.url).searchParams;
  const q = sp.get("q")?.trim();
  const itemId = sp.get("itemId")?.trim();

  // ?items=1 -> the items that have at least one lot, for the report's first dropdown.
  if (sp.get("items")) {
    const items = await db.select({ id: apItems.id, name: apItems.name, lots: sql<number>`count(*)::int` })
      .from(inventoryLots).innerJoin(apItems, eq(apItems.id, inventoryLots.itemId))
      .where(eq(inventoryLots.orgId, orgId!)).groupBy(apItems.id, apItems.name).orderBy(apItems.name);
    return ok(items);
  }

  if (!q && !itemId) return bad("Pass ?q=<lot code>, ?itemId=<item> or ?items=1");
  const rows = await db.select({
    id: inventoryLots.id, lotNo: inventoryLots.lotNo, itemId: inventoryLots.itemId, itemName: apItems.name,
    status: inventoryLots.status, remainingQty: inventoryLots.remainingQty, origQty: inventoryLots.origQty,
    receivedDate: inventoryLots.receivedDate, sourceType: inventoryLots.sourceType,
  }).from(inventoryLots).innerJoin(apItems, eq(apItems.id, inventoryLots.itemId))
    .where(and(
      eq(inventoryLots.orgId, orgId!),
      q ? ilike(inventoryLots.lotNo, `%${q}%`) : undefined,
      itemId ? eq(inventoryLots.itemId, itemId) : undefined,
    ))
    .orderBy(desc(inventoryLots.createdAt))
    .limit(itemId ? 200 : 25);
  return ok(rows);
}
