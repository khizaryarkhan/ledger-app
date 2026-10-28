/**
 * Production data points (0115) — pure, client-safe, no `db`.
 *
 * The rules a Manufacturing Order / job work order is measured by:
 *  - Planned = scheduledDate → dueDate (MO) or dispatchDate → expectedReturnDate
 *    (job work). Actual = startedAt → completedAt (MO) or the last receipt /
 *    close (job work).
 *  - The FIRST due date is kept. Moving it is a reschedule, counted, and the
 *    report shows on-time against the original next to on-time against the
 *    current one — the same rule as a PO line's promised date.
 *  - Delay, downtime and scrap reasons are FIXED codes, never free text, so
 *    they can be counted. A note carries the detail.
 */

import { applyPromise, daysBetween, isIsoDate } from "@/lib/inventory/delivery-performance";

export type ReasonDef = { code: string; label: string };

export const DELAY_REASONS: readonly ReasonDef[] = [
  { code: "material_shortage", label: "Material shortage" },
  { code: "supplier_late",     label: "Supplier / job worker late" },
  { code: "machine_breakdown", label: "Machine breakdown" },
  { code: "labour_shortage",   label: "Labour shortage" },
  { code: "quality_hold",      label: "Quality hold / rework" },
  { code: "capacity",          label: "Capacity / other orders first" },
  { code: "customer_change",   label: "Customer change" },
  { code: "planning",          label: "Planning error" },
  { code: "other",             label: "Other" },
];

export const DOWNTIME_REASONS: readonly (ReasonDef & { planned: boolean })[] = [
  { code: "breakdown",   label: "Breakdown",              planned: false },
  { code: "no_material", label: "Waiting for material",   planned: false },
  { code: "no_operator", label: "No operator",            planned: false },
  { code: "quality",     label: "Quality stop",           planned: false },
  { code: "power",       label: "Power / utilities",      planned: false },
  { code: "changeover",  label: "Changeover / setup",     planned: true },
  { code: "maintenance", label: "Planned maintenance",    planned: true },
  { code: "other",       label: "Other",                  planned: false },
];

export const SCRAP_REASONS: readonly ReasonDef[] = [
  { code: "material_defect", label: "Material defect" },
  { code: "machine_fault",   label: "Machine fault" },
  { code: "operator_error",  label: "Operator error" },
  { code: "setup",           label: "Setup / first-off" },
  { code: "process",         label: "Process variation" },
  { code: "contamination",   label: "Contamination" },
  { code: "damage",          label: "Handling damage" },
  { code: "other",           label: "Other" },
];

export function isReason(list: readonly ReasonDef[], v: unknown): v is string {
  return typeof v === "string" && list.some(r => r.code === v);
}

export function reasonLabel(list: readonly ReasonDef[], code: string | null | undefined): string {
  if (!code) return "Not recorded";
  return list.find(r => r.code === code)?.label ?? code;
}

/** Read a reason from a request: undefined = untouched, null = cleared, else a known code. */
export function readReason(list: readonly ReasonDef[], v: unknown, label: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  if (!isReason(list, v)) throw new Error(`Unknown ${label}.`);
  return v;
}

export type DueUpdate = { dueDate: string | null; originalDueDate: string | null; revisions: number };

/**
 * Move a due date. An order that already had a due date before the original
 * was tracked treats that date as the original, so its first move counts.
 */
export function applyReschedule(cur: { dueDate?: string | null; originalDueDate?: string | null; revisions?: number | null }, next: string | null): DueUpdate {
  const r = applyPromise({
    promisedDate: cur.dueDate ?? null,
    originalPromisedDate: cur.originalDueDate ?? cur.dueDate ?? null,
    promiseRevisions: cur.revisions ?? 0,
  }, next);
  return { dueDate: r.promisedDate, originalDueDate: r.originalPromisedDate, revisions: r.promiseRevisions };
}

/** Minutes between two instants; an open stoppage runs to `asOf`. Never negative. */
export function downtimeMinutes(start: Date | string, end: Date | string | null, asOf: Date = new Date()): number {
  const s = new Date(start).getTime();
  const e = end ? new Date(end).getTime() : asOf.getTime();
  if (!Number.isFinite(s) || !Number.isFinite(e)) return 0;
  return Math.max(0, Math.round((e - s) / 60_000));
}

export type TimingStatus = "OnTime" | "Late" | "Overdue" | "Open" | "NoDueDate";

