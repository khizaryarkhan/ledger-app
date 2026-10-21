import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Regression for a bug caught before it shipped (Phase 3b, 2026-10-21): the
 * first version of withTax() in lib/accounting/documents.ts branched native
 * vs synced tax calculation on isSyncedOrg(orgId) — the org's CHART sync
 * status. That's wrong: ap_tax_rates holds `source: 'native'` rows that
 * NATIVE orgs' EXISTING documents already depend on today (confirmed by
 * investigation — it's one shared tax-rate table for every org, not a
 * synced-only mirror). Branching on chart sync status would have silently
 * resolved every native org's real taxRateId against the brand-new, empty
 * tax_codes table instead — zero tax on every invoice/bill the moment this
 * shipped, with no error, because resolveTaxCodes() just returns nothing for
 * an id it doesn't recognise.
 *
 * The fix: the native engine is opt-in per LINE via a new `taxCodeId` field,
 * never a chart-sync-status branch. `taxRateId` (what every existing document
 * uses) must keep resolving through ap_tax_rates regardless of org type,
 * until a future UI actually starts sending taxCodeId.
 */
describe("tax engine wiring never branches on chart sync status", () => {
  it("withTax() has no isSyncedOrg() check", () => {
    const src = read("lib/accounting/documents.ts");
    const withTaxBody = src.slice(src.indexOf("async function withTax("), src.indexOf("\nconst seriesFor"));
    expect(withTaxBody).not.toMatch(/isSyncedOrg/);
  });

  it("the native tax engine is reached only through a per-line taxCodeId, never taxRateId", () => {
    const src = read("lib/accounting/documents.ts");
    const withTaxBody = src.slice(src.indexOf("async function withTax("), src.indexOf("\nconst seriesFor"));
    expect(withTaxBody).toMatch(/if \(l\.taxCodeId\)/);
    // The flat ap_tax_rates branch must still be keyed on taxRateId, unconditionally.
    expect(withTaxBody).toMatch(/l\.taxRateId \? \(rateById\.get\(l\.taxRateId\)/);
  });

  it("DocLineInput's taxCodeId is documented as opt-in, not a replacement for taxRateId", () => {
    const src = read("lib/accounting/documents.ts");
    expect(src).toMatch(/taxCodeId\?: string \| null;/);
  });
});
