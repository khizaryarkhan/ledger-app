/**
 * Our purchase order → the canonical EdiOrder. Pure. The facts are loaded by
 * purchase-order-server.ts; this decides only what each fact means on the wire.
 *
 * Each line carries the identifiers for the level it is ORDERED at: the
 * supplier's part number and the GTIN for that pack, never the unit's (the
 * bag's code against a carton quantity orders the wrong pack — same rule as
 * partNumberForLevel). An order unit holding several base units adds the pack
 * content (X12 PO4).
 */

import type { EdiOrder, EdiAddress } from "@/lib/edi/model";
import { roundQty } from "@/lib/inventory/round";

export type AddressFacts = {
  addressStreet?: string | null; addressLine2?: string | null; addressCity?: string | null;
  addressState?: string | null; addressPostcode?: string | null; countryCode?: string | null;
};
export type PoFacts = {
  po: {
    docNumber: string | null; issueDate: string; currency: string | null; expiryDate: string | null;
    incoterm: string | null; incotermPlace: string | null; paymentTermsDays: number | null;
    discountPercent: string | number | null; discountDays: number | null; total: string | number;
  };
  org: { name: string; displayName?: string | null; gln: string | null } & AddressFacts;
  supplier: { name: string; gln: string | null; ourAccountNumber: string | null } & AddressFacts;
  shipTo: ({ name: string; gln: string | null } & AddressFacts) | null;
  lines: {
    lineNo: number; description: string | null; itemName: string | null; itemCode: string | null;
    qty: string | number | null; rate: string | number | null; orderUom: string | null; baseUom: string | null;
    unitsPerOrderUnit: string | number | null; partNumber: string | null; gtin: string | null; requestedDate: string | null;
  }[];
};

const address = (a: AddressFacts): EdiAddress | null => {
  const out = { street: a.addressStreet ?? null, line2: a.addressLine2 ?? null, city: a.addressCity ?? null,
    state: a.addressState ?? null, postcode: a.addressPostcode ?? null, countryCode: a.countryCode ?? null };
  return Object.values(out).some(Boolean) ? out : null;
};
const n = (v: unknown) => (v == null || v === "" ? null : Number(v));

export function buildEdiOrderFromPo(f: PoFacts): EdiOrder {
  return {
    orderNumber: f.po.docNumber ?? "",
    orderDate: f.po.issueDate,
    currency: f.po.currency ? f.po.currency.toUpperCase() : null,
    requestedDeliveryDate: f.po.expiryDate || null,
    ourAccountNumber: f.supplier.ourAccountNumber,
    incoterm: f.po.incoterm, incotermPlace: f.po.incotermPlace,
    terms: f.po.paymentTermsDays != null || f.po.discountPercent != null
      ? { netDays: f.po.paymentTermsDays, discountPercent: n(f.po.discountPercent), discountDays: f.po.discountDays }
      : null,
    buyer: { name: f.org.displayName || f.org.name, gln: f.org.gln, address: address(f.org) },
    seller: { name: f.supplier.name, gln: f.supplier.gln, address: address(f.supplier) },
    shipTo: f.shipTo ? { name: f.shipTo.name, gln: f.shipTo.gln, address: address(f.shipTo) } : null,
    lines: f.lines.map(l => {
      const per = Number(l.unitsPerOrderUnit) || 1;
      return {
        lineNo: l.lineNo,
        qty: roundQty(Number(l.qty ?? 0)),
        unit: l.orderUom || l.baseUom,
        unitPrice: Number(l.rate ?? 0),
        description: l.description || l.itemName || "",
        partNumber: l.partNumber, buyerItemCode: l.itemCode, gtin: l.gtin,
        packContent: per > 1 ? roundQty(per) : null,
        baseUnit: l.baseUom,
        requestedDate: l.requestedDate,
      };
    }),
    total: Number(f.po.total ?? 0),
  };
}
