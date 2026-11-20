/**
 * EDI partner profiles (0145), the pure rules. Client-safe.
 *
 * A profile says how we exchange files with ONE party: test or live, standard
 * and version, both sides' interchange IDs, how files travel, which documents go
 * out, the partner's own rules, and unit-code overrides. Nothing here is
 * specific to one partner: every value is the org's own entry.
 */

export const X12_VERSIONS = ["004010", "005010"] as const;
export const EDI_MODES = ["test", "live"] as const;
/** Phase 1: the file is generated and kept here; a person delivers it. Others plug in behind lib/edi/transport. */
export const EDI_TRANSPORTS = ["manual"] as const;
export const EDI_DOCS_OUT = ["850", "855", "856", "810", "997", "999", "TA1"] as const;

/** TXI01 tax type codes an 810 may carry. An invoice stores only the tax AMOUNT, so which kind it is is the partner's rule. */
export const EDI_TAX_TYPES: { code: string; label: string }[] = [
  { code: "ZZ", label: "ZZ · Mutually defined (amount only)" },
  { code: "VA", label: "VA · Value-added tax" },
  { code: "GS", label: "GS · Goods and services tax" },
  { code: "ST", label: "ST · State sales tax" },
  { code: "LS", label: "LS · Local sales tax" },
  { code: "CT", label: "CT · County or parish sales tax" },
];

/** ISA05 / ISA07 interchange ID qualifiers in common use. */
export const ISA_QUALIFIERS: { code: string; label: string }[] = [
  { code: "01", label: "01 · DUNS" },
  { code: "08", label: "08 · UCC EDI Communications ID" },
  { code: "09", label: "09 · X.121" },
  { code: "12", label: "12 · Phone number" },
  { code: "14", label: "14 · DUNS + suffix" },
  { code: "16", label: "16 · DUNS + 4-character suffix" },
  { code: "20", label: "20 · HIN" },
  { code: "27", label: "27 · Carrier ID" },
  { code: "28", label: "28 · Fiscal intermediary" },
  { code: "29", label: "29 · Medicare provider" },
  { code: "30", label: "30 · US federal tax ID" },
  { code: "33", label: "33 · NAIC" },
  { code: "ZZ", label: "ZZ · Mutually defined" },
];
const QUAL_SET = new Set(ISA_QUALIFIERS.map(q => q.code));

export type PartnerInput = {
  partyId?: unknown; enabled?: unknown; mode?: unknown; standard?: unknown; version?: unknown;
  senderQualifier?: unknown; senderId?: unknown; receiverQualifier?: unknown; receiverId?: unknown;
  senderAppId?: unknown; receiverAppId?: unknown; transport?: unknown; docsOut?: unknown;
  requirePartNumber?: unknown; requireGtin?: unknown; taxType?: unknown; unitOverrides?: unknown; notes?: unknown;
};

export type PartnerValues = {
  enabled: boolean; mode: (typeof EDI_MODES)[number]; standard: "x12"; version: (typeof X12_VERSIONS)[number];
  senderQualifier: string; senderId: string; receiverQualifier: string; receiverId: string;
  senderAppId: string | null; receiverAppId: string | null; transport: (typeof EDI_TRANSPORTS)[number];
  docsOut: string[]; requirePartNumber: boolean; requireGtin: boolean; taxType: string; unitOverrides: Record<string, string>; notes: string | null;
};

type Result<T> = { ok: true; value: T } | { ok: false; error: string };
class Refusal extends Error {}
const refuse = (m: string): never => { throw new Refusal(m); };

/** Characters an X12 element may never carry: the separators, and anything outside printable ASCII. */
const UNSAFE = /[*~>^|\x00-\x1f\x7f-￿]/;

function ediId(v: unknown, label: string, min: number, max: number, required: boolean): string | null {
  const s = v == null ? "" : String(v).trim();
  if (!s) { if (required) refuse(`${label} is required.`); return null; }
  if (s.length < min || s.length > max) refuse(`${label} must be ${min} to ${max} characters.`);
  if (UNSAFE.test(s)) refuse(`${label} may only use plain letters, digits and spaces (no * ~ > ^ |).`);
  return s;
}

function qualifier(v: unknown, label: string): string {
  const s = String(v ?? "").trim().toUpperCase();
  if (!QUAL_SET.has(s)) refuse(`${label}: choose an ID qualifier.`);
  return s;
}

/** Per-partner unit codes: our unit (or pack type) → the partner's 2-character X12 unit code. */
export function unitOverrideValues(v: unknown): Record<string, string> {
  if (v == null || v === "") return {};
  if (typeof v !== "object" || Array.isArray(v)) refuse("Unit codes must be a list of our unit → their code.");
  const out: Record<string, string> = {};
  for (const [k, raw] of Object.entries(v as Record<string, unknown>)) {
    const ours = k.trim().toLowerCase();
    if (!ours) continue;
    if (ours.length > 16) refuse(`"${k}" is longer than 16 characters.`);
    const code = String(raw ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{2}$/.test(code)) refuse(`The code for "${k}" must be 2 letters or digits (an X12 unit code, e.g. CA).`);
    out[ours] = code;
  }
  if (Object.keys(out).length > 100) refuse("At most 100 unit codes per partner.");
  return out;
}

export function partnerValues(input: PartnerInput): Result<PartnerValues> {
  try {
    const mode = String(input.mode ?? "test") as PartnerValues["mode"];
    if (!EDI_MODES.includes(mode)) refuse("Mode must be test or live.");
    const standard = String(input.standard ?? "x12");
    if (standard !== "x12") refuse("Only X12 is supported for now.");
    const version = String(input.version ?? "004010") as PartnerValues["version"];
    if (!X12_VERSIONS.includes(version)) refuse("Version must be 004010 or 005010.");
    const transport = String(input.transport ?? "manual") as PartnerValues["transport"];
    if (!EDI_TRANSPORTS.includes(transport)) refuse("Only manual delivery is available for now.");
    const docsRaw = input.docsOut == null ? ["850"] : input.docsOut;
    if (!Array.isArray(docsRaw)) refuse("Documents must be a list.");
    const docsOut = [...new Set((docsRaw as unknown[]).map(String))];
    for (const d of docsOut) if (!(EDI_DOCS_OUT as readonly string[]).includes(d)) refuse(`${d} is not a document we can send yet.`);
    const taxType = String(input.taxType ?? "ZZ").trim().toUpperCase() || "ZZ";
    if (!EDI_TAX_TYPES.some(t => t.code === taxType)) refuse("Choose a tax type from the list.");
    const notes = input.notes == null ? null : String(input.notes).trim().slice(0, 2000) || null;
    return { ok: true, value: {
      enabled: input.enabled == null ? true : Boolean(input.enabled), mode, standard: "x12", version,
      senderQualifier: qualifier(input.senderQualifier, "Our ID qualifier"),
      senderId: ediId(input.senderId, "Our interchange ID", 1, 15, true)!,
      receiverQualifier: qualifier(input.receiverQualifier, "Their ID qualifier"),
      receiverId: ediId(input.receiverId, "Their interchange ID", 1, 15, true)!,
      senderAppId: ediId(input.senderAppId, "Our application ID (GS)", 2, 15, false),
      receiverAppId: ediId(input.receiverAppId, "Their application ID (GS)", 2, 15, false),
      transport, docsOut,
      requirePartNumber: input.requirePartNumber == null ? true : Boolean(input.requirePartNumber),
      requireGtin: Boolean(input.requireGtin),
      taxType,
      unitOverrides: unitOverrideValues(input.unitOverrides),
      notes,
    } };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, error: e.message };
    throw e;
  }
}
