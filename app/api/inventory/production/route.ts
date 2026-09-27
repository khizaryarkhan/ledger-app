/**
 * GET /api/inventory/production → list production runs (history only — every
 * run today is created by completing a Manufacturing Order; see
 * lib/inventory/mo-completion.ts). The ad-hoc "Build" creation path this
 * route used to expose (POST) was removed — it let stock get produced with
 * no schedule, no allocation and no labour/overhead costing, duplicating what
 * a Manufacturing Order already does properly. Voiding a completed run is
 * still done from here (DELETE, in [id]/route.ts), reached from the MO's own
 * detail drawer now rather than a separate Build console.
 */

import { db } from "@/db";
import { productionRuns, apItems } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, desc, inArray } from "drizzle-orm";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const rows = await db.select().from(productionRuns).where(eq(productionRuns.orgId, orgId!)).orderBy(desc(productionRuns.createdAt)).limit(200);
  const ids = [...new Set(rows.map(r => r.outputItemId).filter(Boolean) as string[])];
  const items = ids.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId!), inArray(apItems.id, ids))) : [];
  const byId = new Map(items.map(i => [i.id, i]));
  return ok(rows.map(r => ({ ...r, outputItem: r.outputItemId ? byId.get(r.outputItemId) ?? null : null })));
}
