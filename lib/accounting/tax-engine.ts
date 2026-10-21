/**
 * Native tax engine — pure calculation (sales-document refactor, Phase 3,
 * 2026-10-21). Client-safe (no `db` import), same split as account-roles.ts/
 * account-roles-server.ts: this file is the vocabulary and the arithmetic;
 * a server module (not built yet — Phase 3b wires this into
 * lib/accounting/documents.ts) resolves which tax_components are effective
 * for a tax_code on a given date and hands the result to these functions.
 *
 * A TaxCodeRates is what the resolver produces: a tax_code's components,
 * already picked for the document's date, already sorted by sequence. This
 * module never touches the database and never decides which component
 * version applies — it only computes amounts from whatever rates it's given.
 */

export const TAX_TREATMENTS = [
  "standard", "reduced", "zero_rated", "exempt", "out_of_scope", "reverse_charge", "export",
] as const;
export type TaxTreatment = typeof TAX_TREATMENTS[number];

export type TaxTreatmentMeta = {
  treatment: TaxTreatment;
  label: string;
  /** Whether this treatment actually charges the computed tax on the document,
   *  or zeroes it (the components still exist and still compute a notional
   *  amount — see LineTaxResult.notionalTotal — for reporting/self-assessment,
   *  but nothing is collected from the customer or owed to the supplier). */
  chargesTax: boolean;
  /** Required wording the PDF must print when this treatment is used, if any. */
  legalWording?: string;
};

export const TAX_TREATMENT_META: Record<TaxTreatment, TaxTreatmentMeta> = {
  standard:       { treatment: "standard",       label: "Standard rate",  chargesTax: true },
  reduced:        { treatment: "reduced",        label: "Reduced rate",   chargesTax: true },
  zero_rated:     { treatment: "zero_rated",     label: "Zero-rated",     chargesTax: false },
  exempt:         { treatment: "exempt",         label: "Exempt",         chargesTax: false },
  out_of_scope:   { treatment: "out_of_scope",   label: "Out of scope",   chargesTax: false },
  export:         { treatment: "export",         label: "Export",        chargesTax: false },
  reverse_charge: {
    treatment: "reverse_charge", label: "Reverse charge", chargesTax: false,
    legalWording: "Reverse charge: the recipient is required to account for the tax due on this supply.",
  },
};

export const isTaxTreatment = (v: unknown): v is TaxTreatment =>
  typeof v === "string" && (TAX_TREATMENTS as readonly string[]).includes(v);

/** One component's rate, already resolved for the document's date. */
export type TaxComponentRate = {
  componentId: string;
  name: string;
  rate: number;               // percentage, e.g. 23 for 23%
  sequence: number;           // compound calculation order
  salesAccountId: string | null;
  purchaseAccountId: string | null;
};

/** A tax code with its components already resolved — what the resolver hands in. */
export type TaxCodeRates = {
  id: string;
  name: string;
  treatment: TaxTreatment;
  /** false (default): every component computes on the same net — a split tax
   *  like India's CGST+SGST. true: each component computes on top of the
   *  running total so far (net + every earlier component's amount). */
  compound: boolean;
  components: TaxComponentRate[];
};

export type PricingMode = "exclusive" | "inclusive";

export type TaxComponentAmount = {
  componentId: string;
  name: string;
  rate: number;
  /** Rounded to 2dp — what actually posts/displays. */
  amount: number;
  /** Unrounded — carried so document-level "per document" rounding can sum
   *  exact amounts across every line before rounding once per component. */
  rawAmount: number;
  accountId: string | null;
};

export type LineTaxResult = {
  /** The taxable base, exclusive of tax, rounded to 2dp. */
  net: number;
  /** net + taxTotal. */
  gross: number;
  /** What the treatment actually charges — empty/zeroed for a treatment whose
   *  chargesTax is false. Accounts come from the component's sales/purchase
   *  account, resolved by `isSale`. */
  componentAmounts: TaxComponentAmount[];
  taxTotal: number;
  /** What the components compute regardless of treatment — for reverse-charge
   *  self-assessment and tax-return reporting, never posted or shown as owed
   *  on the document itself. */
  notionalComponentAmounts: TaxComponentAmount[];
  notionalTotal: number;
};

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Components in calculation order — compound codes must run sequence-first. */
function orderedComponents(components: TaxComponentRate[]): TaxComponentRate[] {
  return [...components].sort((a, b) => a.sequence - b.sequence);
}

