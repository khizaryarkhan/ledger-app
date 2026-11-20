/**
 * X12 810 Invoice writer (we are the SELLER invoicing a customer). Pure. Takes
 * the InvoiceOut the builder made; looks nothing up. A first cut against the
 * common 4010/5010 shape: BIG, CUR, REF, N1, ITD, one IT1 per line, TDS (the
 * total in CENTS, implied two decimals), TXI for tax, CTT.
 *
 * The tax TYPE is not stored with an invoice (only the amount), so it is sent
 * under the mutually defined code ZZ rather than guessed as VAT or sales tax.
 */

import type { InvoiceOut } from "@/lib/edi/build/invoice";
import { seg, ccyymmdd, num, interchange, clean, type Envelope } from "@/lib/edi/x12/envelope";
import { gtinPair } from "@/lib/edi/x12/850";

/** Money for TDS: whole cents, no decimal point. */
const cents = (n: number) => String(Math.round(n * 100));

export function write810(inv: InvoiceOut, env: Envelope): string {
  const body: string[] = [seg("BIG", ccyymmdd(inv.date), clean(inv.invoiceNo, 22), inv.poDate ? ccyymmdd(inv.poDate) : null, inv.poNumber ? clean(inv.poNumber, 22) : null, "", "", inv.kind === "credit" ? "CR" : "DI")];
  if (inv.currency) body.push(seg("CUR", "SE", inv.currency));
  body.push(seg("N1", "BT", clean(inv.customer.name, 60), ...(inv.customer.gln ? ["UL", inv.customer.gln] : [])));
  body.push(seg("N1", "SE", clean(inv.us.name, 60), ...(inv.us.gln ? ["UL", inv.us.gln] : [])));
  if (inv.dueDate) body.push(seg("ITD", "01", "3", "", "", "", ccyymmdd(inv.dueDate)));
  for (const it of inv.items) {
    const ids: string[] = [];
    if (it.partNumber) ids.push("BP", clean(it.partNumber, 48));
    if (it.gtin) ids.push(...gtinPair(it.gtin));
    if (it.itemCode) ids.push("VP", clean(it.itemCode, 48));
    if (!inv.poNumber && it.poNumber) ids.push("PO", clean(it.poNumber, 22));
    body.push(seg("IT1", clean(it.lineNo, 20), num(it.qty), it.unit, num(it.price), "", ...ids));
  }
  body.push(seg("TDS", cents(inv.total)));
  if (Math.abs(inv.tax) >= 0.005) body.push(seg("TXI", inv.taxType || "ZZ", num(inv.tax, 2)));
  // Charges (C) and allowances (A), amounts in cents like TDS; ZZZZ = mutually defined service, the description in SAC15.
  for (const c of inv.charges) body.push(seg("SAC", c.kind, "ZZZZ", "", "", cents(c.amount), "", "", "", "", "", "", "", "", "", clean(c.description, 80)));
  body.push(seg("CTT", inv.items.length));
  return interchange(env, "IN", "810", body);
}
