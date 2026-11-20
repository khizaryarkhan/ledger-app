/**
 * Load the facts an outbound 850 needs for one native purchase order. Read-only.
 * Pure mapping: purchase-order.ts.
 */

import { db } from "@/db";
import {
  tradeDocuments, tradeDocumentLines, organisations, parties, stockLocations, apItems, itemIdentifiers,
} from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { supplierPartNumbersFor } from "@/lib/inventory/part-numbers-server";
import { partNumberForLevel, type PartNumberMap } from "@/lib/inventory/part-numbers";
import type { PoFacts, AddressFacts } from "@/lib/edi/build/purchase-order";

const addr = (x: { addressStreet?: string | null; addressLine2?: string | null; addressCity?: string | null; addressState?: string | null; addressPostcode?: string | null } | undefined): AddressFacts => x ? {
  addressStreet: x.addressStreet ?? null, addressLine2: x.addressLine2 ?? null, addressCity: x.addressCity ?? null,
  addressState: x.addressState ?? null, addressPostcode: x.addressPostcode ?? null,
} : {};

export async function loadPoFacts(orgId: string, poId: string): Promise<(PoFacts & { supplierId: string | null }) | null> {
  const [po] = await db.select().from(tradeDocuments).where(and(eq(tradeDocuments.id, poId), eq(tradeDocuments.orgId, orgId))).limit(1);
  if (!po || po.kind !== "PurchaseOrder") return null;
  const [org] = await db.select().from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const sup = po.partyId
    ? (await db.select().from(parties).where(and(eq(parties.id, po.partyId), eq(parties.orgId, orgId))).limit(1))[0]
    : undefined;
  // Ship-to: the PO's own location, else the org's default location (0139).
  const [loc] = await db.select().from(stockLocations).where(and(eq(stockLocations.orgId, orgId),
    po.shipToLocationId ? eq(stockLocations.id, po.shipToLocationId) : eq(stockLocations.isDefault, true))).limit(1);

  const lines = (await db.select().from(tradeDocumentLines)
    .where(and(eq(tradeDocumentLines.documentId, poId), eq(tradeDocumentLines.orgId, orgId))).orderBy(tradeDocumentLines.lineNo))
    .filter(l => l.itemId);
  const itemIds = [...new Set(lines.map(l => l.itemId!))];
  const supIds = [...new Set(lines.map(l => l.supplierSkuId).filter(Boolean) as string[])];
  const [items, ids, parts] = await Promise.all([
    itemIds.length ? db.select({ id: apItems.id, name: apItems.name, code: apItems.code, baseUom: apItems.baseUom }).from(apItems).where(inArray(apItems.id, itemIds)) : Promise.resolve([]),
    itemIds.length ? db.select().from(itemIdentifiers).where(and(eq(itemIdentifiers.orgId, orgId), inArray(itemIdentifiers.itemId, itemIds), eq(itemIdentifiers.scheme, "GTIN"))) : Promise.resolve([]),
    supplierPartNumbersFor(orgId, supIds),
  ]);
  const itemBy = new Map(items.map(i => [i.id, i]));
  // GTIN per level: the supplier link's own codes first, then the item's own (unowned) codes.
  const gtinMap = (itemId: string, supplierSkuId: string | null): PartNumberMap => {
    const own: Record<string, string> = {}; const link: Record<string, string> = {};
    for (const r of ids) {
      if (r.itemId !== itemId) continue;
      if (supplierSkuId && r.supplierSkuId === supplierSkuId) link[r.packLevel] = r.code;
      else if (!r.supplierSkuId && !r.itemSkuId) own[r.packLevel] = r.code;
    }
    return { ...own, ...link } as PartNumberMap;
  };

  return {
    supplierId: po.partyId,
    po: {
      docNumber: po.docNumber, issueDate: po.issueDate, currency: po.currency, expiryDate: po.expiryDate,
      incoterm: po.incoterm, incotermPlace: po.incotermPlace, paymentTermsDays: po.paymentTermsDays,
      discountPercent: po.discountPercent, discountDays: po.discountDays, total: po.total,
    },
    org: { name: org?.name ?? "", displayName: org?.displayName ?? null, gln: org?.gln ?? null, ...addr(org), countryCode: org?.addressCountryCode ?? null },
    supplier: { name: sup?.name ?? po.partyLabel ?? "", gln: sup?.gln ?? null, ourAccountNumber: sup?.ourAccountNumber ?? null, ...addr(sup), countryCode: sup?.countryCode ?? null },
    shipTo: loc ? { name: loc.name, gln: loc.gln ?? null, ...addr(loc), countryCode: loc.countryCode ?? null } : null,
    lines: lines.map(l => {
      const item = itemBy.get(l.itemId!);
      return {
        lineNo: l.lineNo, description: l.description, itemName: item?.name ?? null, itemCode: item?.code ?? null,
        qty: l.qty, rate: l.rate, orderUom: l.orderUom, baseUom: item?.baseUom ?? null, unitsPerOrderUnit: l.unitsPerOrderUnit,
        partNumber: l.supplierSkuId ? partNumberForLevel(parts.get(l.supplierSkuId) ?? {}, l.packLevel) : null,
        gtin: partNumberForLevel(gtinMap(l.itemId!, l.supplierSkuId), l.packLevel),
        requestedDate: l.requestedDate ?? null,
      };
    }),
  };
}
