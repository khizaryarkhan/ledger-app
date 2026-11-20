/**
 * Trading terms and supplier contacts (0142), the pure half (client-safe; no db).
 *
 *  - Our account number with a party: the number THEY know us by (on their
 *    invoices, and in EDI as REF*IA / the N1 code they assigned us).
 *  - Early-payment discount: "2% if paid within 10 days" on top of the party's
 *    payment terms (days). Both parts or neither (X12 ITD carries both).
 *  - Incoterm (ICC Incoterms 2020) with its named place: who carries cost and
 *    risk to where. A term without its place is incomplete ("FOB" — which
 *    port?), so a place is required whenever a term is set.
 *
 * These live on the party and are COPIED onto each PO/SO when it is created
 * (termsForDocument), so a later change never rewrites an order already sent.
 */

/** ICC Incoterms 2020. `place` says what the named place is for that rule. */
export const INCOTERMS = [
  { code: "EXW", name: "Ex Works", place: "place of delivery", seaOnly: false },
  { code: "FCA", name: "Free Carrier", place: "place of delivery", seaOnly: false },
  { code: "CPT", name: "Carriage Paid To", place: "place of destination", seaOnly: false },
  { code: "CIP", name: "Carriage and Insurance Paid To", place: "place of destination", seaOnly: false },
  { code: "DAP", name: "Delivered at Place", place: "place of destination", seaOnly: false },
  { code: "DPU", name: "Delivered at Place Unloaded", place: "place of destination", seaOnly: false },
  { code: "DDP", name: "Delivered Duty Paid", place: "place of destination", seaOnly: false },
  { code: "FAS", name: "Free Alongside Ship", place: "port of shipment", seaOnly: true },
  { code: "FOB", name: "Free On Board", place: "port of shipment", seaOnly: true },
  { code: "CFR", name: "Cost and Freight", place: "port of destination", seaOnly: true },
  { code: "CIF", name: "Cost, Insurance and Freight", place: "port of destination", seaOnly: true },
] as const;
export type IncotermCode = typeof INCOTERMS[number]["code"];
export const incotermOf = (code: string | null | undefined) => INCOTERMS.find(t => t.code === String(code ?? "").trim().toUpperCase()) ?? null;

export const TERMS_LIMITS = { ourAccountNumber: 64, incotermPlace: 128 } as const;

export type TermsValues = {
  ourAccountNumber?: string | null;
  discountPercent?: string | null;   // numeric(5,2) as a string, the Drizzle shape
  discountDays?: number | null;
  incoterm?: string | null;
  incotermPlace?: string | null;
};

const blank = (v: unknown) => v === null || v === undefined || String(v).trim() === "";

/**
 * Terms columns to write from a request body. Absent fields are left out (an
 * edit that does not mention them leaves them alone); empty clears. Pairs are
 * judged on what they will be AFTER the write, using `current` for the half not
 * sent, so clearing one half of a pair is caught too. `paymentTermsDays` is the
 * party's net days, for "the discount must come before the due date".
 */
export function termsValues(
  b: Record<string, unknown> | null | undefined,
  current: { discountPercent?: unknown; discountDays?: unknown; incoterm?: unknown; incotermPlace?: unknown; paymentTermsDays?: unknown } = {},
): { values: TermsValues } | { error: string } {
  const values: TermsValues = {};
  if (b?.ourAccountNumber !== undefined) {
    const v = blank(b.ourAccountNumber) ? null : String(b.ourAccountNumber).trim();
    if (v && v.length > TERMS_LIMITS.ourAccountNumber) return { error: `Our account number must be ${TERMS_LIMITS.ourAccountNumber} characters or fewer.` };
    values.ourAccountNumber = v;
  }

  if (b?.discountPercent !== undefined) {
    if (blank(b.discountPercent)) values.discountPercent = null;
    else {
      const p = Number(b.discountPercent);
      if (!Number.isFinite(p) || p <= 0 || p >= 100) return { error: "Early-payment discount must be a percentage above 0 and below 100." };
      if (Math.abs(p * 100 - Math.round(p * 100)) > 1e-6) return { error: "Early-payment discount can have at most 2 decimals." };
      values.discountPercent = p.toFixed(2);
    }
  }
  if (b?.discountDays !== undefined) {
    if (blank(b.discountDays)) values.discountDays = null;
    else {
      const d = Number(b.discountDays);
      if (!Number.isInteger(d) || d < 1 || d > 3650) return { error: "Discount days must be a whole number of days (1–3650)." };
      values.discountDays = d;
    }
  }
  const pct = values.discountPercent !== undefined ? values.discountPercent : (blank(current.discountPercent) ? null : String(current.discountPercent));
  const days = values.discountDays !== undefined ? values.discountDays : (blank(current.discountDays) ? null : Number(current.discountDays));
  if ((pct == null) !== (days == null)) return { error: "An early-payment discount needs both the percentage and the number of days, or neither." };
  const net = blank(current.paymentTermsDays) ? null : Number(current.paymentTermsDays);
  if (days != null && net != null && Number.isFinite(net) && net > 0 && days >= net) {
    return { error: `The discount must be for paying early: ${days} days is not before the payment terms of ${net} days.` };
  }

  if (b?.incoterm !== undefined) {
    if (blank(b.incoterm)) values.incoterm = null;
    else {
      const t = incotermOf(String(b.incoterm));
      if (!t) return { error: `"${String(b.incoterm).trim()}" is not an Incoterms 2020 rule (${INCOTERMS.map(x => x.code).join(", ")}).` };
      values.incoterm = t.code;
    }
  }
  if (b?.incotermPlace !== undefined) {
    const v = blank(b.incotermPlace) ? null : String(b.incotermPlace).trim().replace(/\s+/g, " ");
    if (v && v.length > TERMS_LIMITS.incotermPlace) return { error: `The Incoterm's named place must be ${TERMS_LIMITS.incotermPlace} characters or fewer.` };
    values.incotermPlace = v;
  }
  const term = values.incoterm !== undefined ? values.incoterm : (blank(current.incoterm) ? null : String(current.incoterm));
  const place = values.incotermPlace !== undefined ? values.incotermPlace : (blank(current.incotermPlace) ? null : String(current.incotermPlace));
  if (term && !place) return { error: `${term} needs its named ${incotermOf(term)?.place ?? "place"}, e.g. "${term} Dublin Port".` };
  if (place && !term) return { error: "A named place only means something with an Incoterm: choose the rule, or clear the place." };
  return { values };
}

