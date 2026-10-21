/**
 * Native tax engine — server-side resolution (sales-document refactor,
 * Phase 3b, 2026-10-21). Pure vocabulary and arithmetic live in
 * tax-engine.ts (client-safe); this file imports `db` and answers the one
 * question that file can't: "which of a tax_code's components are effective
 * on this document's date?" — same split as account-roles.ts /
 * account-roles-server.ts.
 */

import { db } from "@/db";
import { taxCodes, taxCodeComponents, taxComponents, taxAgencies } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { isTaxTreatment, type TaxCodeRates, type TaxComponentRate } from "./tax-engine";

/**
 * Resolve a set of tax_codes to the components effective for them on `asOf`
 * (a YYYY-MM-DD date — the document's own date, never "today": a backdated
 * document must use the rate that applied on ITS date, not whichever is
 * current now). A component outside its [effective_from, effective_to]
 * window is silently excluded — exactly how a rate change is meant to work,
 * not an error.
 *
 * A component's own sales/purchase account wins; absent, its agency's
 * liability account stands in. Both null means the caller must refuse the
 * posting rather than guess — see documents.ts's pushTax().
 */
export async function resolveTaxCodes(orgId: string, codeIds: string[], asOf: string): Promise<Map<string, TaxCodeRates>> {
  const out = new Map<string, TaxCodeRates>();
  const ids = [...new Set(codeIds.filter(Boolean))];
  if (!ids.length) return out;

  const codes = await db.select().from(taxCodes).where(and(eq(taxCodes.orgId, orgId), inArray(taxCodes.id, ids)));
  if (!codes.length) return out;

  const links = await db.select().from(taxCodeComponents)
    .where(and(eq(taxCodeComponents.orgId, orgId), inArray(taxCodeComponents.taxCodeId, codes.map(c => c.id))));
  const componentIds = [...new Set(links.map(l => l.componentId))];
  const components = componentIds.length
    ? await db.select().from(taxComponents).where(and(eq(taxComponents.orgId, orgId), inArray(taxComponents.id, componentIds)))
    : [];
  const agencyIds = [...new Set(components.map(c => c.agencyId))];
  const agencies = agencyIds.length
    ? await db.select().from(taxAgencies).where(and(eq(taxAgencies.orgId, orgId), inArray(taxAgencies.id, agencyIds)))
    : [];

  const componentById = new Map(components.map(c => [c.id, c]));
  const agencyById = new Map(agencies.map(a => [a.id, a]));

  for (const code of codes) {
    const resolved: TaxComponentRate[] = [];
    for (const link of links.filter(l => l.taxCodeId === code.id)) {
      const c = componentById.get(link.componentId);
      if (!c) continue;
      if (c.effectiveFrom > asOf) continue;                    // not yet effective on this date
      if (c.effectiveTo && c.effectiveTo < asOf) continue;      // superseded before this date
      const agency = agencyById.get(c.agencyId);
      resolved.push({
        componentId: c.id, name: c.name, rate: Number(c.rate), sequence: link.sequence,
        salesAccountId: c.salesAccountId ?? agency?.liabilityAccountId ?? null,
        purchaseAccountId: c.purchaseAccountId ?? agency?.liabilityAccountId ?? null,
      });
    }
    out.set(code.id, {
      id: code.id, name: code.name,
      treatment: isTaxTreatment(code.treatment) ? code.treatment : "standard",
      compound: code.compound, components: resolved,
    });
  }
  return out;
}
