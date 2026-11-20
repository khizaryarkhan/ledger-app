/**
 * Match a pasted customer part-number list to our items and SKUs, then (when asked) save it. A line names ONE of our
 * items by exact name (case and spacing ignored), or ONE sales SKU by its code or name. Two matches, or none, is an
 * error for that line: a part number attached to the wrong item sends their orders to the wrong product. Saving goes
 * through setCustomerPartNumber, so every rule there (customer, SKU levels, clashes) still applies, one line at a time.
 */

import { db } from "@/db";
import { apItems, itemSkus } from "@/db/schema";
import { eq } from "drizzle-orm";
import { setCustomerPartNumber, partNumberErrorMessage } from "@/lib/inventory/part-numbers-server";
import { type BulkRow } from "@/lib/inventory/part-numbers-bulk";

const norm = (s: string | null | undefined) => String(s ?? "").trim().replace(/\s+/g, " ").toLowerCase();

export type BulkResult = { line: number; ref: string; code: string; level: string; ok: boolean; message: string; itemId?: string; skuId?: string | null; target?: string };

export async function matchBulkRows(orgId: string, rows: BulkRow[]): Promise<BulkResult[]> {
  const items = await db.select({ id: apItems.id, name: apItems.name }).from(apItems).where(eq(apItems.orgId, orgId));
  const skus = await db.select({ id: itemSkus.id, itemId: itemSkus.itemId, name: itemSkus.skuName, code: itemSkus.skuCode }).from(itemSkus).where(eq(itemSkus.orgId, orgId));
  const byItem = new Map<string, typeof items>();
  for (const i of items) { const k = norm(i.name); byItem.set(k, [...(byItem.get(k) ?? []), i]); }
  const bySku = new Map<string, typeof skus>();
  for (const s of skus) for (const k of new Set([norm(s.code), norm(s.name)].filter(Boolean))) bySku.set(k, [...(bySku.get(k) ?? []), s]);
  const itemName = new Map(items.map(i => [i.id, i.name]));

  return rows.map<BulkResult>(r => {
    const base = { line: r.line, ref: r.ref, code: r.code, level: r.level };
    const k = norm(r.ref);
    const hi = byItem.get(k) ?? [], hs = bySku.get(k) ?? [];
    if (hi.length + hs.length === 0) return { ...base, ok: false, message: "No item or SKU with that name or code." };
    if (hi.length + hs.length > 1) return { ...base, ok: false, message: "More than one item or SKU has that name. Use the SKU code." };
    if (hi.length === 1) {
      if (r.level !== "unit") return { ...base, ok: false, message: "A pack level needs a sales SKU. Use the SKU's code instead of the item name." };
      return { ...base, ok: true, message: "", itemId: hi[0].id, skuId: null, target: hi[0].name ?? "" };
    }
    const s = hs[0];
    return { ...base, ok: true, message: "", itemId: s.itemId, skuId: s.id, target: `${itemName.get(s.itemId) ?? "Item"} · ${s.name || s.code || "SKU"}` };
  });
}

/** Save every matched line; each line reports its own outcome and one failure never stops the rest. */
export async function saveBulkRows(orgId: string, customerId: string, results: BulkResult[]): Promise<BulkResult[]> {
  const out: BulkResult[] = [];
  for (const r of results) {
    if (!r.ok) { out.push(r); continue; }
    try {
      await setCustomerPartNumber(orgId, { customerId, itemId: r.itemId!, itemSkuId: r.skuId ?? null, packLevel: r.level, code: r.code });
      out.push({ ...r, message: "Saved" });
    } catch (e) {
      const m = partNumberErrorMessage(e);
      if (!m) throw e;
      out.push({ ...r, ok: false, message: m });
    }
  }
  return out;
}
