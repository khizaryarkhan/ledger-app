/**
 * Units of measure + conversions for the inventory register.
 *
 * Each UoM belongs to a DIMENSION (mass, volume, count, length) and carries a
 * factor to that dimension's canonical base. Conversions within a dimension are
 * automatic (kg→lb, l→ml). ACROSS dimensions there is no universal factor
 * (e.g. litres → pounds depends on density), so the caller must supply one —
 * captured per supplier-SKU.
 */

export type Dimension = "mass" | "volume" | "count" | "length";

export type Uom = { code: string; name: string; dimension: Dimension; toBase: number };

// Canonical bases: mass=gram, volume=millilitre, count=each, length=millimetre.
export const UOMS: Uom[] = [
  // Mass
  { code: "mg", name: "Milligram", dimension: "mass", toBase: 0.001 },
  { code: "g", name: "Gram", dimension: "mass", toBase: 1 },
  { code: "kg", name: "Kilogram", dimension: "mass", toBase: 1000 },
  { code: "oz", name: "Ounce", dimension: "mass", toBase: 28.349523125 },
  { code: "lb", name: "Pound", dimension: "mass", toBase: 453.59237 },
  { code: "mt", name: "Metric ton", dimension: "mass", toBase: 1_000_000 },
  // Volume
  { code: "ml", name: "Millilitre", dimension: "volume", toBase: 1 },
  { code: "lt", name: "Litre", dimension: "volume", toBase: 1000 },
  { code: "tsp", name: "Teaspoon", dimension: "volume", toBase: 4.92892 },
  { code: "tbsp", name: "Tablespoon", dimension: "volume", toBase: 14.7868 },
  { code: "floz", name: "Fluid ounce", dimension: "volume", toBase: 29.5735 },
  { code: "cup", name: "Cup", dimension: "volume", toBase: 236.588 },
  { code: "pt", name: "Pint", dimension: "volume", toBase: 473.176 },
  { code: "qt", name: "Quart", dimension: "volume", toBase: 946.353 },
  { code: "gal", name: "Gallon", dimension: "volume", toBase: 3785.41 },
  // Count
  { code: "each", name: "Each", dimension: "count", toBase: 1 },
  { code: "pair", name: "Pair", dimension: "count", toBase: 2 },
  { code: "dozen", name: "Dozen", dimension: "count", toBase: 12 },
  { code: "gross", name: "Gross (144)", dimension: "count", toBase: 144 },
  // Length
  { code: "mm", name: "Millimetre", dimension: "length", toBase: 1 },
  { code: "cm", name: "Centimetre", dimension: "length", toBase: 10 },
  { code: "m", name: "Metre", dimension: "length", toBase: 1000 },
  { code: "in", name: "Inch", dimension: "length", toBase: 25.4 },
  { code: "ft", name: "Foot", dimension: "length", toBase: 304.8 },
];

const BY_CODE = new Map(UOMS.map(u => [u.code.toLowerCase(), u]));
export const uom = (code?: string | null): Uom | undefined => (code ? BY_CODE.get(code.trim().toLowerCase()) : undefined);
export const dimensionOf = (code?: string | null): Dimension | null => uom(code)?.dimension ?? null;

/** Packaging container types for SKU definitions. */
export const PACK_TYPES = [
  "each", "bottle", "can", "jar", "box", "carton", "case", "pack", "bag", "pouch",
  "sachet", "tray", "tub", "tube", "drum", "keg", "bucket", "roll", "bundle", "pallet",
];

// ─────────────────────────────────────────────────────────────────────────────
// EDI unit codes (2026-11-19).
//
// Every quantity on an EDI document carries a unit code from a published list:
// X12 element 355 ("Unit or Basis for Measurement Code") for X12, and UN/ECE
// Recommendation 20 for EDIFACT. Package types appear in Rec 20 with an "X"
// prefix on the Rec 21 package code (bag = XBG).
//
// Each code below was READ from the published lists, not recalled: X12 355
// release 4010 (as reproduced by stedi.com/edi/x12-004010/element/355) and
// UN/ECE Rec 20 + Rec 21 X-codes (docs.peppol.eu/poacc/billing/3.0/codelist/
// UNECERec20). A unit with no exact match carries null and a reason, never the
// nearest-sounding code: a wrong unit code turns 10 cases into 10 eaches at the
// partner's end, which is the costliest EDI mistake there is. A partner whose
// guide says otherwise gets a per-partner override; that is a setting, not an
// edit here.
// ─────────────────────────────────────────────────────────────────────────────

export type EdiStandard = "x12" | "unece";

/** A code in each standard, or null with the reason no exact code exists. */
export type EdiCodes = {
  x12: string | null;
  unece: string | null;
  /** Why a standard has no code, or which choice was made between near-matches. */
  note?: string;
};