/**
 * The multiplier net*(X) = gross, used both to compute tax forward from a net
 * amount and to back a net amount out of a tax-inclusive gross amount.
 *   - Non-compound: every component applies to the same net, so the combined
 *     rate is just their sum — "23%" from 18%+5% behaves like one rate.
 *   - Compound: each component applies to net PLUS every earlier component's
 *     amount, so the combined effect is the product of each step, not the sum.
 */
function grossMultiplier(components: TaxComponentRate[], compound: boolean): number {
  if (!components.length) return 1;
  if (compound) return orderedComponents(components).reduce((m, c) => m * (1 + c.rate / 100), 1);
  const sumRate = components.reduce((s, c) => s + c.rate, 0);
  return 1 + sumRate / 100;
}

/** Net amount implied by a tax-inclusive gross amount. */
function netFromGross(gross: number, components: TaxComponentRate[], compound: boolean): number {
  const mult = grossMultiplier(components, compound);
  return mult === 0 ? gross : gross / mult;
}

/** Per-component amounts on a given net base, in calculation order. */
function computeComponents(net: number, components: TaxComponentRate[], compound: boolean, isSale: boolean): TaxComponentAmount[] {
  let runningBase = net;
  const out: TaxComponentAmount[] = [];
  for (const c of orderedComponents(components)) {
    const rawAmount = runningBase * (c.rate / 100);
    out.push({
      componentId: c.componentId, name: c.name, rate: c.rate,
      amount: round2(rawAmount), rawAmount,
      accountId: isSale ? c.salesAccountId : c.purchaseAccountId,
    });
    if (compound) runningBase += rawAmount;
  }
  return out;
}

const zeroed = (amounts: TaxComponentAmount[]): TaxComponentAmount[] =>
  amounts.map(c => ({ ...c, amount: 0, rawAmount: 0 }));

/**
 * Calculate one line's tax. `amount` is the entered line amount — net if
 * `pricing` is "exclusive", gross (tax-inclusive) if "inclusive". Returns both
 * what's actually charged (per the code's treatment) and the notional amount
 * the components compute regardless, for reverse-charge reporting.
 */
export function calcLineTax(amount: number, pricing: PricingMode, code: TaxCodeRates | null, isSale: boolean): LineTaxResult {
  if (!code || !code.components.length) {
    const net = round2(amount);
    return { net, gross: net, componentAmounts: [], taxTotal: 0, notionalComponentAmounts: [], notionalTotal: 0 };
  }
  const net = pricing === "inclusive" ? round2(netFromGross(amount, code.components, code.compound)) : round2(amount);
  const notional = computeComponents(net, code.components, code.compound, isSale);
  const notionalTotal = round2(notional.reduce((s, c) => s + c.rawAmount, 0));
  const meta = TAX_TREATMENT_META[code.treatment];
  const componentAmounts = meta.chargesTax ? notional : zeroed(notional);
  const taxTotal = meta.chargesTax ? notionalTotal : 0;
  return { net, gross: round2(net + taxTotal), componentAmounts, taxTotal, notionalComponentAmounts: notional, notionalTotal };
}

export type RoundingMode = "perLine" | "perDocument";

export type DocumentTaxComponentTotal = { componentId: string; name: string; rate: number; accountId: string | null; amount: number };

/**
 * Aggregate several lines' already-computed tax into one breakdown by
 * component — the totals panel's "{TaxLabel} breakdown by rate" and the one
 * (or several, per distinct liability account) journal line(s) a document
 * posts. Two rounding modes, a per-company setting (spec 4.3):
 *   - "perLine": each line's tax was already rounded when calcLineTax ran;
 *     this just sums those rounded amounts per component.
 *   - "perDocument": sums each component's UNROUNDED amount across every
 *     line first, rounding once per component — the standard VAT-return
 *     convention, and the one that avoids a 1p drift on an invoice with many
 *     small lines of the same rate.
 */
