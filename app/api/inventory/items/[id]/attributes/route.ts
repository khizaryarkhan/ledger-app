/**
 * PATCH /api/inventory/items/[id]/attributes → { weightPerUnitKg?, allergens? }
 *
 * The two item facts a BOM leans on: kilograms in ONE base unit (so litres, cases and
 * bars can join the weight check) and allergens from the fixed picklist. A small route
 * on its own on purpose: the full item PATCH re-validates accounting on every call, and
 * setting a weight must not depend on or disturb an item's account mapping.
 * Admins only, like every other item edit. null clears a value.
 */

import { db } from "@/db";
import { apItems } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { ALLERGENS } from "@/lib/inventory/bom-rules";
import { and, eq } from "drizzle-orm";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const set: Record<string, any> = {};

  if (b.weightPerUnitKg !== undefined) {
    if (b.weightPerUnitKg === null || b.weightPerUnitKg === "") set.weightPerUnitKg = null;
    else {
      const w = Number(String(b.weightPerUnitKg).replace(",", "."));
      if (!Number.isFinite(w) || w <= 0) return bad("Weight must be a number above zero (kilograms in one unit).");
      set.weightPerUnitKg = String(Math.round(w * 1e6) / 1e6);
    }
  }
  if (b.allergens !== undefined) {
    if (b.allergens === null) set.allergens = null;
    else if (!Array.isArray(b.allergens)) return bad("allergens must be a list");
    else {
      const known = new Set<string>(ALLERGENS);
      const clean = [...new Set(b.allergens.map((a: any) => String(a).trim().toLowerCase()))] as string[];
      const unknown = clean.filter(a => !known.has(a));
      if (unknown.length) return bad(`Unknown allergen: ${unknown.join(", ")}. Choose from the list.`);
      set.allergens = clean;
    }
  }
  if (!Object.keys(set).length) return bad("Nothing to change");

  const [row] = await db.update(apItems).set(set).where(and(eq(apItems.id, params.id), eq(apItems.orgId, orgId!)))
    .returning({ id: apItems.id, weightPerUnitKg: apItems.weightPerUnitKg, allergens: apItems.allergens });
  if (!row) return bad("Item not found", 404);
  return ok({ id: row.id, weightPerUnitKg: row.weightPerUnitKg == null ? null : Number(row.weightPerUnitKg), allergens: row.allergens ?? [] });
}
