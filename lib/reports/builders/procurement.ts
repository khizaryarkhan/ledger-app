/** Purchasing reports (Open POs, Expected Bills, Open Bills) → export models. PURE. */
import { num, type ExportColumn, type ReportExportModel } from "../export-model";
import { buildTradeModel, dateCell, textCell, type TradeInfo } from "./trade-shared";

const col = (key: string, label: string, kind: ExportColumn["kind"]): ExportColumn => ({ key, label, kind });

export function buildOpenPosModel(data: any, shown: any[], info: TradeInfo): ReportExportModel {
  return buildTradeModel(data, shown, info, {
    title: "Open Purchase Orders", fileBase: "Open-Purchase-Orders", noun: "purchase orders",
    columns: [col("po", "PO #", "text"), col("supplier", "Supplier", "text"), col("date", "Date", "date"), col("status", "Status", "text"), col("remaining", "Remaining value", "money")],
    totalLabel: "Total remaining on order", totalCol: 4,
    cells: r => [textCell(r.docNumber) ?? (r.id ? String(r.id).slice(0, 8) : null), textCell(r.supplier) ?? "—", dateCell(r.date), textCell(r.status), num(r.remainingValue)],
    flags: r => [false, false, false, r.status === "Partial", false],
  });
}

export function buildExpectedBillsModel(data: any, shown: any[], info: TradeInfo): ReportExportModel {
  return buildTradeModel(data, shown, info, {
    title: "Expected Bills", fileBase: "Expected-Bills", noun: "receipts",
    columns: [col("receipt", "Receipt #", "text"), col("supplier", "Supplier", "text"), col("date", "Date", "date"), col("received", "Received", "money"), col("billed", "Billed", "money"), col("open", "Awaiting bill", "money")],
    totalLabel: "Total expected bills (GR/IR)", totalCol: 5,
    cells: r => [textCell(r.receiptNo) ?? (r.id ? String(r.id).slice(0, 8) : null), textCell(r.supplierLabel) ?? "—", dateCell(r.receiptDate), num(r.received), num(r.billed), num(r.openAmount)],
  });
}

export function buildOpenBillsModel(data: any, shown: any[], info: TradeInfo): ReportExportModel {
  return buildTradeModel(data, shown, info, {
    title: "Open Bills", fileBase: "Open-Bills", noun: "bills",
    columns: [col("bill", "Bill #", "text"), col("supplier", "Supplier", "text"), col("due", "Due", "date"), col("total", "Total", "money"), col("open", "Open", "money")],
    totalLabel: "Total payable", totalCol: 4,
    cells: r => [textCell(r.docNumber), textCell(r.supplier), dateCell(r.dueDate), num(r.total), num(r.open)],
    flags: r => [false, false, !!r.overdue, false, false],
  });
}