/** Units of measure (keys are UOMS codes). */
export const UOM_EDI_CODES: Record<string, EdiCodes> = {
  mg: { x12: "ME", unece: "MGM" },
  g: { x12: "GR", unece: "GRM" },
  kg: { x12: "KG", unece: "KGM" },
  oz: { x12: "OZ", unece: "ONZ", note: "Avoirdupois ounce (mass)." },
  lb: { x12: "LB", unece: "LBR" },
  mt: { x12: "MP", unece: "TNE", note: "Metric tonne (1000 kg). Not X12 TN/NS (short ton) or MT (metric long ton)." },
  ml: { x12: "ML", unece: "MLT" },
  lt: { x12: "LT", unece: "LTR" },
  tsp: { x12: null, unece: "G25", note: "X12 Y3 is defined as 5 ml (metric); this unit is the US teaspoon (4.93 ml), so it has no exact X12 code." },
  tbsp: { x12: "Y2", unece: "G24", note: "X12 Y2 is half a fluid ounce, which is the US tablespoon this unit holds." },
  floz: { x12: "FO", unece: "OZA", note: "US fluid ounce. X12 lists the imperial one separately (FZ), so FO is the US one." },
  cup: { x12: null, unece: null, note: "Neither list states the volume of its cup code (X12 CU, UN/ECE G21), so neither is known to equal the US cup this unit holds." },
  pt: { x12: "PT", unece: "PTL", note: "US liquid pint. X12 lists imperial (PX) and US dry (Q2) separately." },
  qt: { x12: "QT", unece: "QTL", note: "US liquid quart. X12 lists imperial (QU) and US dry (QS) separately." },
  gal: { x12: "GA", unece: "GLL", note: "US gallon. X12 lists imperial gallons separately (GI)." },
  each: { x12: "EA", unece: "EA" },
  pair: { x12: "PR", unece: "PR" },
  dozen: { x12: "DZ", unece: "DZN" },
  gross: { x12: "GS", unece: "GRO" },
  mm: { x12: "MM", unece: "MMT" },
  cm: { x12: "CM", unece: "CMT" },
  m: { x12: "MR", unece: "MTR" },
  in: { x12: "IN", unece: "INH" },
  ft: { x12: "FT", unece: "FOT" },
};

/** Package types (keys are PACK_TYPES). UN/ECE codes are the Rec 20 "X" form. */
export const PACK_TYPE_EDI_CODES: Record<string, EdiCodes> = {
  each: { x12: "EA", unece: "EA", note: "A single item counted as a unit; UN/ECE has no package code for it." },
  bottle: { x12: "BO", unece: "XBO", note: "UN/ECE XBO is the generic non-protected cylindrical bottle; partners may require a more specific bottle code." },
  can: { x12: "CN", unece: null, note: "UN/ECE splits cans by shape (XCA rectangular, XCX cylindrical); the shape is not recorded, so no code is chosen." },
  jar: { x12: "JR", unece: "XJR" },
  box: { x12: "BX", unece: "XBX" },
  carton: { x12: "CT", unece: "XCT" },
  case: { x12: "CA", unece: "XCS" },
  pack: { x12: "PH", unece: "XPK", note: "X12 PH is \"Pack (PAK)\"; UN/ECE has no \"pack\" and XPK (\"Package\") is its standard packaging unit." },
  bag: { x12: "BG", unece: "XBG" },
  pouch: { x12: "V2", unece: "XPO" },
  sachet: { x12: null, unece: "XSH", note: "X12 355 has no sachet code." },
  tray: { x12: "TY", unece: "XPU" },
  tub: { x12: "Y4", unece: "XTB" },
  tube: { x12: "TB", unece: "XTU" },
  drum: { x12: "DR", unece: "XDR" },
  keg: { x12: null, unece: "XKG", note: "X12 KE is a weight (100 lb, used for nails), not a container, so it is not used for keg." },
  bucket: { x12: "BC", unece: "XBJ" },
  roll: { x12: "RL", unece: "XRO" },
  bundle: { x12: "BD", unece: "XBE" },
  pallet: { x12: "PL", unece: "XPX", note: "X12 PL is \"Pallet/Unit Load\"; PF (\"Pallet (Lift)\") is the alternative a partner may ask for. Pallets are usually a SHIPPING unit, so a partner's guide may refuse them on an order line." },
};

const PACK_SET = new Set(PACK_TYPES);

/** A stored pack type in its canonical form, or null when it is not one of PACK_TYPES. */
export function normalisePackType(v?: string | null): string | null {
  const k = String(v ?? "").trim().toLowerCase();
  return PACK_SET.has(k) ? k : null;
}

/** True when a code is one of our units of measure. */
export const isKnownUom = (code?: string | null): boolean => !!uom(code);

