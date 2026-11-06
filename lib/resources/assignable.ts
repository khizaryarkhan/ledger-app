/**
 * The polymorphic "what is this resource/time booked against" vocabulary —
 * shared by resource_assignments (Phase 1, planned) and time_entries
 * (Phase 2, actual). One source so the assignment picker and the Log Time
 * picker can never drift apart (previously duplicated in
 * app/api/resources/assignments/route.ts and components/resource-board.tsx).
 */

export const ASSIGNABLE_TYPES = ["project", "manufacturing_order", "job_work_order"] as const;
export type AssignableType = (typeof ASSIGNABLE_TYPES)[number];

export const ASSIGNABLE_LABEL: Record<AssignableType, string> = {
  project: "Project",
  manufacturing_order: "Manufacturing Order",
  job_work_order: "Job Work Order",
};

export const ASSIGNABLE_ENDPOINT: Record<AssignableType, string> = {
  project: "/api/projects",
  manufacturing_order: "/api/production/mos",
  job_work_order: "/api/inventory/jobwork",
};

export function isAssignableType(v: unknown): v is AssignableType {
  return typeof v === "string" && (ASSIGNABLE_TYPES as readonly string[]).includes(v);
}

/** Does a [startA, endA] range (endA null = open-ended) overlap [from, to]? Plain YYYY-MM-DD string compares. */
export function overlaps(startA: string, endA: string | null, from: string, to: string): boolean {
  if (startA > to) return false;
  if (endA && endA < from) return false;
  return true;
}

/**
 * The highest total allocation % on any single day of [from, to]. Two bookings
 * at 100% on Mon-Tue and Wed-Fri never coincide, so the peak is 100, not the
 * 200 a plain sum over the week reported (which flagged people as
 * over-allocated with no real overlap). Cancelled bookings count for nothing.
 */
export function peakDailyAllocation(
  bookings: readonly { startDate: string; endDate: string | null; allocationPercent: number | string; status?: string }[],
  from: string,
  to: string,
): number {
  let peak = 0;
  for (let d = from; d <= to; d = nextDay(d)) {
    let day = 0;
    for (const b of bookings) {
      if (b.status === "cancelled") continue;
      if (b.startDate <= d && (!b.endDate || b.endDate >= d)) day += Number(b.allocationPercent) || 0;
    }
    if (day > peak) peak = day;
  }
  return peak;
}

function nextDay(d: string): string {
  const [y, m, day] = d.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, day + 1));
  return t.toISOString().slice(0, 10);
}

/** A booking's allocation: a number from 1 to 100 (% of the resource's capacity). */
export function parseAllocation(v: unknown): { ok: true; value: number } | { ok: false; error: string } {
  if (v === null || v === undefined || v === "") return { ok: true, value: 100 };
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0 || n > 100) return { ok: false, error: "Allocation must be a percentage from 1 to 100" };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** Client-side label for an option row in the assignable picker (list/detail shape varies per endpoint). */
export function assignableOptionLabel(type: AssignableType, row: any): string {
  if (type === "project") return row.name;
  if (type === "manufacturing_order") return `${row.moNo} — ${row.outputItem?.name ?? ""}`;
  return row.docNumber ? `${row.docNumber}` : row.id;
}
