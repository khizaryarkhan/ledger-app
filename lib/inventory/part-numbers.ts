/**
 * Part-number cross-references, the pure half (client-safe; no db). The server
 * half is lib/inventory/part-numbers-server.ts — same split as identifiers.ts.
 *
 * A part number is a PARTNER's code for one of our items at one pack level:
 *  - side "supplier": the supplier's number on a link we buy through (X12 VP on
 *    our outbound purchase order);
 *  - side "customer": the customer's number for what we sell them (X12 BP on
 *    their inbound order, which we must map to one of our items).
 *
 * It is NOT a barcode. A barcode is the org's (a scan has no partner), so one
 * barcode is one item across the whole org. A part number only means something
 * with its partner: two suppliers may both use "A100" for different things.
 * So uniqueness is per partner: one partner's code resolves to one item and one
 * pack level, or an inbound line could not be mapped without guessing.
 */

import { PACK_LEVELS, type PackLevel } from "@/lib/inventory/identifiers";

export const PART_SIDES = ["supplier", "customer"] as const;
export type PartSide = typeof PART_SIDES[number];

export const PART_NUMBER_MAX = 48;

/**
 * The comparison key: trimmed, inner whitespace collapsed, upper-cased. Partners
 * do not distinguish "ab-100" from "AB-100", and a stray space must not make a
 * second code. Hyphens and dots are KEPT: "AB-100" and "AB100" can be different
 * products in a partner's catalogue, and the rule is never to guess.
 */
export const partNumberKey = (code: string) => code.trim().replace(/\s+/g, " ").toUpperCase();

/** Validate one typed part number. "" / null = none. */
export function normalisePartNumber(input: unknown): { ok: true; code: string | null; key: string | null } | { ok: false; error: string } {
  const code = String(input ?? "").trim().replace(/\s+/g, " ");
  if (!code) return { ok: true, code: null, key: null };
  if (code.length > PART_NUMBER_MAX) return { ok: false, error: `A part number can be at most ${PART_NUMBER_MAX} characters.` };
  // Control characters would corrupt an EDI segment (and are never intended).
  if (/[\u0000-\u001f\u007f]/.test(code)) return { ok: false, error: "A part number can't contain control characters." };
  return { ok: true, code, key: partNumberKey(code) };
}

export type PartNumberMap = Partial<Record<PackLevel, string | null>>;
export type PreparedPart = { level: PackLevel; code: string; key: string };

const LEVEL_NAME: Record<PackLevel, string> = { unit: "Unit", inner: "Inner pack", addl_inner: "Additional inner pack", outer: "Outer pack" };
export const partLevelName = (l: PackLevel) => LEVEL_NAME[l];

/**
 * Validate a per-level map for ONE owner (a supplier link, or a customer + item
 * + SKU). Refuses a malformed code, a code on a level the owner does not have,
 * and the same code on two levels (a bag and its carton are different
 * quantities; one code cannot order both). `null` map = not sent, leave alone.
 */
export function preparePartNumberMap(map: PartNumberMap | null | undefined, allowed: readonly PackLevel[]): { ok: true; parts: PreparedPart[] | null } | { ok: false; error: string } {
  if (map == null) return { ok: true, parts: null };
  if (typeof map !== "object") return { ok: false, error: "Part numbers must be given per pack level." };
  const parts: PreparedPart[] = [];
  for (const level of PACK_LEVELS) {
    if (!(level in map)) continue;
    const n = normalisePartNumber(map[level]);
    if (n.ok === false) return { ok: false, error: `${LEVEL_NAME[level]} part number: ${n.error}` };
    if (!n.code) continue;
    if (!allowed.includes(level)) return { ok: false, error: `${LEVEL_NAME[level]} part number: this packaging has no ${LEVEL_NAME[level].toLowerCase()} level.` };
    parts.push({ level, code: n.code, key: n.key! });
  }
  const seen = new Map<string, PackLevel>();
  for (const p of parts) {
    const prev = seen.get(p.key);
    if (prev) return { ok: false, error: `${p.code} is entered for both the ${LEVEL_NAME[prev].toLowerCase()} and the ${LEVEL_NAME[p.level].toLowerCase()}. Each level is a different quantity and needs its own part number.` };
    seen.set(p.key, p.level);
  }
  return { ok: true, parts };
}

/** Rows (any order) → { level: code } for a form. */
export function partNumbersByLevel(rows: { packLevel: string; code: string }[]): PartNumberMap {
  const out: PartNumberMap = {};
  for (const r of rows) if ((PACK_LEVELS as readonly string[]).includes(r.packLevel)) out[r.packLevel as PackLevel] = r.code;
  return out;
}

/**
 * The part number to print on a document line ordered at `level`: that level's
 * own number, else nothing. Deliberately NOT the unit's number for a carton
 * line: quoting the bag's code against a carton quantity orders the wrong pack.
 */
export function partNumberForLevel(byLevel: PartNumberMap, level: string | null | undefined): string | null {
  const l = DOC_LEVEL[level || "unit"];
  return l ? byLevel[l] ?? null : null;
}

/**
 * A document line names its pack level in order-options' words
 * (lib/inventory/order-options.ts): "base" / "supplier" are the link's own unit,
 * "addl" the additional inner pack. Anything unrecognised maps to nothing.
 */
const DOC_LEVEL: Record<string, PackLevel> = {
  unit: "unit", base: "unit", supplier: "unit", inner: "inner", addl: "addl_inner", addl_inner: "addl_inner", outer: "outer",
};

/**
 * Which pack levels a customer part number may sit on: with no sales SKU it
 * names our item's base unit only; with a SKU, any level that SKU defines.
 */
export function customerLevels(sku: { innerUnitPackSize?: any; innerPackType?: any; unitsInAddlInnerPack?: any; addlInnerPackType?: any; unitsInOuterPack?: any; outerPackType?: any } | null | undefined): PackLevel[] {
  if (!sku) return ["unit"];
  const has = (a: any, b: any) => !!((a != null && String(a).trim() !== "" && Number(a) !== 0) || (b != null && String(b).trim() !== ""));
  const levels: PackLevel[] = ["unit"];
  if (has(sku.innerUnitPackSize, sku.innerPackType)) levels.push("inner");
  if (has(sku.unitsInAddlInnerPack, sku.addlInnerPackType)) levels.push("addl_inner");
  if (has(sku.unitsInOuterPack, sku.outerPackType)) levels.push("outer");
  return levels;
}
