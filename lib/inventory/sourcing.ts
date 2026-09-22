/**
 * Sourcing policy — where an item may be bought from.
 *
 * Two objects, deliberately kept apart, which is how every mature system models
 * this (SAP purchasing info record vs source list; Oracle supplier-item
 * attributes vs ASL status):
 *
 *   item_supplier_skus  — COMMERCIAL: what this vendor charges, in what unit,
 *                         in what packs, how long they take. Never restrictive
 *                         by itself.
 *   ap_items.sourcing_policy — AUTHORISATION: whether the link is required at
 *                         all. A property of the ITEM, because "anyone can
 *                         supply this" cannot be expressed by a link row: such
 *                         a row would have to carry the supplier_id it is
 *                         simultaneously claiming not to have.
 *
 * `open` and "no link yet" are different facts and the model keeps them
 * distinct. `open` says anyone may supply it. A missing link on a `restricted`
 * item says we have not decided yet — which is a gap to close, not a licence.
 */

import { kindOf } from "@/lib/inventory/item-kinds";

export type SourcingPolicy = "restricted" | "open";

export type SourcingMeta = {
  policy: SourcingPolicy;
  label: string;
  blurb: string;
  /** May this item be ordered from a supplier it is not linked to? */
  allowsAnySupplier: boolean;
  /** May a supplier link for this item carry pack configuration? */
  allowsPackConfiguration: boolean;
};

export const SOURCING_POLICIES: Record<SourcingPolicy, SourcingMeta> = {
  restricted: {
    policy: "restricted",
    label: "Linked suppliers only",
    blurb: "Bought from the suppliers linked below, in their units and packs.",
    allowsAnySupplier: false,
    allowsPackConfiguration: true,
  },
  open: {
    // Pack configuration is withheld rather than merely unused: a pack
    // describes how ONE named vendor boxes the item, and an open item has no
    // such vendor to name. It is ordered in its own base UoM at factor 1 —
    // which is exactly the fallback orderOptions() already seeds.
    policy: "open",
    label: "Any supplier",
    blurb: "Bought from anyone, in the item's own unit. No pack configuration.",
    allowsAnySupplier: true,
    allowsPackConfiguration: false,
  },
};

/** Normalise any stored/legacy value. Anything unrecognised is restrictive. */
export function sourcingOf(policy?: string | null): SourcingMeta {
  const p = (policy ?? "").trim();
  return p === "open" ? SOURCING_POLICIES.open : SOURCING_POLICIES.restricted;
}

/**
 * The policy a NEW item starts with when nobody chose one. Same rule 0089
 * applied to existing items: stock (tracked) kinds are restricted to their
 * linked suppliers; Service and Non-Inventory are open, because
 * pack-configuring "Consulting" is meaningless. Without this, every item
 * created after 0089 took the column default, `restricted`, so the first
 * Bill for a new Service item was refused.
 */
export const defaultSourcingPolicy = (productType?: string | null): SourcingPolicy =>
  kindOf(productType).tracked ? "restricted" : "open";

export const allowsAnySupplier = (policy?: string | null) => sourcingOf(policy).allowsAnySupplier;
export const allowsPackConfiguration = (policy?: string | null) => sourcingOf(policy).allowsPackConfiguration;

/**
 * Base units per one supplier UoM, applied to a stored price.
 *
 * A link's `unit_price` is quoted per ONE SUPPLIER UoM because that is how the
 * vendor's own price list reads, and a record you cannot check against the
 * price list is a record nobody maintains. A document line, though, charges per
 * ORDER unit — which changes with the pack level — so the two are reconciled
 * through the item's base unit:
 *
 *     price per base unit  = unit_price / base-units-per-supplier-unit
 *     rate for a pack      = price per base unit * units_per_order_unit
 *
 * Yarn at 480/kg with a 25kg bag and a 20-bag pallet therefore prices as
 * 480 per kg, 12,000 per bag, 240,000 per pallet — one stored number, every
 * level consistent, and no level rounded before it is multiplied.
 */
