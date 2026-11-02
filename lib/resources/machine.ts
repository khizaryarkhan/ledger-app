/**
 * Machine usage, derived from manufacturing runs — pure, no `db`.
 *
 * A shop-floor machine is already recorded in three places: the bookable
 * `resources` row, the work centre production hours are charged to, and the
 * fixed asset it depreciates as. Its USAGE already exists too: every completion
 * run stores the hours it booked to each operation, and each operation names a
 * work centre. So a machine linked to a work centre needs no second place to
 * type hours — they are read from the runs.
 *
 * The one thing that read cannot do is tell whether those hours are real.
 * An untouched completion defaults each operation to the plan's share, so a
 * figure built from defaults is the plan read back to us rather than what the
 * machine did. Each stored hour therefore carries `entered`:
 *
 *   true       a person typed it                        -> firm
 *   false      the run defaulted it from the plan       -> estimated
 *   undefined  the run predates the flag (before 0124)  -> not recorded
 *
 * "Not recorded" is kept apart from "estimated" on purpose — one is known to be
 * the plan, the other is simply unknown — but neither is presented as firm.
 *
 * Dates are YYYY-MM-DD strings compared as strings ("a date is a date").
 */

import { downtimeMinutes } from "@/lib/inventory/production-performance";

export interface RunHours {
  operationId: string;
  hours: number;
  /** See the three states above. Absent on runs from before the flag existed. */
  entered?: boolean;
}

export interface CompletionRun {
  runId: string;
  /** When the run was produced. Null never counts: an undated run cannot be placed in a window. */
  producedDate: string | null;
  moId: string | null;
  operationHours: readonly RunHours[];
}

export interface MachineUsage {
  /** All hours booked to this machine in the window, firm or not. */
  hours: number;
  /** Of those, typed by a person. */
  firmHours: number;
  /** Of those, defaulted from the plan. */
  estimatedHours: number;
  /** Of those, from runs that predate the flag. */
  notRecordedHours: number;
  /** Distinct completion runs that booked any time here. */
  runs: number;
}

export const emptyUsage = (): MachineUsage =>
  ({ hours: 0, firmHours: 0, estimatedHours: 0, notRecordedHours: 0, runs: 0 });

const r2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/** Is every hour here one a person entered? Only then is the figure firm. */
export const isFirm = (u: MachineUsage): boolean => u.hours > 0 && u.estimatedHours === 0 && u.notRecordedHours === 0;

/**
 * Hours a work centre was used in [from, to], from completion runs.
 *
 * `operationWorkCentre` maps an operation id to its work centre. An operation
 * with no work centre, or a different one, contributes nothing to this machine.
 */
export function usageForWorkCentre(
  workCentreId: string,
  runs: readonly CompletionRun[],
  operationWorkCentre: ReadonlyMap<string, string | null>,
  from: string,
  to: string,
): MachineUsage {
  const out = emptyUsage();
  for (const run of runs) {
    // A run with no date cannot be placed in a window, so it is not guessed into one.
    if (!run.producedDate || run.producedDate < from || run.producedDate > to) continue;

    let booked = false;
    for (const h of run.operationHours) {
      if (operationWorkCentre.get(h.operationId) !== workCentreId) continue;
      const hours = Number(h.hours);
      if (!Number.isFinite(hours) || hours <= 0) continue;
      booked = true;
      out.hours += hours;
      if (h.entered === true) out.firmHours += hours;
      else if (h.entered === false) out.estimatedHours += hours;
      else out.notRecordedHours += hours;
    }
    if (booked) out.runs++;
  }
  return {
    hours: r2(out.hours), firmHours: r2(out.firmHours),
    estimatedHours: r2(out.estimatedHours), notRecordedHours: r2(out.notRecordedHours),
    runs: out.runs,
  };
}

// ── Downtime ─────────────────────────────────────────────────────────────────

export interface MachineDowntimeRow {
  id: string;
  startedAt: Date | string;
  endedAt: Date | string | null;
  reason: string;
  /** From DOWNTIME_REASONS: changeover and planned maintenance are planned, the rest are not. */
  planned: boolean;
}

export interface MachineDowntime<R extends MachineDowntimeRow = MachineDowntimeRow> {
  /** Not started yet — planned windows still ahead, soonest first. Counted nowhere. */
  upcoming: R[];
  /** Started already, newest first, each with the minutes that have elapsed. */
  happened: (R & { minutes: number })[];
  plannedMinutes: number;
  unplannedMinutes: number;
}

/**
 * Split a machine's downtime into what is booked ahead and what has happened.
 *
 * A window that has not started is a booking, not downtime, so it adds no
 * minutes however long it is. Minutes for one still running run to `now`, and a
 * known end that is still ahead is clamped to `now` by `downtimeMinutes`.
 */
export function splitDowntime<R extends MachineDowntimeRow>(
  rows: readonly R[],
  now: Date,
): MachineDowntime<R> {
  const upcoming: R[] = [];
  const happened: (R & { minutes: number })[] = [];
  let plannedMinutes = 0;
  let unplannedMinutes = 0;

  for (const r of rows) {
    const start = new Date(r.startedAt).getTime();
    if (!Number.isFinite(start)) continue;
    if (start > now.getTime()) { upcoming.push(r); continue; }
    const minutes = downtimeMinutes(r.startedAt, r.endedAt, now);
    happened.push({ ...r, minutes });
    if (r.planned) plannedMinutes += minutes; else unplannedMinutes += minutes;
  }
  upcoming.sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
  happened.sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
  return { upcoming, happened, plannedMinutes, unplannedMinutes };
}

// ── Links ────────────────────────────────────────────────────────────────────

export interface MachineLinksInput {
  workCentreId?: unknown;
  fixedAssetId?: unknown;
}

export type MachineLinks =
  | { ok: true; workCentreId?: string | null; fixedAssetId?: string | null }
  | { ok: false; error: string };

/** An id the caller meant to set, clear, or leave alone. `undefined` = leave alone. */
function linkValue(v: unknown, label: string): { ok: true; value: string | null | undefined } | { ok: false; error: string } {
  if (v === undefined) return { ok: true, value: undefined };
  if (v === null || v === "") return { ok: true, value: null };
  if (typeof v !== "string") return { ok: false, error: `${label} must be an id or empty` };
  return { ok: true, value: v };
}

/**
 * What a request may say about a machine's links.
 *
 * Only equipment has them. A person with a work centre would charge a
 * machine's hours to a human, so for a person this REFUSES rather than
 * silently dropping the field — an ignored field reads as "saved" to the
 * caller.
 */
export function readMachineLinks(isEquipment: boolean, input: MachineLinksInput): MachineLinks {
  const wc = linkValue(input.workCentreId, "workCentreId");
  if ("error" in wc) return wc;
  const fa = linkValue(input.fixedAssetId, "fixedAssetId");
  if ("error" in fa) return fa;

  const sets = typeof wc.value === "string" || typeof fa.value === "string";
  if (!isEquipment && sets) {
    return { ok: false, error: "Only equipment can be linked to a work centre or a fixed asset" };
  }
  if (!isEquipment) return { ok: true };
  return { ok: true, workCentreId: wc.value, fixedAssetId: fa.value };
}
