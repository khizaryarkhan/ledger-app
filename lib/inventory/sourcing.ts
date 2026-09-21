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
