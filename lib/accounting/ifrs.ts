/**
 * IFRS presentation helpers — pure, no `db` import (same split as
 * account-roles.ts/account-roles-server.ts, modules.ts/modules-server.ts).
 *
 * These classify an account by its `subtype` string into IFRS-specific
 * groupings that sit ON TOP of the existing QBO-modeled Type/Classification
 * taxonomy in account-types.ts, rather than replacing it:
 *   - Other Comprehensive Income (OCI) reserve accounts — revaluation,
 *     translation and fair-value movements that bypass profit or loss
 *     (IAS 1 / IFRS 9) but still move equity.
 *   - Equity distributions — owner's drawings, partner distributions,
 *     dividends — reductions of equity that are not expenses.
 *   - Provisions (IAS 37) — liabilities of uncertain timing/amount, shown
 *     as their own Balance Sheet line rather than lumped into "other"
 *     current/non-current liabilities.
 *
 * `place()` in financials.ts still routes every one of these subtypes to
 * its ordinary section (Equity / Current or Non-current Liabilities) for
 * GL/statement placement — a QBO/Xero-synced account is completely
 * unaffected either way. This module only changes how a NATIVE org's own
 * Statement of Comprehensive Income, Statement of Changes in Equity and
 * Balance Sheet choose to PRESENT an account that already carries one of
 * these subtypes.
 */

export const OCI_RESERVE_SUBTYPES = [
  "Revaluation Surplus",
  "Foreign Currency Translation Reserve",
  "Fair Value Reserve",
] as const;

/** General Reserve is an appropriation of retained profit, not an OCI item — tracked separately so it isn't double-counted as "comprehensive income". */
export const OTHER_RESERVE_SUBTYPES = ["General Reserve"] as const;

export const EQUITY_DISTRIBUTION_SUBTYPES = [
  "Owner's Drawings",
  "Partner Distributions",
  "Dividends Paid",
] as const;

export const SHARE_CAPITAL_SUBTYPES = [
  "Share Capital",
  "Common Stock",
  "Paid-in Capital",
  "Share Premium",
  "Owner's Equity",
  "Partner Contributions",
] as const;

export const RETAINED_EARNINGS_SUBTYPES = [
  "Retained Earnings",
  "Opening Balance Equity",
] as const;

export const PROVISION_SUBTYPES = ["Provisions"] as const;

const norm = (s: string | null | undefined): string => (s ?? "").trim().toLowerCase();
const matches = (subtype: string | null | undefined, list: readonly string[]): boolean =>
  list.some((s) => norm(s) === norm(subtype));

export function isOciReserve(subtype: string | null | undefined): boolean {
  return matches(subtype, OCI_RESERVE_SUBTYPES);
}
export function isOtherReserve(subtype: string | null | undefined): boolean {
  return matches(subtype, OTHER_RESERVE_SUBTYPES);
}
export function isEquityDistribution(subtype: string | null | undefined): boolean {
  return matches(subtype, EQUITY_DISTRIBUTION_SUBTYPES);
}
export function isShareCapital(subtype: string | null | undefined): boolean {
  return matches(subtype, SHARE_CAPITAL_SUBTYPES);
}
export function isRetainedEarningsAccount(subtype: string | null | undefined): boolean {
  return matches(subtype, RETAINED_EARNINGS_SUBTYPES);
}
export function isProvision(subtype: string | null | undefined): boolean {
  return matches(subtype, PROVISION_SUBTYPES);
}

/**
 * Which Statement of Changes in Equity category an equity account's own
 * (non-profit, non-OCI) balance belongs to. Falls back to "shareCapital"
 * for any equity subtype this file doesn't name explicitly (e.g. a custom
 * subtype, or none set) — the same "best-effort default, never a crash"
 * posture place() uses, since every equity account has to land SOMEWHERE
 * on the statement.
 */
export type EquityCategory = "shareCapital" | "retainedEarnings" | "otherReserves" | "distributions";
export function equityCategory(subtype: string | null | undefined): EquityCategory {
  if (isRetainedEarningsAccount(subtype)) return "retainedEarnings";
  if (isOciReserve(subtype) || isOtherReserve(subtype)) return "otherReserves";
  if (isEquityDistribution(subtype)) return "distributions";
  return "shareCapital";
}
