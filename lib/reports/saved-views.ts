/**
 * Saved report views: a person's named choice of period, columns and compare-to for one report.
 * PURE — no db, no Date. A view stores only SETTINGS (flat string/number/boolean values), never
 * figures, and what is stored is untrusted when it comes back: the report page re-checks every value
 * against its own known options before applying it (`pickOption`, `pickDate`).
 */

export const MAX_VIEWS_PER_REPORT = 25;
export const MAX_PARAMS = 20;

export type ViewValue = string | number | boolean;
export type ViewParams = Record<string, ViewValue>;

const REPORT_KEY = /^[a-z0-9][a-z0-9:_-]{0,63}$/;
const PARAM_KEY = /^[A-Za-z][A-Za-z0-9_]{0,31}$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export interface ViewInput { reportKey: string; name: string; params: ViewParams }

export function isReportKey(v: unknown): v is string {
  return typeof v === "string" && REPORT_KEY.test(v);
}

/** Keeps only plain settings: bounded key count, safe key names, short strings. Anything else is dropped, not coerced. */
export function sanitizeParams(raw: unknown): ViewParams {
  const out: ViewParams = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PARAMS) break;
    if (!PARAM_KEY.test(k)) continue;
    if (typeof v === "string" && v.length <= 64) out[k] = v;
    else if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    else if (typeof v === "boolean") out[k] = v;
  }
  return out;
}

export function parseViewInput(body: unknown): { ok: true; value: ViewInput } | { ok: false; error: string } {
  const b = (body ?? {}) as Record<string, unknown>;
  if (!isReportKey(b.reportKey)) return { ok: false, error: "Unknown report." };
  const name = typeof b.name === "string" ? b.name.replace(/\s+/g, " ").trim() : "";
  if (!name) return { ok: false, error: "Give the view a name." };
  if (name.length > 80) return { ok: false, error: "Keep the name under 80 characters." };
  const params = sanitizeParams(b.params);
  if (Object.keys(params).length === 0) return { ok: false, error: "There is nothing to save in this view." };
  return { ok: true, value: { reportKey: b.reportKey, name, params } };
}

/** The stored value if it is one of the report's own options, else the fallback. */
export function pickOption<T extends string>(stored: unknown, allowed: readonly T[], fallback: T): T {
  return typeof stored === "string" && (allowed as readonly string[]).includes(stored) ? (stored as T) : fallback;
}

/** A stored date is applied only if it is a real calendar day written YYYY-MM-DD; otherwise the fallback. */
export function pickDate(stored: unknown, fallback: string): string {
  const m = typeof stored === "string" ? DATE_ONLY.exec(stored) : null;
  if (!m) return fallback;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return fallback;
  const leap = y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  return d <= days ? (stored as string) : fallback;
}

/** Case- and space-insensitive name key, so "Quarterly" and "quarterly " cannot both exist for one report. */
export const nameKey = (name: string): string => name.replace(/\s+/g, " ").trim().toLowerCase();
