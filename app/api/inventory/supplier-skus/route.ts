/**
 * GET   /api/inventory/supplier-skus?supplierId=  → that supplier's item links
 * POST  /api/inventory/supplier-skus              (raw-material supplier link)
 * PATCH /api/inventory/supplier-skus?id=          (edit a link)
 * DELETE ?id=
 *
 * The GET is what scopes purchasing to one supplier. A Purchase Order form asks
 * for the links of the supplier it is addressed to and nothing else, so another
 * supplier's pack configuration is never in hand to be offered by mistake —
 * picking one would write that supplier's conversion factor onto this
 * supplier's order line and land a wrong received quantity in stock.
 *
 * POST and PATCH share ONE validator (linkValues), so a rule added for one can
 * never be missing from the other.
 */

import { db } from "@/db";
import { itemSupplierSkus, apItems, apSuppliers } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, asc, ne } from "drizzle-orm";
import { needsConversionFactor } from "@/lib/inventory/uom";
import { allowsPackConfiguration, sourcingOf, SOURCING_POLICIES } from "@/lib/inventory/sourcing";
import { supplierSkuReferences, blockerMessage } from "@/lib/inventory/references";
import { prepareIdentifiers, writeIdentifiers, identifierErrorMessage } from "@/lib/inventory/identifiers-server";
import type { PackLevel } from "@/lib/inventory/identifiers";
import { NextResponse } from "next/server";

const s = (v: any, n = 64) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
const numOrNull = (v: any) => (v == null || v === "" || isNaN(Number(v)) ? null : Number(v).toString());

type ItemRow = { id: string; baseUom: string | null; sourcingPolicy: string | null };

/** Validate a link body and build its column values. Returns an error message instead of throwing. */
function linkValues(item: ItemRow, b: any): { error: string } | { values: Record<string, any>; levels: PackLevel[] } {
  const supplierUom = s(b?.supplierUom, 16);
  // Cross-dimension packaging (e.g. item Lt ↔ supplier Lb) requires an explicit factor.
  const factorRequired = !!(item.baseUom && supplierUom && needsConversionFactor(item.baseUom, supplierUom));
  const factor = numOrNull(b?.conversionFactor);
  if (factorRequired && !factor) {
    return { error: `A conversion factor is required to convert supplier UoM "${supplierUom}" to item base UoM "${item.baseUom}".` };
  }

  // An "any supplier" item is ordered in its own base UoM: a pack describes one
  // named vendor's packaging and there is no such vendor here. Refused rather
  // than quietly dropped, so nobody fills the fields in and wonders later why
  // their order is priced by the kilo.
  const packFields = [b?.innerUnitPackSize, b?.innerPackType, b?.unitsInOuterPack, b?.outerPackType];
  if (!allowsPackConfiguration(item.sourcingPolicy) && packFields.some(v => v != null && String(v).trim() !== "")) {
    return { error: `"${sourcingOf(item.sourcingPolicy).label}" items are bought in their base unit — remove the pack configuration, or set the item to "${SOURCING_POLICIES.restricted.label}".` };
  }

  const values = {
    supplierUom,
    skuName: s(b?.skuName, 255), supplierSku: s(b?.supplierSku),
    itemCodeBySupplier: s(b?.itemCodeBySupplier),
    innerUnitPackSize: numOrNull(b?.innerUnitPackSize), innerPackType: s(b?.innerPackType, 32),
    unitsInOuterPack: numOrNull(b?.unitsInOuterPack), outerPackType: s(b?.outerPackType, 32),
    conversionFactor: factor,
    // Commercial terms, quoted per one supplier UoM (see 0089).
    unitPrice: numOrNull(b?.unitPrice),
    currency: s(b?.currency, 3)?.toUpperCase() ?? null,
    leadTimeDays: b?.leadTimeDays == null || b.leadTimeDays === "" ? null : Math.max(0, Math.round(Number(b.leadTimeDays))) || null,
    minOrderQty: numOrNull(b?.minOrderQty),
  };
  // A barcode can only sit on a level this link actually has.
  const levels: PackLevel[] = ["unit"];
  if (values.innerUnitPackSize || values.innerPackType) levels.push("inner");
  if (values.unitsInOuterPack || values.outerPackType) levels.push("outer");
  return { values, levels };
}

/** Fields that decide how much stock an order line becomes. Frozen once a document uses the link. */
const QUANTITY_FIELDS = ["supplierUom", "innerUnitPackSize", "innerPackType", "unitsInOuterPack", "outerPackType", "conversionFactor"] as const;

// Stored numerics come back as strings ("25.0000"); compare them as numbers so
// an untouched pack size never reads as "changed".
const norm = (x: any) => (x == null || String(x).trim() === "" ? null : isNaN(Number(x)) ? String(x).trim() : Number(x));
const sameValue = (a: any, b: any) => norm(a) === norm(b);

