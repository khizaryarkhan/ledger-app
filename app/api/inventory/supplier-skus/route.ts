/**
 * GET  /api/inventory/supplier-skus?supplierId=  → that supplier's item links
 * POST /api/inventory/supplier-skus (raw-material supplier link) · DELETE ?id=
 *
 * The GET is what scopes purchasing to one supplier. A Purchase Order form asks
 * for the links of the supplier it is addressed to and nothing else, so another
 * supplier's pack configuration is never in hand to be offered by mistake —
 * picking one would write that supplier's conversion factor onto this
 * supplier's order line and land a wrong received quantity in stock.
 */

import { db } from "@/db";
import { itemSupplierSkus, apItems, apSuppliers } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, asc } from "drizzle-orm";
import { needsConversionFactor } from "@/lib/inventory/uom";
import { supplierSkuReferences, blockerMessage } from "@/lib/inventory/references";
import { NextResponse } from "next/server";

const s = (v: any, n = 64) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
const numOrNull = (v: any) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v).toString());

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const supplierId = new URL(req.url).searchParams.get("supplierId");
  if (!supplierId) return bad("supplierId required");
  const rows = await db.select().from(itemSupplierSkus)
    .where(and(eq(itemSupplierSkus.orgId, orgId!), eq(itemSupplierSkus.supplierId, supplierId)))
    .orderBy(asc(itemSupplierSkus.createdAt));
  return ok(rows);
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const [item] = await db.select({ id: apItems.id, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.id, String(b?.itemId)), eq(apItems.orgId, orgId!))).limit(1);
  if (!item) return bad("Item not found", 404);

  // A link with no supplier cannot answer the only question it exists to answer
  // ("when THIS vendor says a bag, how many kg is that?"), and it would slip
  // past every supplier-scoped read below. Re-checked against the org because a
  // Postgres FK is impossible here — ap_suppliers is a view (see 0079).
  const supplierId = s(b?.supplierId, 64);
  if (!supplierId) return bad("A supplier is required to link an item.");
  const [supplier] = await db.select({ id: apSuppliers.id }).from(apSuppliers)
    .where(and(eq(apSuppliers.id, supplierId), eq(apSuppliers.orgId, orgId!))).limit(1);
  if (!supplier) return bad("Supplier not found", 404);

  const supplierUom = s(b?.supplierUom, 16);
  // Cross-dimension packaging (e.g. item Lt ↔ supplier Lb) requires an explicit factor.
  const factorRequired = !!(item.baseUom && supplierUom && needsConversionFactor(item.baseUom, supplierUom));
  const factor = numOrNull(b?.conversionFactor);
  if (factorRequired && !factor) {
    return bad(`A conversion factor is required to convert supplier UoM "${supplierUom}" to item base UoM "${item.baseUom}".`);
  }

  const [row] = await db.insert(itemSupplierSkus).values({
    orgId: orgId!, itemId: item.id,
    supplierId, supplierUom,
    skuName: s(b?.skuName, 255), supplierSku: s(b?.supplierSku),
    itemCodeBySupplier: s(b?.itemCodeBySupplier),
    innerUnitPackSize: numOrNull(b?.innerUnitPackSize), innerPackType: s(b?.innerPackType, 32),
    unitsInOuterPack: numOrNull(b?.unitsInOuterPack), outerPackType: s(b?.outerPackType, 32),
    conversionFactor: factor,
  } as any).returning();
  return ok(row);
}

export async function DELETE(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  const blockers = await supplierSkuReferences(orgId!, id);
  if (blockers.length) return NextResponse.json({ error: blockerMessage("supplier SKU", blockers), blockers }, { status: 409 });
  await db.delete(itemSupplierSkus).where(and(eq(itemSupplierSkus.id, id), eq(itemSupplierSkus.orgId, orgId!)));
  return ok({ id, deleted: true });
}
