/** POST /api/inventory/skus (finished-product SKU) · PATCH ?id= · DELETE ?id= */

import { db } from "@/db";
import { itemSkus, apItems } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { skuReferences, blockerMessage } from "@/lib/inventory/references";
import { prepareIdentifiers, writeIdentifiers, identifierErrorMessage } from "@/lib/inventory/identifiers-server";
import type { PackLevel } from "@/lib/inventory/identifiers";
import { NextResponse } from "next/server";

const s = (v: any, n = 64) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
const numOrNull = (v: any) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v).toString());

/** Shared by POST and PATCH so the two cannot drift. */
function skuValues(b: any) {
  const values = {
    skuName: s(b?.skuName, 255), skuCode: s(b?.skuCode),
    innerUnitPackSize: numOrNull(b?.innerUnitPackSize), innerPackType: s(b?.innerPackType, 32),
    unitsInAddlInnerPack: numOrNull(b?.unitsInAddlInnerPack), addlInnerPackType: s(b?.addlInnerPackType, 32),
    unitsInOuterPack: numOrNull(b?.unitsInOuterPack), outerPackType: s(b?.outerPackType, 32),
  };
  // "inner" is the SKU's own consumer unit (the 750ml bottle) and always
  // exists; the other two only when this SKU is packed that way.
  const levels: PackLevel[] = ["inner"];
  if (values.unitsInAddlInnerPack || values.addlInnerPackType) levels.push("addl_inner");
  if (values.unitsInOuterPack || values.outerPackType) levels.push("outer");
  return { values, levels };
}

/** Fields that decide how many base units a pack of this SKU holds — on-hand
 *  pack counts and every shipped/received quantity are derived from them. */
const QUANTITY_FIELDS = ["innerUnitPackSize", "unitsInAddlInnerPack", "unitsInOuterPack"] as const;
const norm = (x: any) => (x == null || String(x).trim() === "" ? null : Number(x));

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const [item] = await db.select({ id: apItems.id }).from(apItems).where(and(eq(apItems.id, String(b?.itemId)), eq(apItems.orgId, orgId!))).limit(1);
  if (!item) return bad("Item not found", 404);
  const { values, levels } = skuValues(b);
  let ids;
  try { ids = await prepareIdentifiers(orgId!, item.id, b?.identifiers, levels); }
  catch (e) { const m = identifierErrorMessage(e); if (m) return bad(m); throw e; }
  const [row] = await db.insert(itemSkus).values({ orgId: orgId!, itemId: item.id, ...values } as any).returning();
  await writeIdentifiers(orgId!, item.id, { itemSkuId: row.id }, ids);
  return ok(row);
}

export async function PATCH(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  const b = await req.json().catch(() => ({}));
  const [existing] = await db.select().from(itemSkus).where(and(eq(itemSkus.id, id), eq(itemSkus.orgId, orgId!))).limit(1);
  if (!existing) return bad("SKU not found", 404);
  const { values, levels } = skuValues(b);

  // Stock already held in this SKU was counted in its current pack sizes;
  // changing them would silently change how many packs are on hand.
  if (QUANTITY_FIELDS.some(k => norm((existing as any)[k]) !== norm((values as any)[k]))) {
    const blockers = await skuReferences(orgId!, id);
    if (blockers.length) {
      return NextResponse.json({
        error: `This SKU's pack sizes are used by ${blockers.map(x => `${x.count} ${x.label}`).join(", ")}, so they can't change — that would alter quantities already recorded. Its name, code, pack types and barcodes can still be edited. For a new pack size, add a new SKU.`,
        blockers,
      }, { status: 409 });
    }
  }

  let ids;
  try { ids = await prepareIdentifiers(orgId!, existing.itemId, b?.identifiers, levels); }
  catch (e) { const m = identifierErrorMessage(e); if (m) return bad(m); throw e; }
  const [row] = await db.update(itemSkus).set(values as any).where(and(eq(itemSkus.id, id), eq(itemSkus.orgId, orgId!))).returning();
  await writeIdentifiers(orgId!, existing.itemId, { itemSkuId: id }, ids);
  return ok(row);
}

export async function DELETE(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  const blockers = await skuReferences(orgId!, id);
  if (blockers.length) return NextResponse.json({ error: blockerMessage("SKU", blockers), blockers }, { status: 409 });
  await db.delete(itemSkus).where(and(eq(itemSkus.id, id), eq(itemSkus.orgId, orgId!)));
  return ok({ id, deleted: true });
}
