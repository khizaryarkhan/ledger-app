/**
 * Expected deliveries (0144), the pure rules. Client-safe: no db import.
 *
 * An expected delivery is what a supplier SAYS is coming (an ASN, X12 856 /
 * DESADV, or typed by hand). It is a claim, never stock: Receiving pre-fills
 * from it, a person counts, and the receipt posts through postGoodsReceipt as
 * always. Server half: expected-delivery-server.ts.
 */

import { normaliseSscc } from "@/lib/inventory/sscc";
import { PACK_TYPES } from "@/lib/inventory/uom";
import { roundQty, QTY_EPSILON } from "@/lib/inventory/round";

export const DELIVERY_SOURCES = ["manual", "asn"] as const;
export type DeliverySource = (typeof DELIVERY_SOURCES)[number];
export type DeliveryState = "expected" | "received" | "cancelled";

const MAX_LINES = 500;
const MAX_PACKAGES = 500;
const PACK_SET = new Set<string>(PACK_TYPES as readonly string[]);

export type DeliveryPackageInput = { sscc?: unknown; packType?: unknown; parentSscc?: unknown };
export type DeliveryLineInput = {
  poLineId?: unknown; itemId?: unknown; qtyBase?: unknown; sscc?: unknown;
  supplierBatchNo?: unknown; productionDate?: unknown; bestBeforeDate?: unknown; expiryDate?: unknown;
};
export type DeliveryInput = {
  supplierId?: unknown; poId?: unknown; source?: unknown; reference?: unknown;
  shipDate?: unknown; expectedDate?: unknown; carrier?: unknown; trackingNo?: unknown; notes?: unknown;
  packages?: DeliveryPackageInput[]; lines?: DeliveryLineInput[];
};

/** A PO line the delivery may name: the PO it claims to fill decides which items may be on it. */
export type PoLineRef = { id: string; itemId: string; itemName?: string | null };

