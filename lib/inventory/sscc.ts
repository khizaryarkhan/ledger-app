/**
 * SSCC — GS1 Serial Shipping Container Code (AI 00), the pure half (client-safe;
 * no db). Server half: lib/inventory/sscc-server.ts.
 *
 * 18 digits: extension digit (1) + GS1 Company Prefix (4-12) + serial reference
 * (the rest, so prefix + serial = 16) + check digit (GS1 mod 10, the same
 * gs1CheckDigit the GTIN rules use). The prefix is assigned to the org by its
 * GS1 member office: we validate its shape, we never invent one.
 *
 * Packing: a shipment's goods go into packages (a pallet, or a carton,
 * optionally ON a pallet, one level deep), each with its own SSCC and the
 * quantities of shipment lines it holds. A package can never hold more of a
 * line than the shipment shipped.
 */

import { gs1CheckDigit } from "@/lib/gs1";
import { normalisePackType } from "@/lib/inventory/uom";
import { QTY_EPSILON } from "@/lib/inventory/round";

export const SSCC_BODY = 17;   // digits before the check digit

/** A GS1 Company Prefix: digits only, 4 to 12 long. */
export function normaliseCompanyPrefix(input: unknown): { ok: true; prefix: string | null } | { ok: false; error: string } {
  const raw = String(input ?? "").replace(/[\s-]/g, "");
  if (!raw) return { ok: true, prefix: null };
  if (!/^\d+$/.test(raw)) return { ok: false, error: "A GS1 Company Prefix is digits only." };
  if (raw.length < 4 || raw.length > 12) return { ok: false, error: "A GS1 Company Prefix is 4 to 12 digits long, as your GS1 office assigned it." };
  return { ok: true, prefix: raw };
}

/** How many SSCCs a prefix can number: the serial reference has 16 - prefix length digits. */
export const ssccCapacity = (prefix: string) => 10 ** (16 - prefix.length);

/** Build the SSCC for one serial reference. Throws when the serial no longer fits: never wraps round. */
export function buildSscc(extensionDigit: number, prefix: string, serial: number): string {
  if (!Number.isInteger(extensionDigit) || extensionDigit < 0 || extensionDigit > 9) throw new Error("The SSCC extension digit is one digit, 0-9.");
  const p = normaliseCompanyPrefix(prefix);
  if (p.ok === false) throw new Error(p.error);
  if (!p.prefix) throw new Error("No GS1 Company Prefix.");
  if (!Number.isInteger(serial) || serial < 0 || serial >= ssccCapacity(p.prefix)) {
    throw new Error(`Serial ${serial} does not fit a ${p.prefix.length}-digit company prefix (${ssccCapacity(p.prefix).toLocaleString("en")} SSCCs in all). Ask your GS1 office for another prefix.`);
  }
  const body = `${extensionDigit}${p.prefix}${String(serial).padStart(16 - p.prefix.length, "0")}`;
  return body + gs1CheckDigit(body);
}

/**
 * Read an SSCC typed or scanned: plain 18 digits, "(00)" + 18, or "00" + 18
 * (the raw scan). Spaces are ignored. The check digit must be right: a mistyped
 * SSCC is refused, not stored as a code that matches nothing.
 */
export function normaliseSscc(input: unknown): { ok: true; sscc: string } | { ok: false; error: string } {
  let s = String(input ?? "").replace(/\s/g, "");
  if (s.startsWith("(00)")) s = s.slice(4);
  else if (s.length === 20 && s.startsWith("00")) s = s.slice(2);
  if (!/^\d{18}$/.test(s)) return { ok: false, error: "An SSCC is 18 digits (the barcode under AI 00)." };
  const check = gs1CheckDigit(s.slice(0, SSCC_BODY));
  if (check !== Number(s[SSCC_BODY])) return { ok: false, error: `Check digit should be ${check}: this SSCC was mistyped or misread.` };
  return { ok: true, sscc: s };
}

