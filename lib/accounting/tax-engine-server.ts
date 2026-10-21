/**
 * Native tax engine — server-side resolution (sales-document refactor,
 * Phase 3b, 2026-10-21). Pure vocabulary and arithmetic live in
 * tax-engine.ts (client-safe); this file imports `db` and answers the one
 * question that file can't: "which of a tax_code's components are effective
 * on this document's date?" — same split as account-roles.ts /
 * account-roles-server.ts.
 */

import { db } from "@/db";
import { taxCodes, taxCodeComponents, taxComponents, taxAgencies, accounts } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { isTaxTreatment, TAX_TREATMENTS, type TaxCodeRates, type TaxComponentRate, type TaxTreatment } from "./tax-engine";
import { accountTypeError, UNTRACKED_EXPENSE_TYPES, untrackedIncomeTypes } from "./account-roles";
import { isSyncedOrg } from "./account-roles-server";

/** Account types a tax agency's liability account may be — same type GRNI
 *  (the other "amount owed to someone external" role) already requires. */
export const AGENCY_LIABILITY_TYPES = ["Other Current Liability"] as const;
/** A component's sales account — reuses the untracked-item income rule
 *  (Phase 1); a tax component is never an "Other Charge"-style liability. */
export const COMPONENT_SALES_TYPES = untrackedIncomeTypes("Service");
export const COMPONENT_PURCHASE_TYPES = UNTRACKED_EXPENSE_TYPES;

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

// ── Admin CRUD (Phase 3c) ───────────────────────────────────────────────────
// No complex remap/reclass flow here, unlike posting groups: a tax code has
// no balance of its own to strand — it's a calculation rule, not a stock
// account. Deleting a component/agency still referenced is refused outright
// rather than offered a migration, since nothing is "in" one to move.

const ADMIN_ERR = "Admins only";

async function orgAccounts(orgId: string) {
  return db.select({ id: accounts.id, name: accounts.name, code: accounts.code, type: accounts.type, status: accounts.status, isHeader: accounts.isHeader })
    .from(accounts).where(eq(accounts.orgId, orgId));
}

export type TaxSetup = Awaited<ReturnType<typeof listTaxSetup>>;

/** Everything the admin screen needs in one call, mirroring posting-groups'
 *  GET shape: raw masters, the accounts they may be mapped to, and whether
 *  this org's chart is synced (the screen hides itself entirely for a synced
 *  org — its tax behaviour comes from QBO/Xero, not this). */
