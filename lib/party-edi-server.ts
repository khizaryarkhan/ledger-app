/**
 * EDI identifiers on a party (customer or supplier): ISO country code and GLN
 * (migration 0139). Server-only (reads the org's country list).
 *
 * The columns live on `parties`; the customers / ap_suppliers views are not
 * recreated, so the routes write them directly after the view insert/update,
 * the same way lead_time_days is written (0114).
 */
import { db } from "@/db";
import { countries } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { countryCodeError } from "@/lib/countries";
import { glnError } from "@/lib/gs1";
import { resolveCountryCode } from "@/lib/address-fields";

/**
 * The parties columns a request changes, or an error. Only keys the body
 * mentions are returned, so an edit that touches none leaves both alone.
 * Validated BEFORE the caller writes anything.
 */
export async function partyEdiValues(orgId: string, b: any): Promise<{ values: { countryCode?: string | null; gln?: string | null } } | { error: string }> {
  const values: { countryCode?: string | null; gln?: string | null } = {};
  const touchesCountry = b?.countryCode !== undefined || b?.countryId !== undefined || b?.country !== undefined;
  if (touchesCountry) {
    const e = countryCodeError(b?.countryCode, "Country");
    if (e) return { error: e };
    let fromList: string | null = null;
    if (b?.countryId) {
      const [c] = await db.select({ isoCode: countries.isoCode, name: countries.name }).from(countries)
        .where(and(eq(countries.id, String(b.countryId)), eq(countries.orgId, orgId))).limit(1);
      fromList = c?.isoCode ?? resolveCountryCode({ name: c?.name ?? null });
    }
    values.countryCode = resolveCountryCode({ explicit: b?.countryCode, fromList, name: b?.country });
  }
  if (b?.gln !== undefined) {
    const e = glnError(b.gln);
    if (e) return { error: `GLN: ${e}` };
    values.gln = String(b.gln ?? "").replace(/[\s-]/g, "") || null;
  }
  return { values };
}
