/**
 * Customer delivery addresses (0141), the pure half (client-safe; no db). The
 * server half is lib/customer-ship-to-server.ts.
 *
 * A delivery address is a place a customer takes delivery: a store, a
 * distribution centre. Its address fields follow lib/address-fields.ts (the
 * same rules as stock locations), plus a name, the CUSTOMER's own code for the
 * place (their EDI order may send it instead of a GLN), and a contact.
 */

import { addressValues, type AddressInput, type AddressValues } from "@/lib/address-fields";

export const SHIP_TO_LIMITS = { name: 128, code: 32, contactName: 128, contactPhone: 64 } as const;

export type ShipToValues = AddressValues & {
  name?: string; code?: string | null; contactName?: string | null; contactPhone?: string | null;
  isDefault?: boolean; status?: "Active" | "Inactive";
};

/** The customer's location code compares case-insensitively, spaces collapsed (matches the index on upper(code)). */
export const shipToCodeKey = (code: string) => code.trim().replace(/\s+/g, " ").toUpperCase();

/**
 * Columns to write from a request body. Absent fields are left out, so an edit
 * that does not mention one leaves it alone; empty clears it. A name is
 * required on create and may never be cleared.
 */
export function shipToValues(b: (AddressInput & Record<string, unknown>) | null | undefined, opts: { creating: boolean }): { values: ShipToValues } | { error: string } {
  const a = addressValues(b);
  if ("error" in a) return a;
  const values: ShipToValues = { ...a.values };
  const text = (k: keyof typeof SHIP_TO_LIMITS, label: string) => {
    const raw = b?.[k];
    if (raw === undefined) return null;
    const v = raw === null ? "" : String(raw).trim().replace(/\s+/g, " ");
    if (v.length > SHIP_TO_LIMITS[k]) return `${label} must be ${SHIP_TO_LIMITS[k]} characters or fewer.`;
    (values as any)[k] = v || null;
    return null;
  };
  const e = text("name", "Name") ?? text("code", "Customer's location code") ?? text("contactName", "Contact name") ?? text("contactPhone", "Contact phone");
  if (e) return { error: e };
  if (values.code && /[\u0000-\u001f\u007f]/.test(values.code)) return { error: "Customer's location code can't contain control characters." };
  if (opts.creating && !values.name) return { error: "Give the delivery address a name, e.g. \"Dublin DC\"." };
  if (!opts.creating && b?.name !== undefined && !values.name) return { error: "A delivery address needs a name." };
  if (values.name === null) delete values.name;
  if (b?.isDefault !== undefined) values.isDefault = b.isDefault === true;
  if (b?.status !== undefined) {
    if (b.status !== "Active" && b.status !== "Inactive") return { error: "Status must be Active or Inactive." };
    values.status = b.status;
  }
  // An inactive address can't be the one used by default.
  if (values.status === "Inactive" && values.isDefault) return { error: "An inactive delivery address can't be the default." };
  return { values };
}

/** Address read back on one line for pickers and lists. */
export function shipToOneLine(r: { name?: string | null; addressStreet?: string | null; addressCity?: string | null; addressPostcode?: string | null; countryCode?: string | null }): string {
  const place = [r.addressStreet, r.addressCity, r.addressPostcode, r.countryCode].filter(Boolean).join(", ");
  return place ? `${r.name ?? ""} · ${place}` : r.name ?? "";
}

/** Address as printed lines (a document's ship-to box). */
export function shipToLines(r: { addressStreet?: string | null; addressLine2?: string | null; addressCity?: string | null; addressState?: string | null; addressPostcode?: string | null; countryCode?: string | null; gln?: string | null }): string[] {
  return [
    r.addressStreet, r.addressLine2,
    [r.addressCity, r.addressState, r.addressPostcode].filter(Boolean).join(" "),
    r.countryCode, r.gln ? `GLN ${r.gln}` : null,
  ].filter((x): x is string => !!x && x.trim() !== "");
}
