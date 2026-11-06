/**
 * A person's personal, employment, emergency-contact and bank details
 * (pure, client-safe — the server half is personal-details-server.ts).
 *
 * Two kinds of field, and the difference is the whole point of this file:
 *  - PLAIN   stored as typed, returned as typed.
 *  - SECRET  national ID, tax number, bank account number, sort/routing code.
 *            Encrypted at rest (lib/crypto) and NEVER returned in full — a
 *            reader gets `{ set: true, last4: "1234" }`. Re-typing replaces
 *            it; an empty string clears it; leaving it out keeps it. Nobody
 *            can read a full account number back through the app, so a
 *            leaked admin session cannot either.
 */

export const PLAIN_FIELDS = [
  // Personal
  "preferredName", "dateOfBirth", "gender", "maritalStatus", "nationality",
  "personalEmail", "personalPhone",
  "addressLine1", "addressLine2", "city", "region", "postcode", "country",
  // Employment
  "employeeNumber", "jobTitle", "employmentType", "startDate", "endDate",
  // Emergency contact
  "emergencyName", "emergencyRelationship", "emergencyPhone", "emergencyEmail",
  // Bank (the non-secret parts)
  "bankAccountName", "bankName", "bankSwift",
] as const;

export const SECRET_FIELDS = ["nationalId", "taxNumber", "bankAccountNumber", "bankSortCode"] as const;

/**
 * What a person may NOT change about themselves (self-service): their
 * employment record. Job title, number, type and dates are the employer's
 * statements, not the employee's — a person who could edit their own start
 * date could edit their own service length.
 */
export const SELF_LOCKED_FIELDS = ["employeeNumber", "jobTitle", "employmentType", "startDate", "endDate"] as const;

export type PlainField = (typeof PLAIN_FIELDS)[number];
export type SecretField = (typeof SECRET_FIELDS)[number];

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contractor", "temporary", "intern"] as const;
export const EMPLOYMENT_TYPE_LABEL: Record<string, string> = {
  full_time: "Full-time", part_time: "Part-time", contractor: "Contractor", temporary: "Temporary", intern: "Intern",
};

const DATE_FIELDS: ReadonlySet<string> = new Set(["dateOfBirth", "startDate", "endDate"]);
const EMAIL_FIELDS: ReadonlySet<string> = new Set(["personalEmail", "emergencyEmail"]);
const MAX_LEN = 160;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface MaskedSecret { set: boolean; last4: string | null }

/** "GB29NWBK60161331926819" → { set: true, last4: "6819" }. Short values reveal nothing. */
export function maskSecret(plain: string | null | undefined): MaskedSecret {
  const v = (plain ?? "").replace(/\s+/g, "");
  if (!v) return { set: false, last4: null };
  return { set: true, last4: v.length > 6 ? v.slice(-4) : null };
}

export type DetailsPatch = Partial<Record<PlainField, string | null>> & Partial<Record<SecretField, string | null>>;

/**
 * Validate a request body into a patch. Keys not present are left alone;
 * "" and null clear. Unknown keys are ignored, never stored.
 * `today` is passed in (YYYY-MM-DD) so a date of birth in the future is refused
 * without this module reading a clock.
 */
export function parseDetailsPatch(body: Record<string, unknown>, today: string): { error: string } | { patch: DetailsPatch } {
  const patch: DetailsPatch = {};
  const src = body ?? {};
  for (const key of [...PLAIN_FIELDS, ...SECRET_FIELDS] as string[]) {
    if (!(key in src)) continue;
    const raw = src[key];
    if (raw === null || raw === "") { (patch as any)[key] = null; continue; }
    if (typeof raw !== "string") return { error: `${key} must be text.` };
    const v = raw.trim();
    if (!v) { (patch as any)[key] = null; continue; }
    if (v.length > MAX_LEN) return { error: `${key} is longer than ${MAX_LEN} characters.` };
    if (DATE_FIELDS.has(key) && !DATE_RE.test(v)) return { error: `${key} must be a date (YYYY-MM-DD).` };
    if (EMAIL_FIELDS.has(key) && !EMAIL_RE.test(v)) return { error: `${key} is not a valid email address.` };
    if (key === "employmentType" && !(EMPLOYMENT_TYPES as readonly string[]).includes(v)) return { error: "Unknown employment type." };
    (patch as any)[key] = v;
  }
  if (patch.dateOfBirth && patch.dateOfBirth > today) return { error: "Date of birth cannot be in the future." };
  return { patch };
}

/** End date before start date, checked against the stored values the patch leaves in place. */
export function datesOutOfOrder(start: string | null | undefined, end: string | null | undefined): boolean {
  return !!start && !!end && end < start;
}
