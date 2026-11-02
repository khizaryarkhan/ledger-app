/**
 * Who has not handed a week in, and whose handed-in week is still waiting —
 * pure, no `db`.
 *
 * Two separate failures, and a week can be both:
 *
 *   NOT SUBMITTED  the hours handed in fall short of what that person was
 *                  contracted to work that week. A week with nothing on it, a
 *                  week sitting in draft and a week only partly handed in are
 *                  all the same failure in different sizes, so this reports
 *                  the SHORTFALL rather than a yes/no.
 *   NOT APPROVED   something was handed in and nobody has decided it yet.
 *                  That is the approver's failure, not the person's, which is
 *                  why it is counted apart rather than folded in.
 *
 * The expected figure is the person's own contracted capacity for that week
 * (Phase B), not a flat company-wide number: chasing a four-day person for
 * five days' hours is how a compliance report loses its audience. It already
 * nets off public holidays, so nobody is chased for a shutdown.
 *
 * Dates are YYYY-MM-DD strings compared as strings.
 */

/** Hours this far below expected are not worth anyone's attention. */
export const HOURS_TOLERANCE = 0.01;

/** How far back someone must have logged something to be worth chasing at all. */
export const ACTIVE_WITHIN_WEEKS = 8;

/** Handed in = the person has done their part, whatever the approver has done since. */
const HANDED_IN = new Set(["submitted", "approved", "posted"]);

export interface ComplianceEntry {
  resourceId: string;
  date: string;
  hours: number;
  status: string;
  /** A public-holiday line lands on everybody, so it is not evidence anyone is working. */
  isPublicHoliday: boolean;
}

export interface Expected {
  hours: number;
  /** Did dated contracted hours decide this, or a current-value column? (Phase B) */
  onRecord: boolean;
}

export interface PersonWeek {
  resourceId: string;
  name: string;
  weekStart: string;
  expected: number;
  submitted: number;
  awaitingApproval: number;
  shortBy: number;
  notSubmitted: boolean;
  notApproved: boolean;
  capacityOnRecord: boolean;
}

export interface Dormant {
  resourceId: string;
  name: string;
  lastLoggedOn: string | null;
}

export const weekKey = (resourceId: string, weekStart: string): string => `${resourceId}|${weekStart}`;

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ComplianceInput {
  /** Mondays, oldest first. */
  weeks: readonly string[];
  weekEndOf: (weekStart: string) => string;
  people: readonly { resourceId: string; name: string }[];
  entries: readonly ComplianceEntry[];
  expected: ReadonlyMap<string, Expected>;
  /** Each person's first ever logged day — nobody is chased for a week before they started. */
  startedOn: ReadonlyMap<string, string | null>;
  /** The window that decides whether someone is still active. */
  activeFrom: string;
}

export interface ComplianceResult {
  rows: PersonWeek[];
  dormant: Dormant[];
  /** People who were checked and had nothing outstanding. */
  clear: number;
}

/**
 * Build the report.
 *
 * Someone who has logged nothing but public holidays since `activeFrom` is
 * listed apart as dormant and produces no rows at all: a leaver whose login is
 * still enabled would otherwise head the chase list every week forever, which
 * is how a report like this stops being read.
 */
export function buildCompliance(input: ComplianceInput): ComplianceResult {
  const { weeks, weekEndOf, people, entries, expected, startedOn, activeFrom } = input;

  const byPerson = new Map<string, ComplianceEntry[]>();
  for (const e of entries) {
    const list = byPerson.get(e.resourceId) ?? [];
    list.push(e);
    byPerson.set(e.resourceId, list);
  }

  const rows: PersonWeek[] = [];
  const dormant: Dormant[] = [];
  let clear = 0;

  for (const person of people) {
    const mine = byPerson.get(person.resourceId) ?? [];
    const realWork = mine.filter((e) => !e.isPublicHoliday);

    const lastLoggedOn = realWork.reduce<string | null>((max, e) => (!max || e.date > max ? e.date : max), null);
    if (!lastLoggedOn || lastLoggedOn < activeFrom) {
      dormant.push({ resourceId: person.resourceId, name: person.name, lastLoggedOn });
      continue;
    }

    const started = startedOn.get(person.resourceId) ?? null;
    let flagged = false;

    for (const weekStart of weeks) {
      const weekEnd = weekEndOf(weekStart);
      // Before their first ever logged day there is nothing to hand in.
      if (started && weekEnd < started) continue;

      const exp = expected.get(weekKey(person.resourceId, weekStart));
      const expectedHours = exp?.hours ?? 0;

      let submitted = 0;
      let awaitingApproval = 0;
      for (const e of mine) {
        if (e.date < weekStart || e.date > weekEnd) continue;
        if (HANDED_IN.has(e.status)) submitted += e.hours;
        if (e.status === "submitted") awaitingApproval += e.hours;
      }

      const shortBy = Math.max(0, expectedHours - submitted);
      const notSubmitted = shortBy > HOURS_TOLERANCE;
      const notApproved = awaitingApproval > HOURS_TOLERANCE;
      if (!notSubmitted && !notApproved) continue;

      flagged = true;
      rows.push({
        resourceId: person.resourceId, name: person.name, weekStart,
        expected: r2(expectedHours), submitted: r2(submitted), awaitingApproval: r2(awaitingApproval),
        shortBy: r2(shortBy), notSubmitted, notApproved,
        capacityOnRecord: exp?.onRecord ?? false,
      });
    }

    if (!flagged) clear++;
  }

  rows.sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.name.localeCompare(b.name));
  dormant.sort((a, b) => a.name.localeCompare(b.name));
  return { rows, dormant, clear };
}
