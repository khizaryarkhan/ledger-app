/**
 * Barcodes per packaging level — the pure half (client-safe; no db). The
 * server half, which reads and writes item_identifiers, is
 * lib/inventory/identifiers-server.ts: same split, and same reason, as
 * lib/inventory/sourcing.ts / sourcing-server.ts.
 */

import { normaliseGtin, displayGtin } from "@/lib/gs1";

export const PACK_LEVELS = ["unit", "inner", "addl_inner", "outer"] as const;
export type PackLevel = typeof PACK_LEVELS[number];

export type Barcode = { scheme: "GTIN" | "OTHER"; code: string };

/**
 * What a typed or scanned barcode IS. The rule that matters: something that
 * LOOKS like a GTIN (all digits, 8/12/13/14 long) must BE one — a bad check
 * digit is a typo, and it is refused rather than quietly filed as "other",
 * where it would never match the real barcode on the box. Anything else
 * (letters, other lengths) is a non-GS1 code, kept as entered.
 */
export function classifyBarcode(input: string | null | undefined): { ok: true; barcode: Barcode | null } | { ok: false; error: string } {
  const raw = String(input ?? "").trim();
  if (!raw) return { ok: true, barcode: null };
  const compact = raw.replace(/[\s-]/g, "");
  if (/^\d+$/.test(compact) && [8, 12, 13, 14].includes(compact.length)) {
    const g = normaliseGtin(compact);
    return "error" in g ? { ok: false, error: g.error } : { ok: true, barcode: { scheme: "GTIN", code: g.gtin14 } };
  }
  if (raw.length > 48) return { ok: false, error: "A barcode can be at most 48 characters." };
  return { ok: true, barcode: { scheme: "OTHER", code: raw } };
}

/** How a stored code is shown: a GTIN in its shortest standard form. */
export const showBarcode = (b: { scheme: string; code: string }) => (b.scheme === "GTIN" ? displayGtin(b.code) : b.code);

/** Human label for a level on a given owner, e.g. "Bag (supplier unit)", "Carton (outer)". */
export function levelLabel(level: PackLevel, packType?: string | null): string {
  const t = packType?.trim();
  switch (level) {
    case "unit":       return t ? `${t} (unit)` : "Unit";
    case "inner":      return t ? `${t} (inner pack)` : "Inner pack";
    case "addl_inner": return t ? `${t} (additional inner)` : "Additional inner pack";
    case "outer":      return t ? `${t} (outer pack)` : "Outer pack";
  }
}