export type DocTerms = { paymentTermsDays: number | null; discountPercent: string | null; discountDays: number | null; incoterm: string | null; incotermPlace: string | null };

/**
 * The terms an order takes when it is created: the party's, with the order's
 * own Incoterm/place in their place when the form sent them (validated as a
 * pair). Payment and discount terms are the party's only: an order does not
 * renegotiate them.
 */
export function termsForDocument(
  party: { paymentTerms?: unknown; discountPercent?: unknown; discountDays?: unknown; incoterm?: unknown; incotermPlace?: unknown } | null | undefined,
  override: { incoterm?: unknown; incotermPlace?: unknown } = {},
): { terms: DocTerms } | { error: string } {
  const base: DocTerms = {
    paymentTermsDays: party && !blank(party.paymentTerms) ? Number(party.paymentTerms) : null,
    discountPercent: party && !blank(party.discountPercent) ? Number(party.discountPercent).toFixed(2) : null,
    discountDays: party && !blank(party.discountDays) ? Number(party.discountDays) : null,
    incoterm: party && !blank(party.incoterm) ? String(party.incoterm) : null,
    incotermPlace: party && !blank(party.incotermPlace) ? String(party.incotermPlace) : null,
  };
  if (override.incoterm === undefined && override.incotermPlace === undefined) return { terms: base };
  const r = termsValues({ incoterm: override.incoterm ?? null, incotermPlace: override.incotermPlace ?? null });
  if ("error" in r) return r;
  return { terms: { ...base, incoterm: r.values.incoterm ?? null, incotermPlace: r.values.incotermPlace ?? null } };
}

/** "2% 10, net 30" / "Net 30" / null — how terms read on a screen or a document. */
export function termsLabel(t: { paymentTermsDays?: unknown; discountPercent?: unknown; discountDays?: unknown }): string | null {
  const net = blank(t.paymentTermsDays) ? null : Number(t.paymentTermsDays);
  const pct = blank(t.discountPercent) ? null : Number(t.discountPercent);
  const days = blank(t.discountDays) ? null : Number(t.discountDays);
  const disc = pct != null && days != null ? `${Number(pct.toFixed(2))}% ${days}` : null;
  if (disc && net != null) return `${disc}, net ${net}`;
  if (net != null) return net === 0 ? "Due on receipt" : `Net ${net}`;
  return disc;
}

/** "FOB Dublin Port" or null. */
export const incotermLabel = (t: { incoterm?: unknown; incotermPlace?: unknown }) =>
  blank(t.incoterm) ? null : [String(t.incoterm), blank(t.incotermPlace) ? null : String(t.incotermPlace)].filter(Boolean).join(" ");

/* ------------------------------- Contacts ------------------------------- */

export const CONTACT_ROLES = [
  { v: "purchasing", label: "Orders / purchasing" },
  { v: "accounts", label: "Accounts / invoices" },
  { v: "logistics", label: "Deliveries / logistics" },
  { v: "quality", label: "Quality" },
  { v: "edi", label: "EDI / integration" },
  { v: "other", label: "Other" },
] as const;
export const contactRoleLabel = (r: string) => CONTACT_ROLES.find(x => x.v === r)?.label ?? "Other";

export type ContactValues = { name?: string; role?: string; email?: string | null; phone?: string | null; isPrimary?: boolean };

/** A contact needs a name and at least one way to reach them. */
export function contactValues(b: Record<string, unknown> | null | undefined, opts: { creating: boolean; current?: { email?: string | null; phone?: string | null } }): { values: ContactValues } | { error: string } {
  const values: ContactValues = {};
  const text = (k: "name" | "email" | "phone", max: number, label: string) => {
    if (b?.[k] === undefined) return null;
    const v = blank(b[k]) ? null : String(b[k]).trim();
    if (v && v.length > max) return `${label} must be ${max} characters or fewer.`;
    (values as any)[k] = v;
    return null;
  };
  const e = text("name", 128, "Name") ?? text("email", 255, "Email") ?? text("phone", 64, "Phone");
  if (e) return { error: e };
  if (values.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email)) return { error: `"${values.email}" is not an email address.` };
  if (opts.creating && !values.name) return { error: "A contact needs a name." };
  if (!opts.creating && b?.name !== undefined && !values.name) return { error: "A contact needs a name." };
  if (values.name === null) delete values.name;
  if (b?.role !== undefined) {
    const r = String(b.role ?? "").trim();
    if (!CONTACT_ROLES.some(x => x.v === r)) return { error: "Choose what this contact handles." };
    values.role = r;
  }
  const email = values.email !== undefined ? values.email : opts.current?.email ?? null;
  const phone = values.phone !== undefined ? values.phone : opts.current?.phone ?? null;
  if (!email && !phone) return { error: "Give an email or a phone number, or there is no way to reach this contact." };
  if (b?.isPrimary !== undefined) values.isPrimary = b.isPrimary === true;
  return { values };
}
