/**
 * The assessor behind hours-over-plan enquiries.
 *
 * Safe to re-run: every enquiry is keyed (org, person, booking, month) by a
 * unique index and inserted with ON CONFLICT DO NOTHING, so the nightly job
 * has no state of its own to keep and a replay cannot duplicate anything.
 *
 * Planned hours come from Phase B's capacity-aware `plannedHours`, so this
 * agrees with the Utilization and Compliance reports by construction.
 */

import { db } from "@/db";
import { resourceAssignments, timeEntries, hoursVarianceEnquiries } from "@/db/schema";
import { and, eq, gte, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { loadCalendars } from "./reports-server";
import { loadPeople } from "./access-server";
import { leadsForProjects } from "./approval-server";
import { notify, loginsForResources } from "@/lib/notifications/notify";
import { plannedHours, type AssignmentRow } from "./reports";
import {
  candidatesFor, monthRange, shouldEscalate, bookingKey,
  type BookingFigures, type Candidate,
} from "./variance";

/** Day of the following month after which a month is assessed regardless. */
export const FALLBACK_DAY = 10;

/** Time the person has not finished with: still theirs to change or hand in. */
const UNSETTLED = ["draft", "submitted"];
/** Time everyone has agreed to — the only kind that counts as actual. */
const COUNTED = ["approved", "posted"];

export interface AssessStats {
  month: string;
  people: number;
  assessed: number;
  notReady: number;
  opened: number;
  existing: number;
  withoutOwner: number;
}

/**
 * Open enquiries for one org and one month.
 *
 * `today` is passed in rather than read here so the caller decides what "now"
 * means — the job passes UTC today (it runs with no viewer), and a test passes
 * whatever it likes.
 */
export async function assessMonth(
  orgId: string, month: string, today: string, opts: { dryRun?: boolean } = {},
): Promise<AssessStats> {
  const { from, to } = monthRange(month);
  const stats: AssessStats = { month, people: 0, assessed: 0, notReady: 0, opened: 0, existing: 0, withoutOwner: 0 };

  const people = (await loadPeople(orgId)).filter((p) => p.status === "active");
  stats.people = people.length;
  if (people.length === 0) return stats;
  const ids = people.map((p) => p.id);

  // Never assess a month that has not ended: it would accuse people of being
  // behind on work they have not finished.
  if (today <= to) {
    stats.notReady = people.length;
    return stats;
  }

  const entryRows = await db.select({
    resourceId: timeEntries.resourceId, hours: timeEntries.hours, status: timeEntries.status,
    assignableType: timeEntries.assignableType, assignableId: timeEntries.assignableId,
  }).from(timeEntries).where(and(
    eq(timeEntries.orgId, orgId), inArray(timeEntries.resourceId, ids),
    gte(timeEntries.date, from), lte(timeEntries.date, to),
  ));

  // Settled for a person = nothing of theirs in the month is still draft or
  // awaiting a decision. Per person, not per org: one straggler must not hold
  // everybody else's month back.
  const unsettled = new Set<string>();
  for (const e of entryRows) if (UNSETTLED.includes(e.status)) unsettled.add(e.resourceId);

  const [y, m] = month.split("-").map(Number);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const fallbackReached = today >= `${nextY}-${String(nextM).padStart(2, "0")}-${String(FALLBACK_DAY).padStart(2, "0")}`;

  const ready = people.filter((p) => !unsettled.has(p.id) || fallbackReached);
  stats.assessed = ready.length;
  stats.notReady = people.length - ready.length;
  if (ready.length === 0) return stats;

  const readyIds = new Set(ready.map((p) => p.id));

  // Actual: agreed time only, on a real booking.
  const actual = new Map<string, BookingFigures>();
  for (const e of entryRows) {
    if (!readyIds.has(e.resourceId)) continue;
    if (!COUNTED.includes(e.status)) continue;
    if (!e.assignableType || !e.assignableId) continue;
    const key = bookingKey(e.resourceId, e.assignableType, e.assignableId);
    const cur = actual.get(key) ?? {
      resourceId: e.resourceId, assignableType: e.assignableType, assignableId: e.assignableId, planned: 0, actual: 0,
    };
    cur.actual += Number(e.hours) || 0;
    actual.set(key, cur);
  }
  if (actual.size === 0) return stats;

  // Planned: the same capacity-aware figure every other report uses.
  const [{ calendars }, assignmentRows] = await Promise.all([
    loadCalendars(orgId, Array.from(readyIds)),
    db.select().from(resourceAssignments).where(and(
      eq(resourceAssignments.orgId, orgId),
      inArray(resourceAssignments.resourceId, Array.from(readyIds)),
      ne(resourceAssignments.status, "cancelled"),
      lte(resourceAssignments.startDate, to),
      or(isNull(resourceAssignments.endDate), gte(resourceAssignments.endDate, from)),
    )),
  ]);

  for (const a of assignmentRows) {
    const key = bookingKey(a.resourceId, a.assignableType, a.assignableId);
    const fig = actual.get(key);
    if (!fig) continue; // planned but never worked = an under-spend, not an enquiry
    const cal = calendars.get(a.resourceId);
    if (!cal) continue;
    const row: AssignmentRow = {
      resourceId: a.resourceId, assignableType: a.assignableType, assignableId: a.assignableId,
      startDate: a.startDate, endDate: a.endDate,
      allocationPercent: Number(a.allocationPercent) || 0, status: a.status,
    };
    fig.planned += plannedHours(row, cal, { from, to });
  }

  const candidates = candidatesFor(actual.values());
  if (candidates.length === 0) return stats;

  const owners = await ownersFor(orgId, candidates, people);
  stats.withoutOwner = candidates.filter((c) => !owners.get(ownerKey(c))).length;
  if (opts.dryRun) { stats.opened = candidates.length; return stats; }

  const inserted = await db.insert(hoursVarianceEnquiries).values(candidates.map((c) => ({
    orgId, resourceId: c.resourceId, assignableType: c.assignableType, assignableId: c.assignableId,
    month, kind: c.kind,
    plannedHours: c.planned.toFixed(2), actualHours: c.actual.toFixed(2),
    assignedTo: owners.get(ownerKey(c)) ?? null,
  }))).onConflictDoNothing().returning({
    id: hoursVarianceEnquiries.id, resourceId: hoursVarianceEnquiries.resourceId,
    assignedTo: hoursVarianceEnquiries.assignedTo, kind: hoursVarianceEnquiries.kind,
  });

  // Tell whoever must answer. Only for enquiries opened NOW (a re-run inserts
  // nothing, so it notifies nothing), and never able to fail the assessment.
  const answerers = Array.from(new Set(inserted.map((r) => r.assignedTo).filter((x): x is string => !!x)));
  const logins = await loginsForResources(orgId, answerers).catch(() => new Map<string, string>());
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  await notify(orgId, inserted.flatMap((r) => {
    const login = r.assignedTo ? logins.get(r.assignedTo) : undefined;
    if (!login) return [];
    const who = nameOf.get(r.resourceId) ?? "Someone";
    return [{
      userId: login, kind: "enquiry_assigned" as const, sourceType: "hours_variance_enquiry", sourceId: r.id,
      title: r.kind === "unplanned" ? `${who} logged unplanned hours in ${month}` : `${who} went over plan in ${month}`,
      body: "Please explain the difference on the Hours Over Plan screen.", href: "/resources/enquiries",
    }];
  }));

  stats.opened = inserted.length;
  stats.existing = candidates.length - inserted.length;
  return stats;
}

const ownerKey = (c: Candidate): string => `${c.resourceId}|${c.assignableId}`;

/**
 * Who answers each enquiry: the booking's project lead where there is one,
 * else the person's line manager — the same rule Phase A uses for approval,
 * so a person is never asked by one manager and approved by another.
 */
async function ownersFor(
  orgId: string, candidates: readonly Candidate[], people: readonly { id: string; managerId: string | null }[],
): Promise<Map<string, string | null>> {
  const projectIds = candidates.filter((c) => c.assignableType === "project").map((c) => c.assignableId);
  const leads = await leadsForProjects(orgId, projectIds);
  const managerOf = new Map(people.map((p) => [p.id, p.managerId ?? null]));
  const out = new Map<string, string | null>();
  for (const c of candidates) {
    const lead = c.assignableType === "project" ? leads.get(c.assignableId) ?? null : null;
    out.set(ownerKey(c), lead ?? managerOf.get(c.resourceId) ?? null);
  }
  return out;
}

/** Stamp open enquiries nobody has answered. Returns how many were escalated. */
export async function escalateStale(orgId: string, today: string): Promise<number> {
  const open = await db.select({ id: hoursVarianceEnquiries.id, createdAt: hoursVarianceEnquiries.createdAt })
    .from(hoursVarianceEnquiries)
    .where(and(
      eq(hoursVarianceEnquiries.orgId, orgId),
      eq(hoursVarianceEnquiries.status, "open"),
      isNull(hoursVarianceEnquiries.escalatedAt),
    ));
  const due = open.filter((e) => shouldEscalate(e.createdAt.toISOString().slice(0, 10), today));
  if (due.length === 0) return 0;
  await db.update(hoursVarianceEnquiries).set({ escalatedAt: new Date() })
    .where(and(eq(hoursVarianceEnquiries.orgId, orgId), inArray(hoursVarianceEnquiries.id, due.map((d) => d.id))));
  return due.length;
}