export function aggregateDocumentTax(lines: LineTaxResult[], mode: RoundingMode): { components: DocumentTaxComponentTotal[]; total: number } {
  const totals = new Map<string, DocumentTaxComponentTotal & { raw: number }>();
  for (const line of lines) {
    for (const c of line.componentAmounts) {
      const cur = totals.get(c.componentId) ?? { componentId: c.componentId, name: c.name, rate: c.rate, accountId: c.accountId, amount: 0, raw: 0 };
      cur.amount += c.amount;
      cur.raw += c.rawAmount;
      totals.set(c.componentId, cur);
    }
  }
  const components = [...totals.values()].map(t => ({
    componentId: t.componentId, name: t.name, rate: t.rate, accountId: t.accountId,
    amount: mode === "perDocument" ? round2(t.raw) : round2(t.amount),
  }));
  const total = round2(components.reduce((s, c) => s + c.amount, 0));
  return { components, total };
}

// ── TaxProvider — the pluggable-engine seam (Phase 3d) ──────────────────────
//
// The built-in engine above (calcLineTax/aggregateDocumentTax, backed by
// tax_agencies/tax_components/tax_codes) handles VAT/GST-style jurisdictions,
// where a tenant configures its own agencies and rates. US sales tax doesn't
// fit that model well — rates vary by address down to the ZIP+4, nexus rules
// change what's even taxable, and no org wants to hand-maintain that table.
// A TaxProvider is the seam an external engine (Avalara, Stripe Tax, TaxJar)
// would implement later to serve that case instead, without lib/accounting/
// documents.ts caring which engine actually answered.
//
// NOT WIRED UP: nothing in documents.ts calls a TaxProvider yet — the posting
// path (withTax()) talks to calcLineTax/resolveTaxCodes directly. This exists
// so a future external-engine integration has a defined shape to implement
// and a reference implementation (NativeTaxProvider) to compare against,
// not as a currently-reachable code path.

/** What a provider needs to price one line — intentionally a superset of what
 *  the native engine itself needs, since an address-based engine (US sales
 *  tax) requires ship-from/ship-to that a jurisdiction-rate engine does not. */
export type TaxProviderLineInput = {
  amount: number;
  pricing: PricingMode;
  isSale: boolean;
  /** This org's native tax_codes.id, when the line used one. A non-native
   *  provider would ignore this and use its own product tax code instead. */
  taxCodeId?: string | null;
  /** The provider's own product/service tax code (e.g. Avalara's "PC" codes),
   *  for an external engine that classifies by product rather than by a
   *  tenant-configured code. */
  externalTaxCode?: string | null;
  shipFrom?: { country: string; region?: string | null; postalCode?: string | null } | null;
  shipTo?: { country: string; region?: string | null; postalCode?: string | null } | null;
  /** YYYY-MM-DD — the document's own date, never "today" (see calcLineTax). */
  asOf: string;
};

export type TaxProviderResult = LineTaxResult & {
  /** The provider's own id for this calculation, if it tracks one (Avalara's
   *  DocumentCode, for instance) — kept for audit/commit calls back to the
   *  provider, not used by posting itself. */
  providerRef?: string | null;
};

export interface TaxProvider {
  /** "native" | "avalara" | "stripe-tax" | "taxjar" | … */
  readonly id: string;
  calcLine(input: TaxProviderLineInput): Promise<TaxProviderResult>;
}

/**
 * The built-in engine, wrapped to the TaxProvider shape — proves the
 * interface is implementable by what already exists, and is what
 * `withTax()` would default to if a future org-level setting let a tenant
 * choose a different provider. `resolveCode` is injected rather than
 * imported directly so this file stays client-safe (resolving a tax_codes id
 * needs `db` — lib/accounting/tax-engine-server.ts).
 */
export function createNativeTaxProvider(resolveCode: (taxCodeId: string, asOf: string) => Promise<TaxCodeRates | null>): TaxProvider {
  return {
    id: "native",
    async calcLine(input) {
      const code = input.taxCodeId ? await resolveCode(input.taxCodeId, input.asOf) : null;
      return calcLineTax(input.amount, input.pricing, code, input.isSale);
    },
  };
}
