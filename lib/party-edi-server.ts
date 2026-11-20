/**
 * EDI identifiers on a party (customer or supplier): ISO country code and GLN
 * (migration 0139). Server-only (reads the org's country list).
 *
 * The columns live on `parties`; the customers / ap_suppliers views are not
 * recreated, so the routes write them directly after the view insert/update,
 * the same way lead_time_days is written (0114).
 */
import { db } from "@/db";
import { countries, parties } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { countryCodeError } from "@/lib/countries";
import { glnError } from "@/lib/gs1";
import { resolveCountryCode } from "@/lib/address-fields";
import { termsValues, type TermsValues } from "@/lib/party-terms";

/**
 * The parties columns a request changes, or an error. Only keys the body
 * mentions are returned, so an edit that touches none leaves both alone.
 * Validated BEFORE the caller writes anything.
 *
 * Also the trading terms (0142: our account number, early-payment discount,
 * Incoterm + place), judged as pairs against what the party will hold after
 * the write: `partyId` (an edit) reads the current values; a create has none,
 * and its payment terms default to 30 days like the column.
 */
type EdiValues = { countryCode?: string | null; gln?: string | null } & TermsValues;
export async function partyEdiValues(orgId: string, b: any, partyId?: string): Promise<{ values: EdiValues } | { error: string }> {
  const values: EdiValues = {};
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
  let current: any = {};
  if (partyId) {
    [current = {}] = await db.select({ paymentTerms: parties.paymentTerms, discountPercent: parties.discountPercent, discountDays: parties.discountDays, incoterm: parties.incoterm, incotermPlace: parties.incotermPlace })
      .from(parties).where(and(eq(parties.id, partyId), eq(parties.orgId, orgId))).limit(1);
  }
  const net = b?.paymentTerms !== undefined && Number.isFinite(Number(b.paymentTerms)) ? Number(b.paymentTerms) : (partyId ? current.paymentTerms : 30);
  const t = termsValues(b, { ...current, paymentTermsDays: net });
  if ("error" in t) return t;
  Object.assign(values, t.values);
  return { values };
}
