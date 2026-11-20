/**
 * SSCC allocation, shipment packing and receipt capture (0143), the server
 * half. Pure rules: lib/inventory/sscc.ts.
 *
 * Allocation is ONE UPDATE … RETURNING on the org's counter, so two packers can
 * never get the same serial even without transactions (neon-http has none),
 * and the unique (org, sscc) index stands behind it. A serial taken by a save
 * that then fails is simply not used: an SSCC must never be handed out twice,
 * and a gap in the numbering costs nothing.
 */

import { db } from "@/db";
import { salesShipments, shipmentLines, shipmentPackages, shipmentPackageLines, goodsReceipts, goodsReceiptPackages } from "@/db/schema";
import { and, eq, inArray, asc, sql } from "drizzle-orm";
import { buildSscc, normaliseSscc, preparePackage, packingSummary, type PackageInput } from "@/lib/inventory/sscc";

export class SsccError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const ssccErrorOf = (e: unknown) => (e instanceof SsccError ? e : null);
const isUniqueViolation = (e: any) => e?.code === "23505" || /duplicate key|unique constraint/i.test(String(e?.message ?? ""));

/** Take the next SSCC for the org. Refused (with where to fix it) when no GS1 Company Prefix is set. */
export async function allocateSscc(orgId: string): Promise<string> {
  const r: any = await db.execute(sql`
    update organisations set sscc_next_serial = sscc_next_serial + 1
    where id = ${orgId} and gs1_company_prefix is not null
    returning gs1_company_prefix as prefix, sscc_extension_digit as ext, sscc_next_serial - 1 as serial`);
  const row = (r.rows ?? r)[0];
  if (!row) throw new SsccError("Set your GS1 Company Prefix (Settings → Company) before packing: every SSCC is numbered from it.");
  try { return buildSscc(Number(row.ext), String(row.prefix), Number(row.serial)); }
  catch (e: any) { throw new SsccError(e.message); }
}

async function loadShipment(orgId: string, shipmentId: string) {
  const [s] = await db.select({ id: salesShipments.id, status: salesShipments.status }).from(salesShipments)
    .where(and(eq(salesShipments.id, shipmentId), eq(salesShipments.orgId, orgId))).limit(1);
  if (!s) throw new SsccError("Shipment not found.", 404);
  return s;
}

/** The shipment's packages (pallets first, cartons under them) with contents, and how much of each line is packed. */
export async function shipmentPacking(orgId: string, shipmentId: string) {
  await loadShipment(orgId, shipmentId);
  const [lines, pkgs] = await Promise.all([
    db.select({ id: shipmentLines.id, qtyBase: shipmentLines.qtyBase, description: shipmentLines.description, itemId: shipmentLines.itemId })
      .from(shipmentLines).where(and(eq(shipmentLines.shipmentId, shipmentId), eq(shipmentLines.orgId, orgId))).orderBy(asc(shipmentLines.createdAt)),
    db.select().from(shipmentPackages).where(and(eq(shipmentPackages.shipmentId, shipmentId), eq(shipmentPackages.orgId, orgId))).orderBy(asc(shipmentPackages.createdAt)),
  ]);
  const contents = pkgs.length
    ? await db.select().from(shipmentPackageLines).where(and(eq(shipmentPackageLines.orgId, orgId), inArray(shipmentPackageLines.packageId, pkgs.map(p => p.id))))
    : [];
  const summary = packingSummary(lines.map(l => ({ id: l.id, qtyBase: Number(l.qtyBase) })), contents.map(c => ({ shipmentLineId: c.shipmentLineId, qtyBase: Number(c.qtyBase) })));
  return {
    lines: lines.map(l => ({ ...l, qtyBase: Number(l.qtyBase), ...summary.rows.find(r => r.id === l.id)! })),
    packages: pkgs.map(p => ({ ...p, contents: contents.filter(c => c.packageId === p.id).map(c => ({ shipmentLineId: c.shipmentLineId, qtyBase: Number(c.qtyBase) })) })),
    fullyPacked: summary.fullyPacked,
  };
}

