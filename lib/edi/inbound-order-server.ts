/**
 * 850: a customer's purchase order becomes a Sales Order, as a DOCUMENT only
 * (no stock, no ledger): a person confirms it and it ships through Shipping as
 * any order does. Never guesses (inboundOrderToSalesOrder in inbound.ts):
 * anything it cannot place goes to review with the line named, and NOTHING is
 * created. Called from inbound-server.ts for each 850 in an uploaded file.
 */

import { db } from "@/db";
import { tradeDocuments, apItems, itemSkus, itemIdentifiers, parties, type ediPartners } from "@/db/schema";
import { and, eq, inArray, sql, isNull } from "drizzle-orm";
import { parse850 } from "@/lib/edi/x12/inbound";
import { inboundOrderToSalesOrder, type ItemRef, type OrderItemCtx } from "@/lib/edi/inbound";
import { LedgerValidationError } from "@/lib/ledger";
import { createTradeDoc } from "@/lib/accounting/trade-documents";
import { resolvePartNumber } from "@/lib/inventory/part-numbers-server";
import { findShipTo } from "@/lib/customer-ship-to-server";
import { normaliseGtin } from "@/lib/gs1";
import type { TxnResult } from "@/lib/edi/inbound-server";

type Partner = typeof ediPartners.$inferSelect;

/** Today as YYYY-MM-DD in UTC: only used when the order carries no date of its own. */
const todayYmd = () => new Date().toISOString().slice(0, 10);

export async function apply850(orgId: string, partner: Partner, segments: string[][], controlNo: string, actorId: string | null): Promise<TxnResult> {
  const order = parse850(segments);
  const tag = `Order ${order.poNumber || "(no number)"}`;
  const review = (summary: string, reasons: string[] = []): TxnResult => ({ setId: "850", controlNo, outcome: "review", summary, reasons });
  const [party] = await db.select({ id: parties.id, name: parties.name, partyType: parties.partyType }).from(parties)
    .where(and(eq(parties.id, partner.partyId), eq(parties.orgId, orgId))).limit(1);
  if (!party || party.partyType !== "customer") return review(`${tag}: this partner is not a customer, so its orders are not read.`);
  if (order.purpose !== "00") return review(`${tag}: a change or cancellation (BEG01 ${order.purpose || "none"}) is not read yet. Handle it on the Sales Order by hand.`);
  if (!order.poNumber.trim()) return review("The order has no number (BEG03).", order.problems);
  const [dup] = await db.select({ id: tradeDocuments.id, docNumber: tradeDocuments.docNumber }).from(tradeDocuments)
    .where(and(eq(tradeDocuments.orgId, orgId), eq(tradeDocuments.kind, "SalesOrder"), eq(tradeDocuments.partyId, party.id),
      sql`upper(${tradeDocuments.partyRef}) = upper(${order.poNumber.trim()})`)).limit(1);
  if (dup) return { ...review(`${tag} is already ${dup.docNumber}. Nothing created.`), soId: dup.id };

  const refs = await resolveOrderLines(orgId, party.id, order);
  const itemIds = [...new Set(refs.flatMap(r => [r.bp, r.gtin, r.vp]).filter(Boolean).map(x => x!.itemId))];
  const items = new Map<string, OrderItemCtx>();
  if (itemIds.length) {
    const rows = await db.select({ id: apItems.id, name: apItems.name, code: apItems.code, baseUom: apItems.baseUom, unitPrice: apItems.unitPrice }).from(apItems)
      .where(and(eq(apItems.orgId, orgId), inArray(apItems.id, itemIds)));
    const skus = await db.select().from(itemSkus).where(and(eq(itemSkus.orgId, orgId), inArray(itemSkus.itemId, itemIds)));
    for (const r of rows) items.set(r.id, { name: r.name, code: r.code, baseUom: r.baseUom, unitPrice: r.unitPrice == null ? null : Number(r.unitPrice), skus: skus.filter(k => k.itemId === r.id) });
  }
  const mapped = inboundOrderToSalesOrder(order, refs, items, partner.unitOverrides as Record<string, string>);
  if (mapped.ok === false) return review(`${tag}: it could not be turned into a Sales Order, so nothing was created.`, mapped.problems);

  let shipToId: string | undefined;
  if (order.shipTo && (order.shipTo.gln || order.shipTo.code)) {
    const hit = await findShipTo(orgId, party.id, { gln: order.shipTo.gln, code: order.shipTo.code });
    if (!hit) return review(`${tag}: the ship-to ${order.shipTo.gln ?? order.shipTo.code}${order.shipTo.name ? ` (${order.shipTo.name})` : ""} is not one of ${party.name}'s delivery addresses. Add it (or its GLN or code) and process the file again.`);
    shipToId = hit.id;
  }
  try {
    const so = await createTradeDoc(orgId, "SalesOrder", {
      partyType: "Customer", partyId: party.id, partyLabel: party.name,
      issueDate: order.poDate ?? todayYmd(),
      expiryDate: order.requestedDate, currency: order.currency ? order.currency.toUpperCase() : null,
      partyRef: order.poNumber.trim(), memo: `Received by EDI (850, control ${controlNo}).`,
      ...(shipToId !== undefined ? { customerShipToId: shipToId } : {}),
      lines: mapped.lines.map(l => ({ itemId: l.itemId, skuId: l.skuId, description: l.description, qty: l.qty, rate: l.rate, amount: l.amount,
        orderUom: l.orderUom, packLevel: l.packLevel, unitsPerOrderUnit: l.unitsPerOrderUnit })),
    }, actorId);
    return { setId: "850", controlNo, outcome: mapped.needsReview ? "review" : "applied", soId: so.id, reasons: mapped.notes,
      summary: `${tag} created as ${so.docNumber} (${mapped.lines.length} line${mapped.lines.length === 1 ? "" : "s"}). It is not confirmed or shipped: check it, then confirm.` };
  } catch (e) {
    if (e instanceof LedgerValidationError) return review(`${tag}: ${e.message}`);
    throw e;
  }
}

