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

/** A functional acknowledgement (X12 997 / EDIFACT CONTRL): did the partner's translator accept our group? */
export type EdiAckStatus = "accepted" | "accepted_with_errors" | "partially_accepted" | "rejected";
export type EdiFunctionalAck = {
  functionalId: string;
  /** The group control number of OUR file it answers. */
  groupControlNo: number;
  groupStatus: EdiAckStatus;
  codes: string[];
  txns: { setId: string; controlNo: string; status: EdiAckStatus; codes: string[] }[];
};

/** One acknowledged line of a PO acknowledgement, with each status the partner gave it. */
export type EdiAckLine = {
  /** Our line number, echoed back. */
  lineNo: string;
  qty: number | null; unit: string | null; price: number | null;
  acks: { status: string; qty: number | null; unit: string | null; dateQualifier: string | null; date: string | null; rawDate: string | null }[];
};

/** A PO acknowledgement (X12 855 / EDIFACT ORDRSP). */
export type EdiOrderAck = { ackType: string; poNumber: string; poDate: string | null; lines: EdiAckLine[] };

/** One item in a ship notice: what is in which package, for which order line. */
export type EdiShipItem = {
  /** LIN01: the order line it fills, echoed back. */
  lineNo: string;
  /** Identifiers from LIN (qualifier → value: VP, BP, UP, EN, UK, LT …). */
  ids: Record<string, string>;
  qty: number | null; unit: string | null;
  /** Supplier batch (LIN LT or REF*LT). */
  batch: string | null;
  productionDate: string | null; bestBeforeDate: string | null; expiryDate: string | null;
  /** Dates as sent, when one could not be read. */
  badDates: string[];
  /** SSCC of the nearest pack or pallet it is in. */
  sscc: string | null;
};
export type EdiShipPackage = { sscc: string; level: "tare" | "pack"; parentSscc: string | null };
/** One order in a ship notice. */
export type EdiShipOrder = { poNumber: string; items: EdiShipItem[]; packages: EdiShipPackage[] };
/** An advance ship notice (X12 856 / EDIFACT DESADV). */
export type EdiShipNotice = {
  /** BSN01: 00 original, 05 replace, 01 cancel. */
  purpose: string;
  shipmentId: string;
  shipDate: string | null; expectedDate: string | null;
  carrier: string | null; trackingNo: string | null;
  orders: EdiShipOrder[];
  /** Things the reader could not place (an item with no order above it, an unreadable date). */
  problems: string[];
};

/** One line of a supplier invoice. */
export type EdiInvoiceLine = { lineNo: string; qty: number | null; unit: string | null; price: number | null; ids: Record<string, string> };
/** A supplier invoice (X12 810 / EDIFACT INVOIC). Amounts in the invoice currency. */
export type EdiInvoice = {
  invoiceNo: string; invoiceDate: string | null; poNumber: string; currency: string | null;
  dueDate: string | null; netDays: number | null;
  lines: EdiInvoiceLine[];
  /** TDS01, the invoice total. */
  total: number | null;
  /** TXI amounts, summed. */
  tax: number | null;
  /** SAC charges (+) and allowances (-). */
  charges: { code: string; amount: number }[];
  problems: string[];
};

/** One line of a customer's purchase order (X12 850 inbound). Identifiers keyed by qualifier: VP our number, BP theirs, UP/EN/UK a GTIN. */
export type EdiInboundOrderLine = { lineNo: string; qty: number | null; unit: string | null; price: number | null; ids: Record<string, string>; description: string | null };
/** A customer's purchase order as it arrives. Dates as YYYY-MM-DD, null when absent or unreadable (the reason is in `problems`). */
export type EdiInboundOrder = {
  purpose: string; poNumber: string; poDate: string | null; currency: string | null; requestedDate: string | null;
  /** N1*ST: their place identifier. `gln` when qualifier UL, else `code` (their own location code). */
  shipTo: { name: string | null; gln: string | null; code: string | null } | null;
  lines: EdiInboundOrderLine[];
  problems: string[];
};