export type PreparedPackage = { sscc: string; packType: string | null; parentSscc: string | null };
export type PreparedLine = {
  lineNo: number; poLineId: string | null; itemId: string; qtyBase: number; sscc: string | null;
  supplierBatchNo: string | null; productionDate: string | null; bestBeforeDate: string | null; expiryDate: string | null;
};
export type PreparedDelivery = {
  source: DeliverySource; reference: string | null; shipDate: string | null; expectedDate: string | null;
  carrier: string | null; trackingNo: string | null; notes: string | null;
  packages: PreparedPackage[]; lines: PreparedLine[];
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
class Refusal extends Error {}
const refuse = (m: string): never => { throw new Refusal(m); };

const text = (v: unknown, max: number, label: string): string | null => {
  if (v == null) return null;
  const s = String(v).trim().replace(/\s+/g, " ");
  if (!s) return null;
  if (s.length > max) refuse(`${label} is longer than ${max} characters.`);
  return s;
};

/** A calendar date as YYYY-MM-DD, read literally (a date is a date — never through a Date's local getters). */
export function ymdOrNull(v: unknown, label: string): string | null {
  if (v == null || String(v).trim() === "") return null;
  const s = String(v).trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) refuse(`${label} must be a date (YYYY-MM-DD).`);
  const [y, mo, d] = [Number(m![1]), Number(m![2]), Number(m![3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) refuse(`${label} is not a real date.`);
  return s;
}

const sscc = (v: unknown, label: string): string | null => {
  if (v == null || String(v).trim() === "") return null;
  const n = normaliseSscc(v);
  if (n.ok === false) refuse(`${label}: ${n.error}`);
  return (n as { ok: true; sscc: string }).sscc;
};

/**
 * Validate a delivery. `poLines` is the PO's lines when the delivery names a
 * PO (every line must then be one of them, for that line's own item), or null
 * when it names none (every line then names an item, checked against
 * `knownItemIds`). An SSCC a line is packed in but the package list leaves out
 * is added as a package: an ASN may announce SSCCs only at item level.
 */
export function prepareDelivery(input: DeliveryInput, ctx: { poLines: PoLineRef[] | null; knownItemIds?: Set<string> }): Result<PreparedDelivery> {
  try {
    const source = (input.source == null || input.source === "" ? "manual" : String(input.source)) as DeliverySource;
    if (!DELIVERY_SOURCES.includes(source)) refuse("Source must be manual or asn.");
    const shipDate = ymdOrNull(input.shipDate, "Ship date");
    const expectedDate = ymdOrNull(input.expectedDate, "Expected date");
    if (shipDate && expectedDate && expectedDate < shipDate) refuse("The expected date is before the ship date.");

    const rawPkgs = Array.isArray(input.packages) ? input.packages : [];
    if (rawPkgs.length > MAX_PACKAGES) refuse(`A delivery can list at most ${MAX_PACKAGES} packages.`);
    const packages: PreparedPackage[] = [];
    const bySscc = new Map<string, PreparedPackage>();
    for (const p of rawPkgs) {
      const code = sscc(p?.sscc, "Package SSCC");
      if (!code) refuse("Every package needs its SSCC.");
      if (bySscc.has(code!)) refuse(`SSCC ${code} is listed twice.`);
      const packType = text(p?.packType, 32, "Package type")?.toLowerCase() ?? null;
      if (packType && !PACK_SET.has(packType)) refuse(`"${packType}" is not a package type.`);
      const pkg = { sscc: code!, packType, parentSscc: sscc(p?.parentSscc, "Pallet SSCC") };
      bySscc.set(code!, pkg); packages.push(pkg);
    }
    for (const p of packages) {
      if (!p.parentSscc) continue;
      if (p.parentSscc === p.sscc) refuse(`SSCC ${p.sscc} cannot be on itself.`);
      const parent = bySscc.get(p.parentSscc);
      if (!parent) refuse(`SSCC ${p.sscc} is on pallet ${p.parentSscc}, which the delivery does not list.`);
      if (parent!.parentSscc) refuse(`SSCC ${p.parentSscc} is itself on a pallet: packages nest one level only.`);
    }

    const rawLines = Array.isArray(input.lines) ? input.lines : [];
    if (!rawLines.length) refuse("Add at least one line: what the supplier says is coming.");
    if (rawLines.length > MAX_LINES) refuse(`A delivery can have at most ${MAX_LINES} lines.`);
    const poById = ctx.poLines ? new Map(ctx.poLines.map(l => [l.id, l])) : null;
    const lines: PreparedLine[] = rawLines.map((l, i) => {
      const at = `Line ${i + 1}`;
      let poLineId: string | null = null;
      let itemId = l?.itemId ? String(l.itemId) : "";
      if (poById) {
        poLineId = l?.poLineId ? String(l.poLineId) : "";
        const pl = poLineId ? poById.get(poLineId) : undefined;
        if (!pl) refuse(`${at}: choose a line of the purchase order.`);
        if (itemId && itemId !== pl!.itemId) refuse(`${at}: the item is not the one on that purchase order line.`);
        itemId = pl!.itemId;
      } else {
        if (l?.poLineId) refuse(`${at}: names a purchase order line, but the delivery names no purchase order.`);
        if (!itemId) refuse(`${at}: choose an item.`);
        if (ctx.knownItemIds && !ctx.knownItemIds.has(itemId)) refuse(`${at}: item not found.`);
      }
      const qty = Number(l?.qtyBase);
      if (!Number.isFinite(qty) || qty <= QTY_EPSILON) refuse(`${at}: the quantity must be more than zero.`);
      const lineSscc = sscc(l?.sscc, `${at} SSCC`);
      if (lineSscc && !bySscc.has(lineSscc)) {
        const pkg = { sscc: lineSscc, packType: null, parentSscc: null };
        bySscc.set(lineSscc, pkg); packages.push(pkg);
      }
      const productionDate = ymdOrNull(l?.productionDate, `${at} production date`);
      const bestBeforeDate = ymdOrNull(l?.bestBeforeDate, `${at} best-before date`);
      const expiryDate = ymdOrNull(l?.expiryDate, `${at} expiry date`);
      if (productionDate && bestBeforeDate && bestBeforeDate < productionDate) refuse(`${at}: best-before is before the production date.`);
      if (productionDate && expiryDate && expiryDate < productionDate) refuse(`${at}: expiry is before the production date.`);
      return {
        lineNo: i + 1, poLineId, itemId, qtyBase: roundQty(qty), sscc: lineSscc,
        supplierBatchNo: text(l?.supplierBatchNo, 64, `${at} supplier batch`),
        productionDate, bestBeforeDate, expiryDate,
      };
    });

    return { ok: true, value: {
      source, reference: text(input.reference, 64, "Reference"), shipDate, expectedDate,
      carrier: text(input.carrier, 64, "Carrier"), trackingNo: text(input.trackingNo, 64, "Tracking number"),
      notes: text(input.notes, 2000, "Notes"), packages, lines,
    } };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, error: e.message };
    throw e;
  }
}

/** Received while linked to a receipt (voiding the receipt clears the link); cancelled is the only stored state. */
export function deliveryState(row: { status: string | null; goodsReceiptId: string | null }): DeliveryState {
  if (row.status === "cancelled") return "cancelled";
  return row.goodsReceiptId ? "received" : "expected";
}

/** The SSCCs scanned at the dock set against the ones the delivery announced. */
export function matchSsccs(expected: string[], recorded: string[]) {
  const exp = new Set(expected);
  const rec = new Set(recorded);
  return {
    matched: [...exp].filter(s => rec.has(s)),
    missing: [...exp].filter(s => !rec.has(s)),
    unexpected: [...rec].filter(s => !exp.has(s)),
  };
}

/** An open PO line as Receiving sees it (po-open). */
export type OpenPoLine = {
  lineId: string; itemId: string; itemName: string; skuId?: string | null; baseUom: string | null;
  unitCostBase: number; remainingQty: number;
};
/** The receipt lines staged for ONE PO line: Receiving's DraftLine shape. */
export type PrefillDraft = { itemName: string; baseUom: string | null; qty: number; lines: Record<string, unknown>[] };

/**
 * Turn a delivery's lines into Receiving's staged lines, one draft per PO line
 * (several batches of one PO line become several receipt lines under it).
 * Quantities are what the supplier SAID: the receiver still counts and
 * corrects. A line whose PO line is no longer open is reported, not staged;
 * one announcing more than the PO line still expects is staged and named.
 * No lot number is sent, so the server assigns one as for a blank lot.
 */
export function prefillFromDelivery(
  lines: { poLineId: string | null; qtyBase: number; supplierBatchNo: string | null; productionDate: string | null; bestBeforeDate: string | null; expiryDate: string | null }[],
  poId: string, poLines: OpenPoLine[],
): { drafts: Record<string, PrefillDraft>; skipped: number; over: string[] } {
  const open = new Map(poLines.map(l => [l.lineId, l]));
  const drafts: Record<string, PrefillDraft> = {};
  let skipped = 0;
  for (const l of lines) {
    const pl = l.poLineId ? open.get(l.poLineId) : undefined;
    if (!pl) { skipped++; continue; }
    const d = drafts[pl.lineId] ?? (drafts[pl.lineId] = { itemName: pl.itemName, baseUom: pl.baseUom, qty: 0, lines: [] });
    d.qty = roundQty(d.qty + l.qtyBase);
    d.lines.push({
      itemId: pl.itemId, skuId: pl.skuId ?? null, poId, poLineId: pl.lineId, description: pl.itemName,
      qtyBase: l.qtyBase, unitCost: pl.unitCostBase, lotNo: null, expiryDate: l.expiryDate,
      supplierBatchNo: l.supplierBatchNo, productionDate: l.productionDate, bestBeforeDate: l.bestBeforeDate,
    });
  }
  // More announced than the order still expects: staged as announced, but named, so the receiver checks it.
  const over = Object.entries(drafts).filter(([id, d]) => d.qty - (open.get(id)!.remainingQty) > QTY_EPSILON).map(([, d]) => d.itemName);
  return { drafts, skipped, over };
}