export function pricePerBaseUnit(unitPrice: any, baseUnitsPerSupplierUnit: number): number | null {
  const p = Number(unitPrice);
  if (!isFinite(p) || p <= 0) return null;
  if (!isFinite(baseUnitsPerSupplierUnit) || baseUnitsPerSupplierUnit <= 0) return null;
  return p / baseUnitsPerSupplierUnit;
}

// ── Enforcement ──────────────────────────────────────────────────────────────

/**
 * Which purchase documents the policy binds.
 *
 * It binds every document that ACQUIRES goods, not only the Purchase Order.
 * CLAUDE.md is explicit that each procure-to-pay step is bypassable — a Bill
 * with tracked items posts Dr Inventory and creates lots with no PO anywhere —
 * so a rule that only covered POs would be advisory: the first person in a
 * hurry posts a Bill instead and the discipline is gone.
 *
 * VendorCredit is deliberately absent. It is a RETURN, not a purchase: it
 * reduces what is owed for goods already received, and blocking it would strand
 * a legitimate return when a supplier link is later tidied away. Job work is
 * absent for a different reason — material sent to a knitter was never bought
 * from them, so there is nothing to authorise.
 */
export const SOURCING_ENFORCED_TYPES = new Set(["PurchaseOrder", "Bill", "Expense"]);

export type SourcingLine = { itemId?: string | null; description?: string | null };
export type SourcingItem = { id: string; name?: string | null; sourcingPolicy?: string | null; productType?: string | null };

export type SourcingViolation = { itemId: string; itemName: string; message: string };

/**
 * Which lines of a purchase document name an item this supplier may not supply.
 *
 * Pure, and separate from the query that feeds it, so the rule can be proven
 * without a database — `linkedItemIds` is simply "the items this supplier is
 * linked to". Same split as lib/modules.ts / lib/modules-server.ts.
 *
 * Absence of a link on a `restricted` item is a real finding, but note what it
 * is NOT: evidence of wrongdoing. It means the sourcing decision has not been
 * recorded, which is why the message says how to record it rather than simply
 * refusing.
 */
export function sourcingViolations(
  lines: SourcingLine[],
  items: Map<string, SourcingItem>,
  linkedItemIds: Set<string>,
  supplierName?: string | null,
): SourcingViolation[] {
  const who = supplierName?.trim() || "this supplier";
  const out: SourcingViolation[] = [];
  const seen = new Set<string>();
  for (const l of lines ?? []) {
    const itemId = l?.itemId;
    if (!itemId || seen.has(itemId)) continue;
    const item = items.get(itemId);
    // An item we cannot see is not one we can judge; the document's own
    // validation deals with a bad id.
    if (!item) continue;
    const itemName = item.name?.trim() || "This item";

    // A kind that cannot be bought at all fails first, and says so. Work in
    // Progress is tracked but neither bought nor sold — it has no Suppliers
    // panel and never will — so the ordinary "link it to this supplier"
    // message would send the buyer looking for a control that does not exist.
    const kind = kindOf(item.productType);
    if (!kind.buyable) {
      seen.add(itemId);
      out.push({
        itemId, itemName,
        message: `${itemName} is a ${kind.label} — it cannot be purchased. ${kind.producible ? "It is created by a production build, not bought." : "Change its type if you do buy it."}`,
      });
      continue;
    }

    if (allowsAnySupplier(item.sourcingPolicy)) continue;
    if (linkedItemIds.has(itemId)) continue;
    seen.add(itemId);
    out.push({
      itemId,
      itemName,
      message: `${itemName} is not linked to ${who}. Link it on the item's Suppliers panel — with their unit, packaging and price — or set the item to "${SOURCING_POLICIES.open.label}" if anyone may supply it.`,
    });
  }
  return out;
}