export async function listTaxSetup(orgId: string) {
  const [agencies, components, codes, links, synced, accts] = await Promise.all([
    db.select().from(taxAgencies).where(eq(taxAgencies.orgId, orgId)),
    db.select().from(taxComponents).where(eq(taxComponents.orgId, orgId)),
    db.select().from(taxCodes).where(eq(taxCodes.orgId, orgId)),
    db.select().from(taxCodeComponents).where(eq(taxCodeComponents.orgId, orgId)),
    isSyncedOrg(orgId),
    orgAccounts(orgId),
  ]);
  const codesOut = codes
    .map(c => ({
      ...c,
      components: links.filter(l => l.taxCodeId === c.id)
        .map(l => ({ linkId: l.id, componentId: l.componentId, sequence: l.sequence }))
        .sort((a, b) => a.sequence - b.sequence),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return {
    synced,
    agencies: agencies.sort((a, b) => a.name.localeCompare(b.name)),
    components: components.sort((a, b) => a.name.localeCompare(b.name)),
    codes: codesOut,
    accounts: accts,
  };
}

export type CreateTaxAgencyInput = { name: string; country?: string | null; liabilityAccountId?: string | null; filingFrequency?: string | null };

export async function createTaxAgency(orgId: string, input: CreateTaxAgencyInput): Promise<{ error: string } | { id: string }> {
  const name = input.name.trim();
  if (!name) return { error: "Give the agency a name." };
  if (input.liabilityAccountId) {
    const [acct] = await orgAccounts(orgId).then(a => a.filter(x => x.id === input.liabilityAccountId));
    const why = accountTypeError("Liability account", AGENCY_LIABILITY_TYPES, acct);
    if (why) return { error: why };
  }
  const [row] = await db.insert(taxAgencies).values({
    orgId, name, country: input.country?.trim().toUpperCase() || null,
    liabilityAccountId: input.liabilityAccountId || null, filingFrequency: input.filingFrequency?.trim() || null,
  }).returning({ id: taxAgencies.id });
  return { id: row.id };
}

export type CreateTaxComponentInput = {
  agencyId: string; name: string; rate: number;
  salesAccountId?: string | null; purchaseAccountId?: string | null; effectiveFrom: string; effectiveTo?: string | null;
};

export async function createTaxComponent(orgId: string, input: CreateTaxComponentInput): Promise<{ error: string } | { id: string }> {
  const name = input.name.trim();
  if (!name) return { error: "Give the component a name." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveFrom)) return { error: "A valid effective-from date is required." };
  if (input.effectiveTo && !/^\d{4}-\d{2}-\d{2}$/.test(input.effectiveTo)) return { error: "Effective-to must be a valid date." };
  if (input.effectiveTo && input.effectiveTo < input.effectiveFrom) return { error: "Effective-to can't be before effective-from." };
  if (!Number.isFinite(input.rate) || input.rate < 0 || input.rate > 100) return { error: "Rate must be between 0 and 100." };
  const [agency] = await db.select({ id: taxAgencies.id }).from(taxAgencies).where(and(eq(taxAgencies.id, input.agencyId), eq(taxAgencies.orgId, orgId))).limit(1);
  if (!agency) return { error: "That agency doesn't exist in this organisation." };
  const accts = await orgAccounts(orgId);
  if (input.salesAccountId) {
    const why = accountTypeError("Sales account", COMPONENT_SALES_TYPES, accts.find(a => a.id === input.salesAccountId));
    if (why) return { error: why };
  }
  if (input.purchaseAccountId) {
    const why = accountTypeError("Purchase account", COMPONENT_PURCHASE_TYPES, accts.find(a => a.id === input.purchaseAccountId));
    if (why) return { error: why };
  }
  const [row] = await db.insert(taxComponents).values({
    orgId, agencyId: input.agencyId, name, rate: input.rate.toString(),
    salesAccountId: input.salesAccountId || null, purchaseAccountId: input.purchaseAccountId || null,
    effectiveFrom: input.effectiveFrom, effectiveTo: input.effectiveTo || null,
  }).returning({ id: taxComponents.id });
  return { id: row.id };
}

export type CreateTaxCodeInput = {
  name: string; treatment: string; compound?: boolean;
  components: { componentId: string; sequence?: number }[];
};

async function validateCodeInput(orgId: string, input: CreateTaxCodeInput): Promise<{ error: string } | { treatment: TaxTreatment }> {
  const name = input.name.trim();
  if (!name) return { error: "Give the tax code a name." };
  if (!isTaxTreatment(input.treatment)) return { error: `Treatment must be one of ${TAX_TREATMENTS.join(", ")}.` };
  const ids = [...new Set(input.components.map(c => c.componentId))];
  if (ids.length) {
    const rows = await db.select({ id: taxComponents.id }).from(taxComponents).where(and(eq(taxComponents.orgId, orgId), inArray(taxComponents.id, ids)));
    if (rows.length !== ids.length) return { error: "One of the selected components doesn't exist in this organisation." };
  }
  return { treatment: input.treatment };
}

export async function createTaxCode(orgId: string, input: CreateTaxCodeInput): Promise<{ error: string } | { id: string }> {
  const v = await validateCodeInput(orgId, input);
  if ("error" in v) return v;
  const [row] = await db.insert(taxCodes).values({
    orgId, name: input.name.trim(), treatment: v.treatment, compound: !!input.compound,
  }).returning({ id: taxCodes.id });
  if (input.components.length) {
    await db.insert(taxCodeComponents).values(input.components.map((c, i) => ({
      orgId, taxCodeId: row.id, componentId: c.componentId, sequence: c.sequence ?? i,
    })));
  }
  return { id: row.id };
}

/** Full replace of a code's name/treatment/compound/component list — simpler
 *  and safer than a diff, since there's no balance riding on the old list. */
export async function updateTaxCode(orgId: string, codeId: string, input: CreateTaxCodeInput): Promise<{ error: string } | { updated: true }> {
  const [existing] = await db.select({ id: taxCodes.id }).from(taxCodes).where(and(eq(taxCodes.id, codeId), eq(taxCodes.orgId, orgId))).limit(1);
  if (!existing) return { error: "Tax code not found." };
  const v = await validateCodeInput(orgId, input);
  if ("error" in v) return v;
  await db.update(taxCodes).set({ name: input.name.trim(), treatment: v.treatment, compound: !!input.compound, updatedAt: new Date() })
    .where(eq(taxCodes.id, codeId));
  await db.delete(taxCodeComponents).where(and(eq(taxCodeComponents.taxCodeId, codeId), eq(taxCodeComponents.orgId, orgId)));
  if (input.components.length) {
    await db.insert(taxCodeComponents).values(input.components.map((c, i) => ({
      orgId, taxCodeId: codeId, componentId: c.componentId, sequence: c.sequence ?? i,
    })));
  }
  return { updated: true };
}

export async function deleteTaxCode(orgId: string, codeId: string): Promise<{ error: string } | { deleted: true }> {
  const [row] = await db.select({ id: taxCodes.id }).from(taxCodes).where(and(eq(taxCodes.id, codeId), eq(taxCodes.orgId, orgId))).limit(1);
  if (!row) return { error: "Tax code not found." };
  await db.delete(taxCodeComponents).where(and(eq(taxCodeComponents.taxCodeId, codeId), eq(taxCodeComponents.orgId, orgId)));
  await db.delete(taxCodes).where(eq(taxCodes.id, codeId));
  return { deleted: true };
}

export async function deleteTaxComponent(orgId: string, componentId: string): Promise<{ error: string } | { deleted: true }> {
  const [row] = await db.select({ id: taxComponents.id }).from(taxComponents).where(and(eq(taxComponents.id, componentId), eq(taxComponents.orgId, orgId))).limit(1);
  if (!row) return { error: "Component not found." };
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(taxCodeComponents).where(and(eq(taxCodeComponents.componentId, componentId), eq(taxCodeComponents.orgId, orgId)));
  if (Number(n) > 0) return { error: `${n} tax code${Number(n) === 1 ? "" : "s"} use this component — remove it from ${Number(n) === 1 ? "that code" : "those codes"} first.` };
  await db.delete(taxComponents).where(eq(taxComponents.id, componentId));
  return { deleted: true };
}

export async function deleteTaxAgency(orgId: string, agencyId: string): Promise<{ error: string } | { deleted: true }> {
  const [row] = await db.select({ id: taxAgencies.id }).from(taxAgencies).where(and(eq(taxAgencies.id, agencyId), eq(taxAgencies.orgId, orgId))).limit(1);
  if (!row) return { error: "Agency not found." };
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(taxComponents).where(and(eq(taxComponents.agencyId, agencyId), eq(taxComponents.orgId, orgId)));
  if (Number(n) > 0) return { error: `${n} tax component${Number(n) === 1 ? "" : "s"} use this agency — remove ${Number(n) === 1 ? "it" : "them"} first.` };
  await db.delete(taxAgencies).where(eq(taxAgencies.id, agencyId));
  return { deleted: true };
}
