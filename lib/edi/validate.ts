/**
 * Pre-send validation (docs/prd-edi.md §3.2). Pure, client-safe.
 *
 * Refuses an order the partner could not process, naming the line, and never
 * guesses: a unit with no exact code, a line the partner cannot identify, or a
 * missing identifier the partner requires is a problem to fix in the app, not a
 * value to make up. On success it hands back the resolved wire codes.
 */

import type { EdiOrder } from "@/lib/edi/model";
import { ediUnitCode } from "@/lib/inventory/uom";
import { QTY_EPSILON } from "@/lib/inventory/round";

export type SendRules = { requirePartNumber: boolean; requireGtin: boolean; unitOverrides: Record<string, string> };
export type Problem = { lineNo: number | null; message: string };
export type ResolvedLine = { lineNo: number; unitCode: string; packUnitCode: string | null };
export type Prepared = { ok: true; lines: ResolvedLine[] } | { ok: false; problems: Problem[] };

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Our unit → the partner's X12 code: the partner's own override first, then the standard table. */
export function x12UnitFor(unit: string | null, overrides: Record<string, string>): { ok: true; code: string } | { ok: false; reason: string } {
  const key = String(unit ?? "").trim().toLowerCase();
  if (key && overrides[key]) return { ok: true, code: overrides[key] };
  const r = ediUnitCode(unit, "x12");
  if (r.ok === false) return { ok: false, reason: r.reason };
  return { ok: true, code: r.code };
}

export function prepareOrderForX12(order: EdiOrder, rules: SendRules): Prepared {
  const problems: Problem[] = [];
  const head = (message: string) => problems.push({ lineNo: null, message });
  if (!order.orderNumber?.trim()) head("The order has no number.");
  if (!YMD.test(order.orderDate ?? "")) head("The order date is missing.");
  if (order.requestedDeliveryDate && !YMD.test(order.requestedDeliveryDate)) head("The delivery date is not a date.");
  if (order.currency && !/^[A-Z]{3}$/.test(order.currency)) head(`"${order.currency}" is not a currency code.`);
  if (!order.buyer.name?.trim()) head("Our company name is missing (Settings → Company).");
  if (!order.seller.name?.trim()) head("The supplier has no name.");
  if (!order.lines.length) head("The order has no item lines.");

  const lines: ResolvedLine[] = [];
  for (const l of order.lines) {
    const at = (message: string) => problems.push({ lineNo: l.lineNo, message });
    const before = problems.length;
    if (!(l.qty > QTY_EPSILON)) at("The quantity must be more than zero.");
    if (!(l.unitPrice >= 0)) at("The price cannot be negative.");
    const unit = x12UnitFor(l.unit, rules.unitOverrides);
    if (unit.ok === false) at(`Unit: ${unit.reason} Add a unit code for this partner, or order in another unit.`);
    let packUnitCode: string | null = null;
    if (l.packContent && l.packContent > 1) {
      const base = x12UnitFor(l.baseUnit, rules.unitOverrides);
      if (base.ok === false) at(`Pack content unit: ${base.reason}`);
      else packUnitCode = base.code;
    }
    if (rules.requirePartNumber && !l.partNumber) at("The supplier's part number for this pack level is missing (Products → the item's supplier link).");
    if (rules.requireGtin && !l.gtin) at("A GTIN for this pack level is missing (Products → the item's barcodes).");
    if (!l.partNumber && !l.gtin && !l.buyerItemCode) at("Nothing identifies this item to the partner: add their part number, a GTIN or an item code.");
    if (l.requestedDate && !YMD.test(l.requestedDate)) at("The line's delivery date is not a date.");
    if (problems.length === before && unit.ok) lines.push({ lineNo: l.lineNo, unitCode: unit.code, packUnitCode });
  }
  return problems.length ? { ok: false, problems } : { ok: true, lines };
}
