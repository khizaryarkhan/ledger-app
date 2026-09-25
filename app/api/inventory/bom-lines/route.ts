/** POST /api/inventory/bom-lines (add input/output line) · DELETE ?id= */

import { db } from "@/db";
import { bomLines, boms, apItems } from "@/db/schema";
import { convert, uom as uomOf } from "@/lib/inventory/uom";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq } from "drizzle-orm";

const s = (v: any, n = 64) => (v == null || String(v).trim() === "" ? null : String(v).trim().slice(0, n));
const numStr = (v: any, d: string | null = null) => (v == null || v === "" || isNaN(Number(v)) ? d : String(Number(v)));

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const b = await req.json().catch(() => ({}));
  const [bom] = await db.select({ id: boms.id }).from(boms).where(and(eq(boms.id, String(b?.bomId)), eq(boms.orgId, orgId!))).limit(1);
  if (!bom) return bad("BOM not found", 404);
  const roleVal = b?.role === "output" ? "output" : b?.role === "pack" ? "pack" : "input";
  if (!s(b?.itemId)) return bad("An item is required");
  // Every consumer of a BOM line — builds, MO planning, allocation — reads its
  // quantity in the item's BASE unit. A line entered in another unit is
  // converted here, once, when it can be (500 g of a kg item → 0.5), and
  // refused when it can't (litres of a kg item need a density nobody gave).
  let qtyIn = numStr(b?.qty, "0")!, uomIn = s(b?.uom, 16);
  if (roleVal !== "output") {
    const [it] = await db.select({ baseUom: apItems.baseUom, name: apItems.name }).from(apItems).where(and(eq(apItems.id, String(b.itemId)), eq(apItems.orgId, orgId!))).limit(1);
    if (!it) return bad("Item not found", 404);
    const base = it.baseUom;
    if (uomIn && base && uomIn.toLowerCase() !== base.toLowerCase()) {
      const r = uomOf(uomIn) && uomOf(base) ? convert(Number(qtyIn), uomIn, base) : null;
      if (!r || !r.ok) return bad(`${it.name} is kept in ${base}; ${uomIn} can't be converted to it. Enter the quantity in ${base}.`);
      qtyIn = String(Math.round(r.qty * 1e6) / 1e6);
    }
    uomIn = base ?? uomIn;
  }
  const [row] = await db.insert(bomLines).values({
    orgId: orgId!, bomId: bom.id, role: roleVal,
    itemId: s(b?.itemId, 64) as any,
    skuId: s(b?.skuId, 64) as any,
    qty: qtyIn, uom: uomIn,
    packagingConfig: s(b?.packagingConfig, 128),
    outputPackQty: numStr(b?.outputPackQty),
    packagingForSkuId: s(b?.packagingForSkuId, 64) as any,
    supplierSkuId: s(b?.supplierSkuId, 64) as any,
    sortOrder: Number.isFinite(Number(b?.sortOrder)) ? Number(b?.sortOrder) : 0,
  } as any).returning();
  return ok(row);
}

export async function DELETE(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return bad("id required");
  await db.delete(bomLines).where(and(eq(bomLines.id, id), eq(bomLines.orgId, orgId!)));
  return ok({ id, deleted: true });
}
