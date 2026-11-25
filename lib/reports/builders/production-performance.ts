/**
 * Production Performance → export model for the tab being shown (manufacturing orders, downtime or job work).
 * Reason lists are exported as tables (value, count) rather than bars. Downtime is in minutes. PURE.
 */
import { num, type ColumnKind, type ExportRow, type ExportSection, type ReportExportModel } from "../export-model";
import { dateCell, pctFlag, text } from "./ops-common";

export type PerformanceTab = "production" | "downtime" | "jobwork";

export interface ProductionPerformanceInfo {
  tab: PerformanceTab;
  entity: string;
  currency: string | null;
  periodLine: string;
  from: string;
  to: string;
}

const TAB_LABEL: Record<PerformanceTab, string> = { production: "Manufacturing orders", downtime: "Downtime", jobwork: "Job work" };
const TIMING_LABEL: Record<string, string> = { OnTime: "On time", Late: "Late", Overdue: "Overdue", Open: "Open", NoDueDate: "No due date" };
const timingLabel = (s: unknown) => (s == null ? null : TIMING_LABEL[String(s)] ?? String(s));
const pos = (v: unknown) => Number(v) > 0;

function pareto(heading: string, rows: any[] | undefined, valueLabel: string, valueKind: ColumnKind): ExportSection {
  return {
    heading,
    columns: [
      { key: "reason", label: "Reason", kind: "text" },
      { key: "value", label: valueLabel, kind: valueKind },
      { key: "count", label: "Count", kind: "int" },
    ],
    rows: (rows ?? []).map((r): ExportRow => ({
      kind: "line",
      cells: [text(r.label), num(r.value), num(r.count)],
      flags: [r.code === "unrecorded", false, false],
    })),
  };
}

function productionSections(p: any, notes: string[]): ExportSection[] {
  const sections: ExportSection[] = [];
  sections.push({
    heading: "Summary",
    columns: [
      { key: "onTime", label: "On time", kind: "percent" },
      { key: "vs", label: "vs first due date", kind: "percent" },
      { key: "overdue", label: "Overdue orders", kind: "int" },
      { key: "late", label: "Avg days late", kind: "qty" },
      { key: "yield", label: "Yield", kind: "percent" },
      { key: "scrap", label: "Scrap cost", kind: "money" },
    ],
    rows: [{
      kind: "line",
      cells: [num(p.timing?.onTimePct), num(p.timing?.onTimeVsOriginalPct), num(p.timing?.overdue), num(p.timing?.avgDaysLate), num(p.yieldPct), num(p.scrapCost)],
      flags: [pctFlag(p.timing?.onTimePct), pctFlag(p.timing?.onTimeVsOriginalPct), pos(p.timing?.overdue), false, pctFlag(p.yieldPct), pos(p.scrapCost)],
    }],
  });
  if (p.timing?.onTimePct == null && (p.timing?.orders ?? 0) > 0) notes.push("On time is blank because none of these orders has a due date to measure against.");
  sections.push(pareto("Why orders were late", p.delayReasons, "Orders", "int"));
  sections.push(pareto("Why output was rejected", p.scrapReasons, "Rejected qty", "qty"));
  sections.push({
    heading: "Hours: planned vs actual",
    columns: [
      { key: "wc", label: "Work centre", kind: "text" },
      { key: "planned", label: "Planned hours", kind: "qty" },
      { key: "actual", label: "Actual hours", kind: "qty" },
      { key: "eff", label: "Efficiency", kind: "percent" },
    ],
    rows: (p.hours ?? []).map((h: any): ExportRow => ({ kind: "line", cells: [text(h.workCentre), num(h.planned), num(h.actual), num(h.efficiencyPct)], flags: [false, false, false, pctFlag(h.efficiencyPct)] })),
  });
  sections.push({
    heading: "Orders",
    columns: [
      { key: "order", label: "Order", kind: "text" },
      { key: "item", label: "Item", kind: "text" },
      { key: "pStart", label: "Planned start", kind: "date" },
      { key: "aStart", label: "Actual start", kind: "date" },
      { key: "due", label: "Due", kind: "date" },
      { key: "first", label: "First due", kind: "date" },
      { key: "moved", label: "Times moved", kind: "int" },
      { key: "finish", label: "Finished", kind: "date" },
      { key: "daysLate", label: "Days late", kind: "int" },
      { key: "reason", label: "Reason", kind: "text" },
      { key: "state", label: "State", kind: "text" },
    ],
    rows: (p.orders ?? []).map((o: any): ExportRow => {
      const late = (o.daysLate ?? 0) > 0;
      return {
        kind: "line",
        cells: [
          text(o.moNo), text(o.item), dateCell(o.plannedStart), dateCell(o.actualStart), dateCell(o.due), o.reschedules > 0 ? dateCell(o.originalDue) : null,
          num(o.reschedules), dateCell(o.finish), num(o.daysLate), o.delayReason ?? (late ? "Not recorded" : null), timingLabel(o.timing),
        ],
        flags: [false, false, false, false, o.reschedules > 0, o.reschedules > 0, o.reschedules > 0, false, late, late && !o.delayReason, o.timing === "Overdue" || o.timing === "Late"],
      };
    }),
  });
  return sections;
}

