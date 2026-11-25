/**
 * Subcontractor Yield & Wastage Performance → export model. Each vendor row is followed by its closed orders
 * (the screen shows them one vendor at a time on click; a file has no click, so all are listed). PURE.
 */
import { num, type ExportRow, type ReportExportModel } from "../export-model";
import { dateCell, text } from "./ops-common";

const round2 = (n: number) => Math.round((n || 0) * 100) / 100;

export function buildJobWorkYieldModel(data: any, info: { entity: string; currency: string | null }): ReportExportModel {
  const vendors: any[] = data?.vendors ?? [];
  const rows: ExportRow[] = [];
  for (const v of vendors) {
    const variance = v.avgExpectedYieldPct != null ? round2(v.actualYieldPct - v.avgExpectedYieldPct) : null;
    rows.push({
      kind: "line",
      cells: [text(v.vendorLabel), num(v.orderCount), num(v.totalSentQty), num(v.totalReceivedQty), num(v.actualYieldPct), num(v.avgExpectedYieldPct), variance, num(v.totalWastageAmount)],
      flags: [false, false, false, false, false, false, variance != null && variance < 0, false],
    });
    for (const o of v.orders ?? []) {
      rows.push({
        kind: "line",
        indent: 1,
        cells: [
          `${o.docNumber ?? ""} · closed ${o.closedAt ? String(o.closedAt).slice(0, 10) : ""}`.trim(), null, num(o.sentQty), num(o.receivedQty), num(o.actualYieldPct),
          o.expectedYieldPct != null ? num(o.expectedYieldPct) : null, null, num(o.wastageAmount),
        ],
      });
    }
  }
  if (vendors.length > 0 && data?.grandTotal) {
    const g = data.grandTotal;
    rows.push({ kind: "total", cells: [`Total (${g.orderCount} closed orders)`, null, num(g.totalSentQty), num(g.totalReceivedQty), null, null, null, num(g.totalWastageAmount)] });
  }
  return {
    title: "Subcontractor Yield & Wastage Performance",
    entity: info.entity,
    currency: info.currency,
    params: [],
    sections: [{
      columns: [
        { key: "vendor", label: "Vendor / order", kind: "text" },
        { key: "orders", label: "Closed orders", kind: "int" },
        { key: "sent", label: "Sent", kind: "qty" },
        { key: "received", label: "Received", kind: "qty" },
        { key: "yield", label: "Actual yield %", kind: "percent" },
        { key: "expected", label: "Expected yield % (avg)", kind: "percent" },
        { key: "variance", label: "Yield vs expected (pts)", kind: "percent" },
        { key: "wastage", label: "Wastage value", kind: "money" },
      ],
      rows,
    }],
    notes: vendors.length === 0
      ? ["No closed job-work orders yet: wastage is only recognised once an order is explicitly closed."]
      : ["Only closed orders are included; wastage is final only once an order is closed."],
    fileBase: "Subcontractor-Yield",
  };
}
