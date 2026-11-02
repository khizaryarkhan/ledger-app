/**
 * Pure validation rules for People: designations, employee logins and
 * the manager field. Client-safe (no `db` import) so the routes and tests
 * share one definition.
 */

import { DESIGNATION_LEVELS, type DesignationLevel } from "./access";

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_DESIGNATION_NAME = 80;
export const MAX_DEPARTMENT = 80;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A login email: trimmed, lower-cased, shaped like an address. Null when it is not one. */
export function normaliseLoginEmail(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  if (!e || e.length > 255 || !EMAIL_RE.test(e)) return null;
  return e;
}

/** Null when acceptable, otherwise the message to show. */
export function passwordError(v: unknown): string | null {
  if (typeof v !== "string" || v.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (v.length > 128) return "Password is too long";
  return null;
}

/** Case- and whitespace-insensitive key for "unique per organisation". */
export function designationNameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export interface DesignationInput {
  name: string;
  accessLevel: DesignationLevel;
  sortOrder: number;
  status: "active" | "inactive";
}

// `error`/`value` are declared on both arms so callers can read them without
// discriminant narrowing (this repo does not compile with strictNullChecks).
type Parsed<T> =
  | { ok: true; value: T; error?: undefined }
  | { ok: false; error: string; value?: undefined };

/**
 * Validates a designation payload. With `partial`, only supplied fields are
 * checked and returned (PATCH); without it, `name` is required (POST).
 */
export function parseDesignation(body: unknown, partial: boolean): Parsed<Partial<DesignationInput>> {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const out: Partial<DesignationInput> = {};

  if (b.name !== undefined || !partial) {
    if (typeof b.name !== "string" || !b.name.trim()) return { ok: false, error: "name is required" };
    const name = b.name.trim().replace(/\s+/g, " ");
    if (name.length > MAX_DESIGNATION_NAME) return { ok: false, error: `name must be at most ${MAX_DESIGNATION_NAME} characters` };
    out.name = name;
  }
  if (b.accessLevel !== undefined) {
    // Checked against the one list in access.ts, so a new tier cannot be
    // added there and silently stay unacceptable here.
    if (!DESIGNATION_LEVELS.includes(b.accessLevel as DesignationLevel)) {
      return { ok: false, error: `accessLevel must be one of ${DESIGNATION_LEVELS.join(", ")}` };
    }
    out.accessLevel = b.accessLevel as DesignationLevel;
  } else if (!partial) {
    out.accessLevel = "self";
  }
  if (b.sortOrder !== undefined && b.sortOrder !== null && b.sortOrder !== "") {
    const n = Number(b.sortOrder);
    if (!Number.isInteger(n) || n < -9999 || n > 9999) return { ok: false, error: "sortOrder must be a whole number" };
    out.sortOrder = n;
  } else if (!partial) {
    out.sortOrder = 0;
  }
  if (b.status !== undefined) {
    if (b.status !== "active" && b.status !== "inactive") return { ok: false, error: "status must be 'active' or 'inactive'" };
    out.status = b.status;
  } else if (!partial) {
    out.status = "active";
  }
  return { ok: true, value: out };
}

/** Department: trimmed free text, blank = none. Null result with `error` set when too long. */
export function normaliseDepartment(v: unknown): { value: string | null; error?: string } {
  if (v == null) return { value: null };
  if (typeof v !== "string") return { value: null, error: "department must be text" };
  const d = v.trim();
  if (d.length > MAX_DEPARTMENT) return { value: null, error: `department must be at most ${MAX_DEPARTMENT} characters` };
  return { value: d || null };
}

/** Hide pay rates from anyone who is not an organisation admin. */
export function stripCostRate<T extends { costRatePerHour?: unknown }>(row: T, isAdmin: boolean): Omit<T, "costRatePerHour"> | T {
  if (isAdmin) return row;
  const { costRatePerHour: _hidden, ...rest } = row;
  return rest;
}
