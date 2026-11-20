/**
 * The canonical EDI model (docs/prd-edi.md §3.2). Pure, client-safe.
 *
 * The app speaks THIS, never segments or qualifiers. Builders turn our records
 * into it (lib/edi/build/*); adapters turn it into a wire format (lib/edi/x12/*,
 * EDIFACT later). Dates are calendar dates as stored (YYYY-MM-DD), never a Date.
 */

export type EdiAddress = {
  street?: string | null; line2?: string | null; city?: string | null;
  state?: string | null; postcode?: string | null; countryCode?: string | null;
};

export type EdiParty = { name: string; gln?: string | null; address?: EdiAddress | null };

export type EdiOrderLine = {
  lineNo: number;
  /** In the unit the line is ordered in. */
  qty: number;
  /** Our name for the order unit (a UoM or a pack type: "kg", "case", "bag"). */
  unit: string | null;
  /** Price per order unit, in the order currency. */
  unitPrice: number;
  description: string;
  /** The PARTNER's part number for this item at this pack level (X12 VP on our PO). */
  partNumber: string | null;
  /** Our own item code (X12 BP on our PO). */
  buyerItemCode: string | null;
  /** GTIN for this pack level, normalised to 14 digits. */
  gtin: string | null;
  /** How many base units one order unit holds, when ordered as a pack (> 1). */
  packContent: number | null;
  /** The item's base unit, the unit packContent is counted in. */
  baseUnit: string | null;
  requestedDate: string | null;
};

export type EdiTerms = { netDays: number | null; discountPercent: number | null; discountDays: number | null };

/** A purchase order as EDI sees it (X12 850 / EDIFACT ORDERS). */
export type EdiOrder = {
  orderNumber: string;
  orderDate: string;
  currency: string | null;
  requestedDeliveryDate: string | null;
  /** The number the seller knows us by. */
  ourAccountNumber: string | null;
  incoterm: string | null;
  incotermPlace: string | null;
  terms: EdiTerms | null;
  buyer: EdiParty;
  seller: EdiParty;
  shipTo: EdiParty | null;
  lines: EdiOrderLine[];
  total: number;
};
