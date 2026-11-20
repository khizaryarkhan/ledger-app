/**
 * Structured address + EDI identifiers, validated once (2026-11-20, migration 0139).
 * Pure and client-safe: the location routes use it now, and any later
 * address-bearing record (a customer ship-to) uses the same rules.
 *
 * An EDI document names a place by a structured address with an ISO 3166-1
 * country code, and optionally a GS1 GLN. Free text cannot be split back into
 * street / city / postcode reliably, which is why these are separate fields.
 */

import { countryCodeError, normaliseCountryCode, countryCodeFromName } from "@/lib/countries";
import { glnError } from "@/lib/gs1";

/** Max lengths, matching the columns in migration 0139 (and organisations / parties). */
export const ADDRESS_LIMITS = {
  addressStreet: 255, addressLine2: 255, addressCity: 128, addressState: 128, addressPostcode: 32,
} as const;

export type AddressField = keyof typeof ADDRESS_LIMITS | "countryCode" | "gln";
export type AddressInput = Partial<Record<AddressField, unknown>>;
export type AddressValues = Partial<Record<AddressField, string | null>>;

const LABELS: Record<AddressField, string> = {
  addressStreet: "Street", addressLine2: "Address line 2", addressCity: "City", addressState: "State / province",
  addressPostcode: "Postal code", countryCode: "Country", gln: "GLN",
};

/**
 * The address columns to write, from a request body. A field that is absent
 * (undefined) is left out so an edit that does not mention it leaves it alone;
 * an empty one clears it. Returns the first problem as a message instead.
 */
export function addressValues(b: AddressInput | null | undefined): { values: AddressValues } | { error: string } {
  const values: AddressValues = {};
  for (const [k, limit] of Object.entries(ADDRESS_LIMITS) as [keyof typeof ADDRESS_LIMITS, number][]) {
    const raw = b?.[k];
    if (raw === undefined) continue;
    const v = raw === null ? "" : String(raw).trim();
    if (v.length > limit) return { error: `${LABELS[k]} must be ${limit} characters or fewer.` };
    values[k] = v || null;
  }
  if (b?.countryCode !== undefined) {
    const e = countryCodeError(b.countryCode, LABELS.countryCode);
    if (e) return { error: e };
    values.countryCode = normaliseCountryCode(b.countryCode == null ? null : String(b.countryCode));
  }
  if (b?.gln !== undefined) {
    const e = glnError(b.gln);
    if (e) return { error: `GLN: ${e}` };
    const g = String(b.gln ?? "").replace(/[\s-]/g, "");
    values.gln = g || null;
  }
  return { values };
}

/** True when an address has what an EDI document needs to name the place: street, city and country code. */
export function isAddressComplete(a: AddressValues): boolean {
  return !!(a.addressStreet && a.addressCity && a.countryCode);
}

/**
 * The ISO country code for a party's address, in a fixed order so it never
 * depends on which screen sent the update:
 *   1. a code the user picked explicitly (already validated),
 *   2. the ISO code of the org-list country the party points at,
 *   3. an exact match on the country NAME (lib/countries.ts countryCodeFromName).
 * A name that matches nothing yields null: the gap stays visible instead of
 * becoming a wrong country on a partner's document.
 */
export function resolveCountryCode(opts: { explicit?: string | null; fromList?: string | null; name?: string | null }): string | null {
  return normaliseCountryCode(opts.explicit) ?? normaliseCountryCode(opts.fromList) ?? countryCodeFromName(opts.name);
}
