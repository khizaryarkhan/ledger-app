/**
 * Timesheet LINES — the pure rules behind the weekly grid (client-safe, no db).
 *
 * A line is one booking (timesheet type + project / order) in ONE status. A
 * week's time is stored as one entry per person, booking and day; a line is
 * those entries grouped by booking AND status. That second part is what makes
 * a line split: the person submits Mon–Fri on one line, the approver approves
 * Mon–Wed and returns Thu–Fri, and the grid now shows two lines for that
 * booking — Approved (Mon–Wed) and Rejected (Thu–Fri) — instead of one line
 * reading "Mixed". Each line has one status, so each line has one set of
 * actions: a Rejected line can be corrected and resubmitted while the Approved
 * one beside it stays locked.
 *
 * Nothing here is specific to any organisation: types, projects and orders are
 * whatever the org has set up.
 */

import { addDays } from "@/lib/accounting/report-periods";

export interface LineEntry {
  id: string;
  date: string;
  hours: string | number;
  timesheetTypeId: string;
  assignableType: string | null;
  assignableId: string | null;
  status: string;
  rejectedReason?: string | null;
}

export interface Booking { typeId: string; aType: string | null; aId: string | null }

export interface TimesheetLine extends Booking {
  /** Unique per line: booking + status. */
  key: string;
  bookingKey: string;
  /** The line's status, or "new" for a line added but not yet given any hours. */
  status: string;
  entries: LineEntry[];
}

/** Draft first (the line being worked on), then what still needs action, then what is settled. */
export const LINE_STATUS_ORDER = ["draft", "rejected", "submitted", "approved", "posted"] as const;

export const bookingKey = (b: Booking): string => `${b.typeId}|${b.aType ?? ""}|${b.aId ?? ""}`;
export const lineKey = (b: Booking, status: string): string => `${bookingKey(b)}#${status}`;
export const bookingOf = (e: LineEntry): Booking => ({ typeId: e.timesheetTypeId, aType: e.assignableType, aId: e.assignableId });

/**
 * Group a week's entries into lines. `added` are bookings the person added with
 * Add Line that have no hours yet; each shows as a "new" line unless that
 * booking already has a Draft line to type into. Order: bookings in the order
 * first seen (entries, then added), statuses in LINE_STATUS_ORDER.
 */
export function buildLines(entries: readonly LineEntry[], added: readonly Booking[] = []): TimesheetLine[] {
  const bookingOrder: string[] = [];
  const bookings = new Map<string, Booking>();
  const byLine = new Map<string, TimesheetLine>();
  const note = (b: Booking) => {
    const bk = bookingKey(b);
    if (!bookings.has(bk)) { bookings.set(bk, b); bookingOrder.push(bk); }
    return bk;
  };
  for (const e of entries) {
    const b = bookingOf(e);
    const bk = note(b);
    const k = lineKey(b, e.status);
    let line = byLine.get(k);
    if (!line) { line = { ...b, key: k, bookingKey: bk, status: e.status, entries: [] }; byLine.set(k, line); }
    line.entries.push(e);
  }
  for (const b of added) {
    const bk = note(b);
    if (!byLine.has(lineKey(b, "draft")) && !byLine.has(lineKey(b, "new"))) {
      byLine.set(lineKey(b, "new"), { ...b, key: lineKey(b, "new"), bookingKey: bk, status: "new", entries: [] });
    }
  }
  const rank = (s: string) => (s === "new" ? -1 : (LINE_STATUS_ORDER as readonly string[]).indexOf(s) === -1 ? 99 : (LINE_STATUS_ORDER as readonly string[]).indexOf(s));
  const out: TimesheetLine[] = [];
  for (const bk of bookingOrder) {
    const lines = Array.from(byLine.values()).filter((l) => l.bookingKey === bk);
    lines.sort((a, b) => rank(a.status) - rank(b.status));
    out.push(...lines);
  }
  return out;
}

/** Can this line take new hours typed into an empty day? Only a Draft (or new) line. */
export function lineAcceptsNewHours(line: Pick<TimesheetLine, "status">): boolean {
  return line.status === "draft" || line.status === "new";
}

/** Can an existing cell on this line be edited? Draft and Rejected, the statuses the owner still holds. */
export function lineIsEditable(line: Pick<TimesheetLine, "status">): boolean {
  return line.status === "draft" || line.status === "rejected" || line.status === "new";
}

// ── Bulk actions over ticked lines ───────────────────────────────────────────

export const LINE_ACTIONS = ["submit", "recall", "delete"] as const;
export type LineAction = (typeof LINE_ACTIONS)[number];

