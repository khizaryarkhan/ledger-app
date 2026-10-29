/**
 * The customer-only fields on the shared party form (components/party-drawer.tsx):
 * collections risk, status, credit limit, payment method and the org-managed
 * country. Pure — no `db` import — so the create and edit routes validate them
 * identically and the rules are testable without a database.
 *
 * A key that is absent from the body is absent from `values`, so PATCH leaves
 * that column alone and POST falls through to the column default.
 */

export const RISK_RATINGS = ["Low", "Medium", "High"] as const;
export const CUSTOMER_STATUSES = ["Active", "On Hold", "Inactive"] as const;

export type CustomerExtras = {
  riskRating?: (typeof RISK_RATINGS)[number];
  status?: (typeof CUSTOMER_STATUSES)[number];
  creditLimit?: number | null;
  paymentMethod?: string | null;
  countryId?: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const blank = (v: unknown) => v == null || String(v).trim() === "";

export function customerExtras(body: Record<string, unknown> | null | undefined):
  { values: CustomerExtras } | { error: string } {
  const b = body ?? {};
  const values: CustomerExtras = {};

  if (b.riskRating !== undefined) {
    if (!RISK_RATINGS.includes(b.riskRating as never)) return { error: "Risk rating must be Low, Medium or High." };
    values.riskRating = b.riskRating as CustomerExtras["riskRating"];
  }
  if (b.status !== undefined) {
    if (!CUSTOMER_STATUSES.includes(b.status as never)) return { error: "Status must be Active, On Hold or Inactive." };
    values.status = b.status as CustomerExtras["status"];
  }
  if (b.creditLimit !== undefined) {
    if (blank(b.creditLimit)) values.creditLimit = null;
    else {
      const n = Number(b.creditLimit);
      if (!Number.isFinite(n) || n < 0) return { error: "Credit limit must be a number of zero or more." };
      values.creditLimit = n;
    }
  }
  if (b.paymentMethod !== undefined) {
    values.paymentMethod = blank(b.paymentMethod) ? null : String(b.paymentMethod).trim().slice(0, 64);
  }
  if (b.countryId !== undefined) {
    if (blank(b.countryId)) values.countryId = null;
    else if (!UUID.test(String(b.countryId))) return { error: "Country is not valid." };
    else values.countryId = String(b.countryId);
  }
  return { values };
}
