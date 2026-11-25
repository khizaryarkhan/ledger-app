/**
 * Delivery Performance → export model: the headline scores, the per-party table (always every party, as on screen)
 * and the line list the screen is showing (after the party pick and the exceptions-only switch). PURE.
 */
import { num, type ExportRow, type ReportExportModel } from "../export-model";
import { dateCell, pctFlag, text } from "./ops-common";

export interface DeliveryPerformanceInfo {
  side: "supplier" | "customer";
  entity: string;
  periodLine: string;
  from: string;
  to: string;
  party: string;
  show: "exceptions" | "all";
}

const nz = (v: unknown) => (Number(v) > 0 ? true : false);

export function buildDeliveryPerformanceModel(data: any, shownLines: any[], info: DeliveryPerformanceInfo): ReportExportModel {
  const who = info.side === "customer" ? "Customer" : "Supplier";
  const parties: any[] = data?.parties ?? [];
  const allLines: any[] = data?.lines ?? [];
  const o = data?.overall;
  const sections: ReportExportModel["sections"] = [];

  if (o) {
    sections.push({
      heading: "Overall",
      columns: [
        { key: "otif", label: "OTIF", kind: "percent" },
        { key: "onTime", label: "On time", kind: "percent" },
        { key: "vsFirst", label: "vs first promise", kind: "percent" },
        { key: "inFull", label: "In full", kind: "percent" },
        { key: "overdue", label: "Overdue lines", kind: "int" },
        { key: "lead", label: "Avg lead time (days)", kind: "qty" },
      ],
      rows: [{
        kind: "line",
        cells: [num(o.otifPct), num(o.onTimePct), num(o.onTimeVsOriginalPct), num(o.inFullPct), num(o.overdue), num(o.avgLeadTimeDays)],
        flags: [pctFlag(o.otifPct), pctFlag(o.onTimePct), pctFlag(o.onTimeVsOriginalPct), pctFlag(o.inFullPct), nz(o.overdue), false],
      }],
    });
  }

  const partyRows: ExportRow[] = parties.map((p): ExportRow => ({
    kind: "line",
    cells: [
      text(p.partyLabel), num(p.lines), num(p.otifPct), num(p.onTimePct), num(p.onTimeVsOriginalPct), num(p.inFullPct), num(p.avgDaysLate),
      num(p.avgLeadTimeDays), num(p.overdue), num(p.revisedLines), num(p.unconfirmedOrders),
    ],
    flags: [false, false, pctFlag(p.otifPct), pctFlag(p.onTimePct), pctFlag(p.onTimeVsOriginalPct), pctFlag(p.inFullPct), false, false, nz(p.overdue), nz(p.revisedLines), nz(p.unconfirmedOrders)],
  }));
  sections.push({
    heading: `By ${who.toLowerCase()}`,
    columns: [
      { key: "party", label: who, kind: "text" },
      { key: "lines", label: "Lines", kind: "int" },
      { key: "otif", label: "OTIF", kind: "percent" },
      { key: "onTime", label: "On time", kind: "percent" },
      { key: "vsFirst", label: "vs first promise", kind: "percent" },
      { key: "inFull", label: "In full", kind: "percent" },
      { key: "late", label: "Avg days late", kind: "qty" },
      { key: "lead", label: "Avg lead time (days)", kind: "qty" },
      { key: "overdue", label: "Overdue", kind: "int" },
      { key: "revised", label: "Re-promised", kind: "int" },
      { key: "unconfirmed", label: "Unconfirmed orders", kind: "int" },
    ],
    rows: partyRows,
  });

  const lineRows: ExportRow[] = shownLines.map((l): ExportRow => {
    const cells = [
      text(l.docNumber), text(l.partyRef), text(l.partyLabel), text(l.item), dateCell(l.requestedDate), dateCell(l.promisedDate),
      l.promiseRevisions > 0 ? dateCell(l.originalPromisedDate) : null, num(l.promiseRevisions), dateCell(l.lastDelivery),
      num(l.deliveredQty), num(l.orderedQty), num(l.daysLate), text(l.state),
    ];
    return {
      kind: "line",
      cells,
      flags: [false, false, false, false, false, l.promiseRevisions > 0, false, l.promiseRevisions > 0, false, false, false, (l.daysLate ?? 0) > 0, l.state === "Overdue" || l.state === "Closed short"],
    };
  });
  sections.push({
    heading: info.show === "all" ? "Lines" : "Lines (exceptions only)",
    columns: [
      { key: "order", label: "Order", kind: "text" },
      { key: "ref", label: "Reference", kind: "text" },
      { key: "party", label: who, kind: "text" },
      { key: "item", label: "Item", kind: "text" },
      { key: "requested", label: "Requested", kind: "date" },
      { key: "promised", label: "Promised", kind: "date" },
      { key: "first", label: "First promised", kind: "date" },
      { key: "moved", label: "Times moved", kind: "int" },
      { key: "delivered", label: "Delivered", kind: "date" },
      { key: "dQty", label: "Delivered qty", kind: "qty" },
      { key: "oQty", label: "Ordered qty", kind: "qty" },
      { key: "daysLate", label: "Days late", kind: "int" },
      { key: "state", label: "State", kind: "text" },
    ],
    rows: lineRows,
  });

  const notes: string[] = [];
  if (shownLines.length !== allLines.length) notes.push(`Filtered view: ${shownLines.length} of ${allLines.length} lines are listed. The scores and the ${who.toLowerCase()} table cover all lines.`);
  if (o && o.onTimePct == null && allLines.length > 0) notes.push("On time and OTIF are blank because none of these order lines has a requested or promised date to measure against.");

  return {
    title: `Delivery Performance — ${info.side === "customer" ? "Customers" : "Suppliers"}`,
    entity: info.entity,
    currency: null,
    periodLine: info.periodLine,
    params: [
      { label: "Side", value: info.side === "customer" ? "Customers (fulfilment)" : "Suppliers (purchasing)" },
      { label: "Orders from", value: info.from },
      { label: "Orders to", value: info.to },
      { label: "Lines shown", value: info.show === "all" ? "All lines" : "Exceptions only (late, short, re-promised)" },
      ...(info.party ? [{ label: who, value: info.party }] : []),
    ],
    sections,
    notes,
    fileBase: `Delivery-Performance-${info.side === "customer" ? "Customers" : "Suppliers"}`,
  };
}