/** Add one package. Validated in full first; only then is an SSCC taken. */
export async function addShipmentPackage(orgId: string, shipmentId: string, input: PackageInput, actorId: string | null) {
  const shipment = await loadShipment(orgId, shipmentId);
  if (shipment.status !== "Posted") throw new SsccError("This shipment was reversed: nothing more can be packed on it.");
  const now = await shipmentPacking(orgId, shipmentId);
  const p = preparePackage(input,
    now.lines.map(l => ({ id: l.id, qtyBase: l.qtyBase, packedQty: l.packed, description: l.description })),
    now.packages.map(x => ({ id: x.id, parentId: x.parentId })));
  if (p.ok === false) throw new SsccError(p.error);

  const sscc = await allocateSscc(orgId);
  let row;
  try {
    [row] = await db.insert(shipmentPackages).values({
      orgId, shipmentId, parentId: p.pkg.parentId, sscc, packType: p.pkg.packType, grossWeightKg: p.pkg.grossWeightKg, createdBy: actorId,
    }).returning();
  } catch (e) {
    if (isUniqueViolation(e)) {
      console.error("[sscc] allocated SSCC already exists — counter behind the data?", { orgId, sscc });
      throw new SsccError(`SSCC ${sscc} is already in use. The SSCC counter is behind the codes already issued; contact support before packing more.`, 409);
    }
    throw e;
  }
  if (p.pkg.contents.length) {
    try {
      await db.insert(shipmentPackageLines).values(p.pkg.contents.map(c => ({ orgId, packageId: row.id, shipmentLineId: c.shipmentLineId, qtyBase: c.qtyBase.toFixed(6) })));
    } catch (e) {
      // Contents failed after the package row: remove the package so it does not stand empty under a
      // label nobody printed. The SSCC itself is never re-used.
      await db.delete(shipmentPackages).where(and(eq(shipmentPackages.id, row.id), eq(shipmentPackages.orgId, orgId)));
      console.error("[sscc] package contents failed to save; package removed", { orgId, shipmentId, sscc, e });
      throw e;
    }
  }
  return { ...row, contents: p.pkg.contents };
}

/** Remove a package. A pallet with cartons on it is refused: remove (or keep) the cartons first. */
export async function removeShipmentPackage(orgId: string, shipmentId: string, packageId: string) {
  const [pkg] = await db.select({ id: shipmentPackages.id }).from(shipmentPackages)
    .where(and(eq(shipmentPackages.id, packageId), eq(shipmentPackages.shipmentId, shipmentId), eq(shipmentPackages.orgId, orgId))).limit(1);
  if (!pkg) throw new SsccError("Package not found.", 404);
  const [kids] = await db.select({ n: sql<number>`count(*)::int` }).from(shipmentPackages)
    .where(and(eq(shipmentPackages.parentId, packageId), eq(shipmentPackages.orgId, orgId)));
  if (Number(kids?.n ?? 0) > 0) throw new SsccError(`${kids.n} package${Number(kids.n) === 1 ? " is" : "s are"} on this pallet. Remove them first.`, 409);
  await db.delete(shipmentPackages).where(and(eq(shipmentPackages.id, packageId), eq(shipmentPackages.orgId, orgId)));
}

/* ------------------------------ Goods receipts ------------------------------ */

async function loadReceipt(orgId: string, receiptId: string) {
  const [r] = await db.select({ id: goodsReceipts.id }).from(goodsReceipts)
    .where(and(eq(goodsReceipts.id, receiptId), eq(goodsReceipts.orgId, orgId))).limit(1);
  if (!r) throw new SsccError("Goods receipt not found.", 404);
}

export async function receiptSsccs(orgId: string, receiptId: string) {
  await loadReceipt(orgId, receiptId);
  return db.select({ id: goodsReceiptPackages.id, sscc: goodsReceiptPackages.sscc, createdAt: goodsReceiptPackages.createdAt })
    .from(goodsReceiptPackages).where(and(eq(goodsReceiptPackages.receiptId, receiptId), eq(goodsReceiptPackages.orgId, orgId)))
    .orderBy(asc(goodsReceiptPackages.createdAt));
}

/** Record a pallet / carton SSCC read from the supplier's label. The check digit must be right. */
export async function addReceiptSscc(orgId: string, receiptId: string, code: unknown, actorId: string | null) {
  await loadReceipt(orgId, receiptId);
  const n = normaliseSscc(code);
  if (n.ok === false) throw new SsccError(n.error);
  try {
    const [row] = await db.insert(goodsReceiptPackages).values({ orgId, receiptId, sscc: n.sscc, createdBy: actorId }).returning();
    return row;
  } catch (e) {
    if (isUniqueViolation(e)) throw new SsccError(`${n.sscc} is already recorded on this receipt.`, 409);
    throw e;
  }
}

export async function removeReceiptSscc(orgId: string, receiptId: string, id: string) {
  const r = await db.delete(goodsReceiptPackages)
    .where(and(eq(goodsReceiptPackages.id, id), eq(goodsReceiptPackages.receiptId, receiptId), eq(goodsReceiptPackages.orgId, orgId)))
    .returning({ id: goodsReceiptPackages.id });
  if (!r.length) throw new SsccError("SSCC not found on this receipt.", 404);
}
