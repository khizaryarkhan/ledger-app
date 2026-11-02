/**
 * Time-entry rules that need no database — the state machine, input checks and
 * week arithmetic. Client-safe (no `db` import) so the weekly grid and the
 * server share one definition.
 *
 * Dates are plain YYYY-MM-DD strings throughout ("a date is a date"): weekday
 * and month-length maths use Date.UTC numbers, never a Date built from the
 * string.
 */

import { canApproveEntry, leadForEntry, type ApprovableEntry, type Actor, type PersonNode } from "./access";
import { addDays } from "@/lib/accounting/report-periods";

export const TIME_ENTRY_STATUSES = ["draft", "submitted", "approved", "rejected", "posted"] as const;
export type TimeEntryStatus = (typeof TIME_ENTRY_STATUSES)[number];

/** Most hours one person can log against one calendar day. */
export const MAX_HOURS_PER_DAY = 24;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date, not just a well-shaped string (2026-02-31 is refused). */
export function isRealDate(s: unknown): s is string {
  if (typeof s !== "string") return false;
  const m = DATE_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate();
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const sundayFirst = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return (sundayFirst + 6) % 7;
}

/** The Monday of the week containing `date`. */
export function weekStartOf(date: string): string {
  return addDays(date, -weekdayIndex(date));
}

/** The seven dates, Monday first, of the week containing `date`. */
export function weekDates(date: string): string[] {
  const start = weekStartOf(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** Entries the owner may still change: nothing is locked until it is submitted. */
export function isEditableStatus(status: string): boolean {
  return status === "draft" || status === "rejected";
}

export function isSubmittableStatus(status: string): boolean {
  return status === "draft" || status === "rejected";
}

export function isDecidableStatus(status: string): boolean {
  return status === "submitted";
}

/** Hours must be a positive number, at most a day, and at most 2dp of meaning. */
export function parseHours(v: unknown): { ok: true; hours: number } | { ok: false; error: string } {
  const h = typeof v === "string" ? Number(v.trim()) : Number(v);
  if (v === null || v === undefined || v === "" || !Number.isFinite(h)) return { ok: false, error: "hours must be a number" };
  if (h <= 0) return { ok: false, error: "hours must be a positive number" };
  if (h > MAX_HOURS_PER_DAY) return { ok: false, error: `hours cannot exceed ${MAX_HOURS_PER_DAY} in a day` };
  return { ok: true, hours: Math.round(h * 100) / 100 };
}

/** Would adding `adding` hours to what is already logged push the day past 24? */
export function exceedsDay(existingHours: number, adding: number): boolean {
  return Math.round((existingHours + adding) * 100) / 100 > MAX_HOURS_PER_DAY;
}

/** Reasons are required to reject: trimmed, non-empty, bounded. */
export function parseReason(v: unknown): { ok: true; reason: string } | { ok: false; error: string } {
  const reason = String(v ?? "").trim();
  if (!reason) return { ok: false, error: "A reason is required" };
  return { ok: true, reason: reason.slice(0, 1000) };
}

export type Decision = { ok: true } | { ok: false; error: string; status: number };

/**
 * May `actor` approve or reject this entry right now? One rule for both.
 *
 * `leadOfProject` maps a project id to the resource who leads it, and is
 * REQUIRED rather than optional on purpose: a caller that forgot to pass it
 * would silently fall back to the line manager and route approval to the wrong
 * person, which is the exact bug this parameter exists to prevent.
 */
export function decideEntry(
  actor: Actor,
  entry: ApprovableEntry & { status: string },
  people: readonly PersonNode[],
  leadOfProject: ReadonlyMap<string, string>,
): Decision {
  if (!isDecidableStatus(entry.status)) {
    return { ok: false, error: "Only a Submitted entry can be approved or rejected", status: 409 };
  }
  if (!canApproveEntry(actor, entry, people, leadOfProject)) {
    // Say which rule refused: "you are not their manager" and "this project has
    // its own lead" send the person to two different places to get unstuck.
    const lead = leadForEntry(entry, leadOfProject);
    return {
      ok: false,
      error: lead
        ? "Time booked to a project is approved by that project's lead."
        : "You cannot approve this person's time",
      status: 403,
    };
  }
  return { ok: true };
}