/** What each identifier on each line of a customer's order means, resolved against our records. Exact matches only. */
async function resolveOrderLines(orgId: string, customerId: string, order: ReturnType<typeof parse850>) {
  const out: { lineNo: string; bp: ItemRef | null; gtin: ItemRef | null; vp: ItemRef | null }[] = [];
  for (const l of order.lines) {
    let bp: ItemRef | null = null, gtin: ItemRef | null = null, vp: ItemRef | null = null;
    if (l.ids.BP) {
      const r = await resolvePartNumber(orgId, customerId, "customer", l.ids.BP);
      if (r) bp = { itemId: r.itemId, skuId: r.itemSkuId ?? null, level: r.packLevel as ItemRef["level"] };
    }
    const g = l.ids.UP ?? l.ids.EN ?? l.ids.UK;
    if (g) {
      const n = normaliseGtin(g);
      if (n.ok) {
        // A barcode we own names our item (or one of our sales SKUs); one owned by a supplier link is something we buy, not sell.
        const rows = await db.select().from(itemIdentifiers).where(and(eq(itemIdentifiers.orgId, orgId), eq(itemIdentifiers.code, n.gtin14), isNull(itemIdentifiers.supplierSkuId)));
        const distinct = new Set(rows.map(r => `${r.itemId}|${r.itemSkuId ?? ""}|${r.packLevel}`));
        if (distinct.size === 1) gtin = { itemId: rows[0].itemId, skuId: rows[0].itemSkuId ?? null, level: rows[0].packLevel as ItemRef["level"] };
      }
    }
    if (l.ids.VP) {
      const rows = await db.select({ id: apItems.id }).from(apItems).where(and(eq(apItems.orgId, orgId), sql`upper(${apItems.code}) = upper(${l.ids.VP})`)).limit(2);
      if (rows.length === 1) vp = { itemId: rows[0].id, skuId: null, level: "unit" };
    }
    out.push({ lineNo: l.lineNo, bp, gtin, vp });
  }
  return out;
}
