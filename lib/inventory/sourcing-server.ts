/**
 * Server half of the sourcing policy — the database reads that feed the pure
 * rule in lib/inventory/sourcing.ts.
 *
 * Kept in its own module for the same reason lib/modules-server.ts is separate
 * from lib/modules.ts: this one imports `db`, and lib/inventory/sourcing.ts is
 * imported by client components (the Products register, the document form).
 * Importing db from a client component bundles server code into the browser.
 *
 * THIS is the enforcement point. The document form narrows its item picker to
 * the supplier's linked items, but that is help, not a control — a picker can
 * be bypassed by a direct API call, a mobile client, or the "Show all items"
 * escape. Posting is where the decision becomes a fact in the ledger, so it is
 * where the rule has to hold.
 */

import { db } from "@/db";
import { apItems, itemSupplierSkus, apSuppliers } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { sourcingViolations, SOURCING_ENFORCED_TYPES, type SourcingLine, type SourcingViolation } from "@/lib/inventory/sourcing";

/**
 * Every sourcing violation on a purchase document, or [] if it is clean.
 *
 * Returns rather than throws so each caller can raise its own error type —
 * postDocument speaks LedgerValidationError, createTradeDoc likewise, and this
 * module should not have to know which.
 */
export async function findSourcingViolations(
  orgId: string,
  type: string,
  supplierId: string | null | undefined,
  lines: SourcingLine[],
): Promise<SourcingViolation[]> {
  if (!SOURCING_ENFORCED_TYPES.has(type)) return [];

  const itemIds = [...new Set((lines ?? []).map(l => l?.itemId).filter(Boolean) as string[])];
  if (!itemIds.length) return [];

  // Org-scoped, so an item id from another tenant simply is not found and the
  // pure rule skips it — the document's own validation rejects it separately.
  const items = await db.select({ id: apItems.id, name: apItems.name, sourcingPolicy: apItems.sourcingPolicy })
    .from(apItems).where(and(eq(apItems.orgId, orgId), inArray(apItems.id, itemIds)));
  const itemMap = new Map(items.map(i => [i.id, i]));

  // No supplier on the document: every restricted item is unlinked by
  // definition, because there is nobody to be linked to. The caller's own
  // "Select a supplier" check usually fires first; this stays correct if the
  // order of those checks ever changes.
  if (!supplierId) return sourcingViolations(lines, itemMap, new Set(), null);

  const links = await db.select({ itemId: itemSupplierSkus.itemId }).from(itemSupplierSkus)
    .where(and(
      eq(itemSupplierSkus.orgId, orgId),
      eq(itemSupplierSkus.supplierId, supplierId),
      inArray(itemSupplierSkus.itemId, itemIds),
    ));
  const linked = new Set(links.map(l => l.itemId));

  // Only looked up when there is something to report, so the ordinary clean
  // document costs two queries rather than three.
  const pre = sourcingViolations(lines, itemMap, linked, null);
  if (!pre.length) return pre;

  const [supplier] = await db.select({ name: apSuppliers.displayName, name2: apSuppliers.name })
    .from(apSuppliers).where(and(eq(apSuppliers.id, supplierId), eq(apSuppliers.orgId, orgId))).limit(1);
  return sourcingViolations(lines, itemMap, linked, supplier?.name || supplier?.name2 || null);
}

/**
 * One message covering every violation, or null when the document is clean.
 * Listing them all matters: fixing a five-line order one refusal at a time is
 * five round trips through a form that clears itself.
 */
export async function sourcingErrorMessage(
  orgId: string,
  type: string,
  supplierId: string | null | undefined,
  lines: SourcingLine[],
): Promise<string | null> {
  const v = await findSourcingViolations(orgId, type, supplierId, lines);
  if (!v.length) return null;
  if (v.length === 1) return v[0].message;
  return `${v.length} items on this document are not linked to this supplier: ${v.map(x => x.itemName).join(", ")}. Link each on its Suppliers panel — with the supplier's unit, packaging and price — or set it to buy from any supplier.`;
}
