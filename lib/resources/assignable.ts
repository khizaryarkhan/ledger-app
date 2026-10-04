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

/** Client-side label for an option row in the assignable picker (list/detail shape varies per endpoint). */
export function assignableOptionLabel(type: AssignableType, row: any): string {
  if (type === "project") return row.name;
  if (type === "manufacturing_order") return `${row.moNo} — ${row.outputItem?.name ?? ""}`;
  return row.docNumber ? `${row.docNumber}` : row.id;
}
