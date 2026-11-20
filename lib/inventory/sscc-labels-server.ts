/**
 * What a pallet or carton label needs, for every package of one shipment: who ships it, who receives it, the SSCC, and what
 * is inside (item, quantity in the item's base unit). Read-only. Packing itself: sscc-server.ts; the barcode: lib/barcode.
 *
 * The delivery address is the Sales Orders' own delivery address, and only when every order on the shipment names the SAME
 * one: two different addresses on one shipment would be a guess, so the label then carries the customer's name alone.
 */

import { db } from "@/db";
import { organisations, salesShipments, tradeDocuments, partyShipTo, apItems, shipmentLines } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { shipmentPacking } from "@/lib/inventory/sscc-server";
import { shipToLines } from "@/lib/customer-ship-to";

export async function shipmentLabels(orgId: string, shipmentId: string) {
  const packing = await shipmentPacking(orgId, shipmentId);            // throws "not found" for another org's shipment
  const [sh] = await db.select().from(salesShipments).where(and(eq(salesShipments.id, shipmentId), eq(salesShipments.orgId, orgId))).limit(1);
  const [org] = await db.select().from(organisations).where(eq(organisations.id, orgId)).limit(1);

  const soRows = await db.select({ soId: shipmentLines.soId }).from(shipmentLines).where(and(eq(shipmentLines.shipmentId, shipmentId), eq(shipmentLines.orgId, orgId)));
  const soIds = [...new Set(soRows.map(r => r.soId).filter(Boolean) as string[])];
  const sos = soIds.length ? await db.select({ id: tradeDocuments.id, ref: tradeDocuments.partyRef, shipTo: tradeDocuments.customerShipToId }).from(tradeDocuments)
    .where(and(eq(tradeDocuments.orgId, orgId), inArray(tradeDocuments.id, soIds))) : [];
  const addrIds = [...new Set(sos.map(s => s.shipTo).filter(Boolean) as string[])];
  const [addr] = addrIds.length === 1 && sos.every(s => s.shipTo === addrIds[0])
    ? await db.select().from(partyShipTo).where(and(eq(partyShipTo.orgId, orgId), eq(partyShipTo.id, addrIds[0]))).limit(1) : [];

  const itemIds = [...new Set(packing.lines.map(l => l.itemId))];
  const items = itemIds.length ? await db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, itemIds))) : [];
  const lineById = new Map(packing.lines.map(l => [l.id, l]));
  const itemById = new Map(items.map(i => [i.id, i]));

  return {
    shipmentNo: sh?.shipmentNo ?? null, shipDate: sh?.shipmentDate ?? null,
    customer: sh?.customerLabel ?? null,
    shipFrom: { name: org?.displayName || org?.name || "", lines: shipToLines({ addressStreet: org?.addressStreet, addressLine2: (org as any)?.addressLine2, addressCity: org?.addressCity, addressState: (org as any)?.addressState, addressPostcode: org?.addressPostcode, countryCode: org?.addressCountryCode }) },
    shipTo: addr ? { name: addr.name, lines: shipToLines(addr) } : null,
    orderRefs: [...new Set(sos.map(s => s.ref).filter(Boolean) as string[])],
    labels: packing.packages.map(p => ({
      sscc: p.sscc, packType: p.packType, parentSscc: packing.packages.find(x => x.id === p.parentId)?.sscc ?? null,
      contents: p.contents.map(c => {
        const l = lineById.get(c.shipmentLineId); const it = l ? itemById.get(l.itemId) : undefined;
        return { item: it?.name ?? l?.description ?? "Item", qty: c.qtyBase, uom: it?.baseUom ?? null };
      }),
    })),
  };
}