/** Which statuses each action applies to. Anything else in a selection is skipped, so a mixed selection is safe. */
const APPLIES: Record<LineAction, readonly string[]> = {
  submit: ["draft", "rejected"],
  // Only what nobody has decided yet: an approved line is never recalled.
  recall: ["submitted"],
  delete: ["draft", "rejected"],
};

export function actionAppliesTo(action: LineAction, status: string): boolean {
  return APPLIES[action].includes(status);
}

export function isLineAction(v: unknown): v is LineAction {
  return typeof v === "string" && (LINE_ACTIONS as readonly string[]).includes(v);
}

/**
 * Split a selection into the entries the action applies to and the rest. Only
 * the person's OWN entries are ever considered — someone else's id in the list
 * is counted as skipped, never acted on.
 */
export function planLineAction<E extends { id: string; status: string; resourceId: string }>(
  action: LineAction, entries: readonly E[], ownerId: string,
): { apply: E[]; skipped: number } {
  const apply: E[] = [];
  let skipped = 0;
  for (const e of entries) {
    if (e.resourceId === ownerId && actionAppliesTo(action, e.status)) apply.push(e); else skipped++;
  }
  return { apply, skipped };
}

/** "3 lines submitted, 1 skipped" — what the person reads after a bulk action. */
export function summariseAction(action: LineAction, done: number, skipped: number, failed: number): string {
  const verb = action === "submit" ? "submitted" : action === "recall" ? "recalled to Draft" : "deleted";
  const parts = [`${done} ${done === 1 ? "entry" : "entries"} ${verb}`];
  if (skipped) parts.push(`${skipped} skipped (not in a state that allows it)`);
  if (failed) parts.push(`${failed} failed`);
  return parts.join(", ");
}

// ── Copy Week ────────────────────────────────────────────────────────────────

export const COPY_WEEKS_BACK = 4;

export interface CopyType { id: string; category: string; status: string }

export interface CopyRow extends Booking {
  key: string;
  /** Hours per weekday, Monday = 0. */
  days: number[];
  hours: number;
}

/**
 * The lines Copy Week may bring forward from an earlier week: one row per
 * booking, with the hours per weekday. Leave never copies (a holiday last week
 * is not one this week), nor does a type that has since been retired, nor a
 * returned line — the approver said those hours were wrong.
 */
export function copyableRows(
  source: readonly LineEntry[], sourceWeekStart: string, types: readonly CopyType[],
): CopyRow[] {
  const typeById = new Map(types.map((t) => [t.id, t]));
  const rows = new Map<string, CopyRow>();
  for (const e of source) {
    if (e.status === "rejected") continue;
    const t = typeById.get(e.timesheetTypeId);
    if (!t || t.status !== "active" || t.category === "leave") continue;
    const day = dayIndexFrom(sourceWeekStart, e.date);
    if (day < 0 || day > 6) continue;
    const b = bookingOf(e);
    const k = bookingKey(b);
    let r = rows.get(k);
    if (!r) { r = { ...b, key: k, days: [0, 0, 0, 0, 0, 0, 0], hours: 0 }; rows.set(k, r); }
    const h = Number(e.hours) || 0;
    r.days[day] = round2(r.days[day] + h);
    r.hours = round2(r.hours + h);
  }
  return Array.from(rows.values());
}

/**
 * The entries to create in the target week from the ticked rows. A day that
 * already has time on the same booking this week is skipped, so pressing Copy
 * twice never doubles a week.
 */
export function copyPlan(
  rows: readonly CopyRow[], picked: readonly string[], targetWeekStart: string, existing: readonly LineEntry[],
): { create: { date: string; hours: number; booking: Booking }[]; skipped: number } {
  const want = new Set(picked);
  const taken = new Set(existing.map((e) => `${bookingKey(bookingOf(e))}@${e.date}`));
  const create: { date: string; hours: number; booking: Booking }[] = [];
  let skipped = 0;
  for (const r of rows) {
    if (!want.has(r.key)) continue;
    r.days.forEach((h, i) => {
      if (!h) return;
      const date = addDays(targetWeekStart, i);
      if (taken.has(`${r.key}@${date}`)) { skipped++; return; }
      create.push({ date, hours: h, booking: { typeId: r.typeId, aType: r.aType, aId: r.aId } });
    });
  }
  return { create, skipped };
}

function dayIndexFrom(weekStart: string, date: string): number {
  for (let i = 0; i < 7; i++) if (addDays(weekStart, i) === date) return i;
  return -1;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
