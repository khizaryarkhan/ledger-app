/**
 * Hours over plan — the pure rules. No `db`.
 *
 * An enquiry asks a person why a month's hours do not match what was planned.
 * Two things decide whether one is worth opening, and both have a tempting
 * wrong answer:
 *
 *   WHEN. A month is assessed only once it has ENDED and settled. Assessing a
 *   month still in progress accuses people of being behind on work they have
 *   not finished, and assessing one with time still awaiting approval counts
 *   hours nobody has agreed to yet. A fallback day stops a single unapproved
 *   line holding a whole month hostage forever.
 *
 *   WHAT. Over plan is a variance; UNDER plan is not an enquiry. Someone who
 *   spent less than planned has not done anything that needs explaining, and
 *   a report that asks about both is a report nobody answers.
 */

/** Hours above plan worth asking about. Below this it is rounding, not a variance. */
export const VARIANCE_TOLERANCE = 0.5;

/** Days an open enquiry may sit unanswered before it is escalated. */
export const ESCALATE_AFTER_DAYS = 14;

export type VarianceKind = "over_plan" | "unplanned";

export interface Figures { planned: number; actual: number }

/**
 * Why this person-booking-month deserves an enquiry, or null when it does not.
 *
 * `unplanned` is kept apart from `over_plan` deliberately: "you spent 30 hours
 * on something with no plan at all" and "you spent 10 hours more than the 100
 * planned" are different conversations, and collapsing them would make the
 * first look like a rounding error against a zero baseline.
 */
export function kindFor({ planned, actual }: Figures, tolerance = VARIANCE_TOLERANCE): VarianceKind | null {
  if (actual <= tolerance) return null;
  if (planned <= tolerance) return "unplanned";
  return actual > planned + tolerance ? "over_plan" : null;
}

/** "2026-10" -> the first and last day of that month, as plain strings. */
export function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** The YYYY-MM a date falls in. */
export const monthOf = (date: string): string => date.slice(0, 7);

/** The month before `month`. */
export function previousMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

export interface Assessability {
  /** Last day of the month being assessed. */
  monthEnd: string;
  /** The day the assessor is running. */
  today: string;
  /** Is every non-rejected line this person has in the month already approved? */
  settled: boolean;
  /** Day of the FOLLOWING month after which the month is assessed regardless. */
  fallbackDay: number;
}

/**
 * May this person's month be assessed yet?
 *
 * Never before it has ended. Then as soon as their time is settled, or on the
 * fallback day whatever the state — without that, one line left unapproved
 * would keep a month out of the report indefinitely, which is the failure
 * mode of every "wait until it is clean" rule.
 */
export function isAssessable({ monthEnd, today, settled, fallbackDay }: Assessability): boolean {
  if (today <= monthEnd) return false;
  if (settled) return true;
  const [y, m] = monthEnd.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const cutoff = `${nextY}-${String(nextM).padStart(2, "0")}-${String(fallbackDay).padStart(2, "0")}`;
  return today >= cutoff;
}

/** An open enquiry nobody has answered for long enough to chase. */
export function shouldEscalate(openedOn: string, today: string, afterDays = ESCALATE_AFTER_DAYS): boolean {
  const [ty, tm, td] = today.split("-").map(Number);
  const [oy, om, od] = openedOn.split("-").map(Number);
  const days = (Date.UTC(ty, tm - 1, td) - Date.UTC(oy, om - 1, od)) / 86400000;
  return days >= afterDays;
}

export const bookingKey = (resourceId: string, assignableType: string, assignableId: string): string =>
  `${resourceId}|${assignableType}|${assignableId}`;

export interface Candidate {
  resourceId: string;
  assignableType: string;
  assignableId: string;
  planned: number;
  actual: number;
  kind: VarianceKind;
}

export interface BookingFigures extends Figures {
  resourceId: string;
  assignableType: string;
  assignableId: string;
}

/**
 * Every booking in the month that deserves an enquiry, worst variance first.
 *
 * Driven by what was LOGGED, not by what was planned: a plan nobody worked
 * against is an under-spend, which is not an enquiry.
 */
export function candidatesFor(
  figures: Iterable<BookingFigures>,
  tolerance = VARIANCE_TOLERANCE,
): Candidate[] {
  const out: Candidate[] = [];
  for (const f of figures) {
    const kind = kindFor(f, tolerance);
    if (!kind) continue;
    out.push({
      resourceId: f.resourceId, assignableType: f.assignableType, assignableId: f.assignableId,
      planned: Math.round(f.planned * 100) / 100, actual: Math.round(f.actual * 100) / 100, kind,
    });
  }
  return out.sort((a, b) => (b.actual - b.planned) - (a.actual - a.planned));
}