/**
 * Why a pack type the user sent cannot be stored, or null when it can.
 * Empty is allowed (the level simply has no named container).
 */
export function packTypeError(v: unknown, label: string): string | null {
  if (v == null || String(v).trim() === "") return null;
  return normalisePackType(String(v)) ? null : `${label} "${String(v).trim()}" is not a known pack type. Use one of: ${PACK_TYPES.join(", ")}.`;
}

/** Why a unit the user sent cannot be stored, or null when it can. Empty is allowed. */
export function uomError(v: unknown, label: string): string | null {
  if (v == null || String(v).trim() === "") return null;
  return isKnownUom(String(v)) ? null : `${label} "${String(v).trim()}" is not a known unit. Use one of: ${UOMS.map(u => u.code).join(", ")}.`;
}

/**
 * The order unit a trade-document line may carry: one of our units, or one of
 * our pack types. Anything else cannot be translated into an EDI unit code.
 */
export const isKnownOrderUnit = (v?: string | null): boolean => isKnownUom(v) || !!normalisePackType(v);

/** An order unit in its stored form ("KG " -> "kg", "Case" -> "case"), or null when unknown. */
export const canonicalOrderUnit = (v?: string | null): string | null => uom(v)?.code ?? normalisePackType(v);

export type EdiCodeResult = { ok: true; code: string } | { ok: false; reason: string };

/**
 * The EDI code for one of our units or pack types. Units are looked up first,
 * so "each" (both a unit and a pack type) resolves the same either way.
 * Never guesses: an unknown value or a standard with no exact code is an error
 * that names the value, so the pre-send validator can say which line to fix.
 */
export function ediUnitCode(value: string | null | undefined, standard: EdiStandard): EdiCodeResult {
  const raw = String(value ?? "").trim();
  if (!raw) return { ok: false, reason: "No unit is recorded." };
  const u = uom(raw);
  const entry = u ? UOM_EDI_CODES[u.code] : PACK_TYPE_EDI_CODES[normalisePackType(raw) ?? ""];
  if (!entry) return { ok: false, reason: `"${raw}" is not one of our units or pack types.` };
  const code = entry[standard];
  const name = standard === "x12" ? "X12" : "UN/ECE";
  return code ? { ok: true, code } : { ok: false, reason: `"${raw}" has no exact ${name} code. ${entry.note ?? ""}`.trim() };
}

/** True when two UoMs are in different dimensions (no standard factor exists). */
export function needsConversionFactor(fromCode?: string | null, toCode?: string | null): boolean {
  const a = uom(fromCode), b = uom(toCode);
  if (!a || !b) return true;            // unknown → ask for a factor to be safe
  return a.dimension !== b.dimension;
}

export type ConvertResult = { ok: true; qty: number } | { ok: false; needsFactor: true };

/**
 * Convert qty from one UoM to another. Same dimension → automatic. Different
 * dimension → uses `factor` (how many `to` per one `from`); returns needsFactor
 * when a cross-dimension conversion is requested without one.
 */
export function convert(qty: number, fromCode: string, toCode: string, factor?: number | null): ConvertResult {
  const a = uom(fromCode), b = uom(toCode);
  if (a && b && a.dimension === b.dimension) return { ok: true, qty: (qty * a.toBase) / b.toBase };
  if (factor != null && factor > 0) return { ok: true, qty: qty * factor };
  return { ok: false, needsFactor: true };
}

const trimNum = (n: number) => {
  const r = Math.round(n * 1e6) / 1e6;
  return Number.isInteger(r) ? String(r) : String(r);
};

/**
 * Human pack configuration for a finished-product SKU, expressed in the item's
 * base UoM. e.g. base ml, 750 per bottle, 6 bottles per case →
 * "4500 ml/case [750 ml x 6 bottle]".
 */
export function packConfig(opts: {
  baseUom: string; innerSize?: number | null; innerType?: string | null;
  unitsAddl?: number | null; addlType?: string | null;
  unitsOuter?: number | null; outerType?: string | null;
}): string {
  const { baseUom, innerSize, innerType } = opts;
  if (!innerSize || !innerType) return "";
  const parts: string[] = [`${trimNum(innerSize)} ${baseUom} x ${innerType}`];
  let total = innerSize; let container = innerType;
  if (opts.unitsAddl && opts.addlType) { total *= opts.unitsAddl; parts.push(`${opts.unitsAddl} ${opts.addlType}`); container = opts.addlType; }
  if (opts.unitsOuter && opts.outerType) { total *= opts.unitsOuter; parts.push(`${opts.unitsOuter} ${opts.outerType}`); container = opts.outerType; }
  return `${trimNum(total)} ${baseUom}/${container} [${parts.join(" x ")}]`;
}
