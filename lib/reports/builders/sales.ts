/** Sales reports (Open SOs, Awaiting Invoicing, Open Invoices) → export models. PURE. */
import { num, type ExportColumn, type ReportExportModel } from "../export-model";
import { buildTradeModel, dateCell, textCell, type TradeInfo } from "./trade-shared";

const col = (key: string, label: string, kind: ExportColumn["kind"]): ExportColumn => ({ key, label, kind });

export function buildOpenSosModel(data: any, shown: any[], info: TradeInfo): ReportExportModel {
  return buildTradeModel(data, shown, info, {
    title: "Open Sales Orders", fileBase: "Open-Sales-Orders", noun: "sales orders",
    columns: [col("so", "SO #", "text"), col("customer", "Customer", "text"), col("date", "Date", "date"), col("status", "Status", "text"), col("remaining", "Remaining value", "money")],
    totalLabel: "Total committed to customers", totalCol: 4,
    cells: r => [textCell(r.docNumber) ?? (r.id ? String(r.id).slice(0, 8) : null), textCell(r.customer) ?? "—", dateCell(r.date), textCell(r.status), num(r.remainingValue)],
    flags: r => [false, false, false, r.status === "Partial", false],
  });
}

export function buildAwaitingInvoicingModel(data: any, shown: any[], info: TradeInfo): ReportExportModel {
  return buildTradeModel(data, shown, info, {
    title: "Awaiting Invoicing", fileBase: "Awaiting-Invoicing", noun: "shipments",
    columns: [col("shipment", "Shipment #", "text"), col("customer", "Customer", "text"), col("date", "Date", "date"), col("sale", "Sale value", "money"), col("invoiced", "Invoiced", "money"), col("open", "Awaiting invoice", "money")],
    totalLabel: "Total awaiting invoicing", totalCol: 5,
    cells: r => [textCell(r.shipmentNo) ?? (r.id ? String(r.id).slice(0, 8) : null), textCell(r.customerLabel) ?? "—", dateCell(r.shipmentDate), num(r.saleValue), num(r.invoiced), num(r.openAmount)],
  });
}

export function buildOpenInvoicesModel(data: any, shown: any[], info: TradeInfo): ReportExportModel {
  return buildTradeModel(data, shown, info, {
    title: "Open Invoices", fileBase: "Open-Invoices", noun: "invoices",
    columns: [col("invoice", "Invoice #", "text"), col("customer", "Customer", "text"), col("due", "Due", "date"), col("total", "Total", "money"), col("open", "Open", "money")],
    totalLabel: "Total receivable", totalCol: 4,
    cells: r => [textCell(r.docNumber), textCell(r.customer), dateCell(r.dueDate), num(r.total), num(r.open)],
    flags: r => [false, false, !!r.overdue, false, false],
  });
}