function downtimeSections(dt: any): ExportSection[] {
  return [
    {
      heading: "Summary",
      columns: [
        { key: "total", label: "Total downtime (minutes)", kind: "int" },
        { key: "unplanned", label: "Unplanned (minutes)", kind: "int" },
        { key: "stops", label: "Stoppages", kind: "int" },
        { key: "open", label: "Still down", kind: "int" },
      ],
      rows: [{ kind: "line", cells: [num(dt.totalMinutes), num(dt.unplannedMinutes), num(dt.stops), num(dt.open)], flags: [false, pos(dt.unplannedMinutes), false, pos(dt.open)] }],
    },
    pareto("Downtime by reason", dt.reasons, "Minutes", "int"),
    {
      heading: "By work centre",
      columns: [
        { key: "wc", label: "Work centre", kind: "text" },
        { key: "minutes", label: "Downtime (minutes)", kind: "int" },
        { key: "unplanned", label: "Unplanned (minutes)", kind: "int" },
        { key: "stops", label: "Stops", kind: "int" },
      ],
      rows: (dt.byWorkCentre ?? []).map((w: any): ExportRow => ({ kind: "line", cells: [text(w.workCentre), num(w.minutes), num(w.unplanned), num(w.stops)] })),
    },
  ];
}

function jobWorkSections(jw: any): ExportSection[] {
  const t = jw.timing;
  return [
    {
      heading: "Summary",
      columns: [
        { key: "onTime", label: "Returned on time", kind: "percent" },
        { key: "vs", label: "vs first date", kind: "percent" },
        { key: "overdue", label: "Overdue", kind: "int" },
        { key: "late", label: "Avg days late", kind: "qty" },
        { key: "redated", label: "Re-dated", kind: "int" },
      ],
      rows: [{ kind: "line", cells: [num(t?.onTimePct), num(t?.onTimeVsOriginalPct), num(t?.overdue), num(t?.avgDaysLate), num(t?.rescheduled)], flags: [pctFlag(t?.onTimePct), pctFlag(t?.onTimeVsOriginalPct), pos(t?.overdue), false, pos(t?.rescheduled)] }],
    },
    pareto("Why returns were late", jw.delayReasons, "Orders", "int"),
    pareto("Why material was lost", jw.wastageReasons, "Wastage value", "money"),
    {
      heading: "By job worker",
      columns: [
        { key: "vendor", label: "Job worker", kind: "text" },
        { key: "orders", label: "Orders", kind: "int" },
        { key: "onTime", label: "On time", kind: "percent" },
        { key: "vs", label: "vs first date", kind: "percent" },
        { key: "late", label: "Avg days late", kind: "qty" },
        { key: "overdue", label: "Overdue", kind: "int" },
        { key: "yield", label: "Yield", kind: "percent" },
        { key: "wastage", label: "Wastage", kind: "money" },
      ],
      rows: (jw.vendors ?? []).map((v: any): ExportRow => ({
        kind: "line",
        cells: [text(v.vendor), num(v.orders), num(v.onTimePct), num(v.onTimeVsOriginalPct), num(v.avgDaysLate), num(v.overdue), num(v.yieldPct), num(v.wastageValue)],
        flags: [false, false, pctFlag(v.onTimePct), pctFlag(v.onTimeVsOriginalPct), false, pos(v.overdue), pctFlag(v.yieldPct), false],
      })),
    },
    {
      heading: "Orders",
      columns: [
        { key: "order", label: "Order", kind: "text" },
        { key: "vendor", label: "Job worker", kind: "text" },
        { key: "dispatched", label: "Dispatched", kind: "date" },
        { key: "due", label: "Expected back", kind: "date" },
        { key: "first", label: "First expected", kind: "date" },
        { key: "moved", label: "Times moved", kind: "int" },
        { key: "closed", label: "Closed", kind: "date" },
        { key: "daysLate", label: "Days late", kind: "int" },
        { key: "reason", label: "Reason", kind: "text" },
        { key: "state", label: "State", kind: "text" },
      ],
      rows: (jw.orders ?? []).map((o: any): ExportRow => {
        const late = (o.daysLate ?? 0) > 0;
        return {
          kind: "line",
          cells: [
            text(o.docNumber), text(o.vendor), dateCell(o.dispatched), dateCell(o.due), o.revisions > 0 ? dateCell(o.originalDue) : null, num(o.revisions), dateCell(o.finish),
            num(o.daysLate), o.delayReason ?? (late ? "Not recorded" : null), timingLabel(o.timing),
          ],
          flags: [false, false, false, o.revisions > 0, o.revisions > 0, o.revisions > 0, false, late, late && !o.delayReason, o.timing === "Overdue" || o.timing === "Late"],
        };
      }),
    },
  ];
}

export function buildProductionPerformanceModel(data: any, info: ProductionPerformanceInfo): ReportExportModel {
  const notes: string[] = [];
  let sections: ExportSection[] = [];
  if (info.tab === "production") sections = productionSections(data.production, notes);
  else if (info.tab === "downtime") sections = downtimeSections(data.downtime);
  else sections = jobWorkSections(data.jobWork);
  return {
    title: `Production Performance — ${TAB_LABEL[info.tab]}`,
    entity: info.entity,
    currency: info.currency,
    periodLine: info.periodLine,
    params: [
      { label: "Tab", value: TAB_LABEL[info.tab] },
      { label: "Due from", value: info.from },
      { label: "Due to", value: info.to },
    ],
    sections,
    notes,
    fileBase: `Production-Performance-${TAB_LABEL[info.tab].replace(/\s+/g, "-")}`,
  };
}
