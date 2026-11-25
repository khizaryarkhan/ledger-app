/**
 * Sales Tax Liability → export model. PURE; reads the GET /api/accounting/tax-liability response exactly as the
 * screen does (same rows, same hidden "Adjustments" rule, input tax shown as a deduction).
 */
import { num, type ExportRow, type ReportExportModel } from "../export-model";

export interface TaxLiabilityInfo {
  entity: string;
  currency: string | null;
  periodLine: string;
  from: string;
  to: string;
}

export function buildTaxLiabilityModel(d: any, info: TaxLiabilityInfo): ReportExportModel {
  const rows: ExportRow[] = [
    { kind: "line", cells: ["Opening balance (owed at period start)", num(d.openingBalance)] },
    { kind: "line", cells: ["Output tax (on sales)", num(d.outputTax)] },
    { kind: "line", cells: ["Input tax (on purchases)", d.inputTax ? num(-d.inputTax) : 0] },
  ];
  // The screen hides this row when there are no adjustments.
  if (d.adjustments !== 0) rows.push({ kind: "line", cells: ["Adjustments / payments", num(d.adjustments)] });
  rows.push({ kind: "subtotal", cells: ["Net for period", num(d.netLiability)] });
  rows.push({ kind: "total", cells: ["Closing balance (payable, owed to tax authority)", num(d.closingBalance)] });

  return {
    title: "Sales Tax Liability",
    entity: info.entity,
    currency: info.currency,
    periodLine: info.periodLine,
    params: [{ label: "From", value: info.from }, { label: "To", value: info.to }],
    sections: [{ columns: [{ key: "line", label: "", kind: "text" }, { key: "amount", label: "Amount", kind: "money" }], rows }],
    notes: [],
    fileBase: "Sales-Tax-Liability",
  };
}