export type OrderTimingInput = {
  plannedStart: string | null;     // YYYY-MM-DD
  plannedFinish: string | null;    // current due date
  originalFinish: string | null;   // first due date
  actualStart: string | null;      // YYYY-MM-DD (date part of startedAt)
  actualFinish: string | null;     // YYYY-MM-DD (date part of completedAt / close)
  asOf: string;
};

export type OrderTiming = {
  status: TimingStatus;
  scored: boolean;                 // finished, or open past its due date
  onTime: boolean;
  onTimeVsOriginal: boolean;
  startSlipDays: number | null;    // actual − planned start (+ = late)
  finishSlipDays: number | null;   // actual (or asOf if overdue) − due (+ = late)
  plannedDays: number | null;      // planned lead time
  actualDays: number | null;       // actual throughput time
};

/** Where one order stands against its plan. */
export function classifyOrderTiming(x: OrderTimingInput): OrderTiming {
  const due = isIsoDate(x.plannedFinish) ? x.plannedFinish : null;
  const orig = isIsoDate(x.originalFinish) ? x.originalFinish : due;
  const done = isIsoDate(x.actualFinish) ? x.actualFinish : null;
  const startSlipDays = isIsoDate(x.plannedStart) && isIsoDate(x.actualStart) ? daysBetween(x.plannedStart, x.actualStart) : null;
  const plannedDays = isIsoDate(x.plannedStart) && due ? daysBetween(x.plannedStart, due) : null;
  const actualDays = isIsoDate(x.actualStart) && done ? daysBetween(x.actualStart, done) : null;

  if (!due) {
    return { status: done ? "OnTime" : "NoDueDate", scored: false, onTime: false, onTimeVsOriginal: false, startSlipDays, finishSlipDays: null, plannedDays, actualDays };
  }
  if (done) {
    const slip = daysBetween(due, done);
    const onTime = slip <= 0;
    return { status: onTime ? "OnTime" : "Late", scored: true, onTime, onTimeVsOriginal: done <= (orig ?? due), startSlipDays, finishSlipDays: slip, plannedDays, actualDays };
  }
  if (x.asOf > due) {
    return { status: "Overdue", scored: true, onTime: false, onTimeVsOriginal: false, startSlipDays, finishSlipDays: daysBetween(due, x.asOf), plannedDays, actualDays };
  }
  return { status: "Open", scored: false, onTime: false, onTimeVsOriginal: false, startSlipDays, finishSlipDays: null, plannedDays, actualDays };
}

export type TimingSummary = {
  orders: number;
  scored: number;
  onTimePct: number | null;
  onTimeVsOriginalPct: number | null;
  avgDaysLate: number | null;      // over late/overdue orders only
  overdue: number;
  rescheduled: number;
  avgStartSlip: number | null;
};

export function summariseTiming(rows: { t: OrderTiming; revisions: number }[]): TimingSummary {
  const scored = rows.filter(r => r.t.scored);
  const late = scored.filter(r => !r.t.onTime && r.t.finishSlipDays != null);
  const slips = rows.map(r => r.t.startSlipDays).filter((d): d is number => d != null);
  const pct = (n: number) => scored.length ? Math.round((n / scored.length) * 1000) / 10 : null;
  const avg = (a: number[]) => a.length ? Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 10) / 10 : null;
  return {
    orders: rows.length,
    scored: scored.length,
    onTimePct: pct(scored.filter(r => r.t.onTime).length),
    onTimeVsOriginalPct: pct(scored.filter(r => r.t.onTimeVsOriginal).length),
    avgDaysLate: avg(late.map(r => r.t.finishSlipDays!)),
    overdue: rows.filter(r => r.t.status === "Overdue").length,
    rescheduled: rows.filter(r => r.revisions > 0).length,
    avgStartSlip: avg(slips),
  };
}

/** Group a list by reason code into { code, label, count, value } sorted by value, largest first. */
export function paretoByReason<T>(list: readonly ReasonDef[], rows: T[], codeOf: (r: T) => string | null | undefined, valueOf: (r: T) => number) {
  const m = new Map<string, { code: string; label: string; count: number; value: number }>();
  for (const r of rows) {
    const code = codeOf(r) || "unrecorded";
    const cur = m.get(code) ?? { code, label: code === "unrecorded" ? "Not recorded" : reasonLabel(list, code), count: 0, value: 0 };
    cur.count += 1; cur.value += valueOf(r);
    m.set(code, cur);
  }
  return [...m.values()].map(v => ({ ...v, value: Math.round(v.value * 100) / 100 })).sort((a, b) => b.value - a.value || b.count - a.count);
}