async function loadItem(orgId: string, itemId: string): Promise<ItemRow | undefined> {
  const [item] = await db.select({ id: apItems.id, baseUom: apItems.baseUom, sourcingPolicy: apItems.sourcingPolicy })
    .from(apItems).where(and(eq(apItems.id, itemId), eq(apItems.orgId, orgId))).limit(1);
  return item;
}

/** One preferred link per item (partial unique index in 0089). Stand the others
 *  down FIRST: neon-http has no transactions, so a brief window with none
 *  preferred is recoverable, whereas the write failing on the index would leave
 *  the user's save silently rejected. */
async function standDownPreferred(orgId: string, itemId: string, exceptId?: string) {
  await db.update(itemSupplierSkus).set({ isPreferred: false })
    .where(and(eq(itemSupplierSkus.orgId, orgId), eq(itemSupplierSkus.itemId, itemId), eq(itemSupplierSkus.isPreferred, true),
      ...(exceptId ? [ne(itemSupplierSkus.id, exceptId)] : [])));
}

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
  const item = await loadItem(orgId!, String(b?.itemId));
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

  const v = linkValues(item, b);
  if ("error" in v) return bad(v.error);
  // Barcodes are validated BEFORE anything is written (no transactions).
  let ids;
  try { ids = await prepareIdentifiers(orgId!, item.id, b?.identifiers, v.levels); }
  catch (e) { const m = identifierErrorMessage(e); if (m) return bad(m); throw e; }

  const isPreferred = b?.isPreferred === true;
  if (isPreferred) await standDownPreferred(orgId!, item.id);

  const [row] = await db.insert(itemSupplierSkus).values({
    orgId: orgId!, itemId: item.id, supplierId, ...v.values,
    // The first link an item gets is its preferred one — otherwise the common
    // single-supplier case would need a deliberate extra click to express what
    // is already true.
    isPreferred: isPreferred || !(await db.select({ id: itemSupplierSkus.id }).from(itemSupplierSkus)
      .where(and(eq(itemSupplierSkus.orgId, orgId!), eq(itemSupplierSkus.itemId, item.id))).limit(1)).length,
  } as any).returning();
  await writeIdentifiers(orgId!, item.id, { supplierSkuId: row.id }, ids);
  return ok(row);
}

export async function PATCH(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  const b = await req.json().catch(() => ({}));
  const [existing] = await db.select().from(itemSupplierSkus)
    .where(and(eq(itemSupplierSkus.id, id), eq(itemSupplierSkus.orgId, orgId!))).limit(1);
  if (!existing) return bad("Supplier link not found", 404);
  const item = await loadItem(orgId!, existing.itemId);
  if (!item) return bad("Item not found", 404);

  // The supplier IS the link's identity. Pointing it at another supplier would
  // silently re-attribute every purchase order already raised against it.
  if (b?.supplierId && b.supplierId !== existing.supplierId) {
    return bad("A link's supplier can't be changed — link the item to the other supplier instead, then remove this one.");
  }

  const v = linkValues(item, b);
  if ("error" in v) return bad(v.error);

  // Once an order line uses this link, its unit and packs decided how much
  // stock that line became. Changing them would make the booked quantity and
  // the recorded packaging disagree — so they freeze, while price, lead time,
  // SKU codes and barcodes stay editable.
  const changed = QUANTITY_FIELDS.filter(k => !sameValue((existing as any)[k], v.values[k]));
  if (changed.length) {
    const blockers = await supplierSkuReferences(orgId!, id);
    if (blockers.length) {
      return NextResponse.json({
        error: `This link's unit and packaging are used by ${blockers.map(x => `${x.count} ${x.label}`).join(", ")}, so they can't change — that would alter quantities already on those documents. Price, lead time, codes and barcodes can still be edited. For new packaging, link the supplier again with it.`,
        blockers,
      }, { status: 409 });
    }
  }

  let ids;
  try { ids = await prepareIdentifiers(orgId!, item.id, b?.identifiers, v.levels); }
  catch (e) { const m = identifierErrorMessage(e); if (m) return bad(m); throw e; }

  const isPreferred = b?.isPreferred === undefined ? existing.isPreferred : b.isPreferred === true;
  if (isPreferred && !existing.isPreferred) await standDownPreferred(orgId!, item.id, id);

  const [row] = await db.update(itemSupplierSkus).set({ ...v.values, isPreferred } as any)
    .where(and(eq(itemSupplierSkus.id, id), eq(itemSupplierSkus.orgId, orgId!))).returning();
  await writeIdentifiers(orgId!, item.id, { supplierSkuId: id }, ids);
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
