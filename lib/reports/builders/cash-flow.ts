/**
 * Cash Flow statement (indirect method) → export model. PURE; reads the
 * GET /api/accounting/cash-flow response exactly as the screen does.
 */
import { num, type ExportRow, type ReportExportModel } from "../export-model";

export interface CashFlowInfo {
  entity: string;
  currency: string | null;
  periodLine: string;
  from: string;
  to: string;
}

export function buildCashFlowModel(d: any, info: CashFlowInfo): ReportExportModel {
  const activity = (title: string, lines: any[], total: number): ExportRow[] => [
    { kind: "heading", cells: [title, null] },
    ...lines.map((l): ExportRow => ({ kind: "line", indent: 1, cells: [l.name, num(l.amount)] })),
    { kind: "subtotal", cells: [`Net cash from ${title.toLowerCase()}`, num(total)] },
  ];
  const rows: ExportRow[] = [
    { kind: "line", cells: ["Net income", num(d.netIncome)] },
    ...activity("Operating activities", d.operating, d.operatingTotal),
    ...activity("Investing activities", d.investing, d.investingTotal),
    ...activity("Financing activities", d.financing, d.financingTotal),
    { kind: "subtotal", cells: ["Net change in cash", num(d.netChange)] },
    { kind: "line", cells: ["Cash at start", num(d.openingCash)] },
    { kind: "total", cells: ["Cash at end", num(d.closingCash)] },
  ];
  return {
    title: "Cash Flow Statement",
    formalTitle: "Statement of Cash Flows",
    entity: info.entity,
    currency: info.currency,
    periodLine: info.periodLine,
    params: [{ label: "From", value: info.from }, { label: "To", value: info.to }],
    sections: [{ columns: [{ key: "account", label: "", kind: "text" }, { key: "amount", label: "Amount", kind: "money" }], rows }],
    notes: d.reconciles ? [] : ["The computed change does not tie exactly to the bank movement — there may be inter-account cash transfers or an opening imbalance to review."],
    fileBase: "Cash-Flow",
  };
}
