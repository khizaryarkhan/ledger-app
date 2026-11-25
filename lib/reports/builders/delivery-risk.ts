/**
 * Delivery Risk → export model: every flagged step, grouped by the Sales Order it is for (same grouping and order
 * as the screen). PURE.
 */
import type { ExportRow, ReportExportModel } from "../export-model";
import { text } from "./ops-common";

const SOURCE_LABEL: Record<string, string> = { jobwork: "Job Work", po: "Purchase Order", mo: "Manufacturing Order" };

export function buildDeliveryRiskModel(alerts: any[], info: { entity: string }): ReportExportModel {
  // Group by sales order in first-seen order, exactly as the screen's Map does.
  const groups = new Map<string, { label: string; alerts: any[] }>();
  for (const a of alerts) {
    const key = a.salesOrderId ?? "unlinked";
    if (!groups.has(key)) groups.set(key, { label: a.salesOrderDocNumber ?? "Not linked to a Sales Order", alerts: [] });
    groups.get(key)!.alerts.push(a);
  }
  const rows: ExportRow[] = [];
  for (const g of groups.values()) {
    for (const a of g.alerts) {
      const critical = a.severity === "critical";
      rows.push({
        kind: "line",
        cells: [g.label, SOURCE_LABEL[a.sourceType] ?? text(a.sourceType), text(a.sourceDocNumber), critical ? "Critical" : "Warning", text(a.message)],
        flags: [false, false, false, true, false],
      });
    }
  }
  return {
    title: "Delivery Risk",
    entity: info.entity,
    currency: null,
    params: [],
    sections: [{
      columns: [
        { key: "so", label: "Sales Order", kind: "text" },
        { key: "source", label: "Step", kind: "text" },
        { key: "doc", label: "Document", kind: "text" },
        { key: "severity", label: "Severity", kind: "text" },
        { key: "message", label: "Detail", kind: "text" },
      ],
      rows,
    }],
    notes: alerts.length === 0 ? ["Nothing at risk right now: every open step is within its expected date."] : [`${alerts.length} steps at risk across ${groups.size} group${groups.size === 1 ? "" : "s"}.`],
    fileBase: "Delivery-Risk",
  };
}