/** The AI and the digits, as printed under a GS1-128 label. */
export const showSscc = (s: string) => `(00) ${s}`;

/* ------------------------------- Packing ------------------------------- */

export type PackLine = { id: string; qtyBase: number; packedQty: number; description?: string | null };
export type PackageInput = { packType?: unknown; parentId?: unknown; grossWeightKg?: unknown; contents?: { shipmentLineId?: unknown; qtyBase?: unknown }[] };
export type PreparedPackage = { packType: string; parentId: string | null; grossWeightKg: string | null; contents: { shipmentLineId: string; qtyBase: number }[] };

/**
 * Validate one new package against its shipment. `lines` carry what each line
 * shipped and what is already packed; `parents` are the packages it may sit on
 * (this shipment's, with their own parent). Everything is checked before an
 * SSCC is allocated, so a refusal never uses up a serial.
 */
export function preparePackage(
  input: PackageInput,
  lines: PackLine[],
  parents: { id: string; parentId: string | null }[],
): { ok: true; pkg: PreparedPackage } | { ok: false; error: string } {
  const packType = normalisePackType(input.packType as any);
  if (!packType) return { ok: false, error: "Choose what this package is (pallet, carton, case…)." };

  let parentId: string | null = null;
  if (input.parentId != null && String(input.parentId) !== "") {
    const parent = parents.find(p => p.id === String(input.parentId));
    if (!parent) return { ok: false, error: "That pallet is not on this shipment." };
    if (parent.parentId) return { ok: false, error: "A package can sit on a pallet, but not inside a carton that is itself on a pallet: one level only." };
    parentId = parent.id;
  }

  let grossWeightKg: string | null = null;
  if (input.grossWeightKg != null && String(input.grossWeightKg).trim() !== "") {
    const w = Number(input.grossWeightKg);
    if (!Number.isFinite(w) || w <= 0 || w > 99_999_999) return { ok: false, error: "Gross weight must be a positive number of kg." };
    grossWeightKg = (Math.round(w * 1000) / 1000).toFixed(3);
  }

  const byId = new Map(lines.map(l => [l.id, l]));
  const adding = new Map<string, number>();
  for (const c of input.contents ?? []) {
    const id = String(c?.shipmentLineId ?? "");
    if (!id && (c?.qtyBase == null || String(c.qtyBase).trim() === "")) continue;
    const line = byId.get(id);
    if (!line) return { ok: false, error: "A package can only hold lines of this shipment." };
    const qty = Number(c?.qtyBase);
    if (!Number.isFinite(qty) || qty <= 0) return { ok: false, error: `Enter a quantity above 0 for ${line.description || "each line"}.` };
    adding.set(id, (adding.get(id) ?? 0) + qty);
  }
  for (const [id, qty] of Array.from(adding)) {
    const l = byId.get(id)!;
    const left = l.qtyBase - l.packedQty;
    if (qty > left + QTY_EPSILON) {
      return { ok: false, error: `${l.description || "A line"}: ${qty} would be packed but only ${Math.max(0, Number(left.toFixed(6)))} of it is left unpacked on this shipment.` };
    }
  }
  return { ok: true, pkg: { packType, parentId, grossWeightKg, contents: Array.from(adding).map(([shipmentLineId, qtyBase]) => ({ shipmentLineId, qtyBase })) } };
}

/** Per line: shipped, packed, left. "Fully packed" when nothing is left (within the quantity epsilon). */
export function packingSummary(lines: { id: string; qtyBase: number }[], packed: { shipmentLineId: string; qtyBase: number }[]) {
  const done = new Map<string, number>();
  for (const p of packed) done.set(p.shipmentLineId, (done.get(p.shipmentLineId) ?? 0) + p.qtyBase);
  const rows = lines.map(l => ({ id: l.id, shipped: l.qtyBase, packed: done.get(l.id) ?? 0, left: Math.max(0, l.qtyBase - (done.get(l.id) ?? 0)) }));
  return { rows, fullyPacked: rows.every(r => r.left <= QTY_EPSILON) };
}
