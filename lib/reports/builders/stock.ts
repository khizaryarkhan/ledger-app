/**
 * Stock Valuation (summary and by-lot) and Stock Status → export models. They list exactly the rows the screen is
 * showing (after the search box, the column filters and the user's sort). PURE.
 */
import { fmt } from "@/lib/format";
import { num, type ExportRow, type ReportExportModel } from "../export-model";
import { dateCell, text } from "./ops-common";

export interface StockInfo {
  entity: string;
  currency: string | null;
  search: string;
  /** Stock Status only: the "only items needing attention" box. */
  onlyAttention?: boolean;
}

function params(info: StockInfo, extra: { label: string; value: string }[] = []) {
  const p = [...extra];
  if (info.search.trim()) p.push({ label: "Search", value: info.search.trim() });
  if (info.onlyAttention) p.push({ label: "Only items needing attention", value: "Yes" });
  return p;
}

/** Stock Valuation, summary view: the grand total is the API's total for every item, as on screen. */
export function buildStockValuationSummaryModel(summary: { rows?: any[]; total?: number } | null, shown: any[], info: StockInfo): ReportExportModel {
  const all = summary?.rows ?? [];
  const rows: ExportRow[] = shown.map((r): ExportRow => ({
    kind: "line",
    cells: [text(r.name), text(r.code), text(r.category), num(r.onHandQty), text(r.baseUom), num(r.avgCost), num(r.value)],
  }));
  if (shown.length > 0) rows.push({ kind: "total", cells: ["Total inventory value", null, null, null, null, null, num(summary?.total)] });
  const notes: string[] = [];
  if (shown.length !== all.length) {
    notes.push(`Filtered view: ${shown.length} of ${all.length} items are listed. The total is the value of all ${all.length} items.`);
  }
  return {
    title: "Stock Valuation",
    entity: info.entity,
    currency: info.currency,
    params: params(info, [{ label: "View", value: "Summary" }]),
    sections: [{
      columns: [
        { key: "item", label: "Item", kind: "text" },
        { key: "code", label: "Code", kind: "text" },
        { key: "category", label: "Category", kind: "text" },
        { key: "onHand", label: "On hand", kind: "qty" },
        { key: "uom", label: "Unit", kind: "text" },
        { key: "avgCost", label: "Avg cost", kind: "money" },
        { key: "value", label: "Value", kind: "money" },
      ],
      rows,
    }],
    notes,
    fileBase: "Stock-Valuation-Summary",
  };
}

function lotWhere(l: any): string | null {
  const locs: any[] = l.locations ?? [];
  if (locs.length === 0) return null;
  if (locs.length === 1) return text(locs[0].code);
  return locs.map((x) => `${x.code} ${fmt.qty(x.qty)}`).join(" · ");
}

/** Stock Valuation, by-lot view: the total is over the lots the search leaves (column filters do not change it, as on screen). */
export function buildStockValuationLotsModel(searched: any[], shown: any[], info: StockInfo): ReportExportModel {
  const total = searched.reduce((s, l) => s + Number(l.value || 0), 0);
  const rows: ExportRow[] = shown.map((l): ExportRow => {
    const packed = l.packs != null;
    return {
      kind: "line",
      cells: [
        text(l.itemName), l.skuName ? String(l.skuName) : "base", text(l.lotNo ?? String(l.id ?? "").slice(0, 8)), dateCell(l.expiryDate), lotWhere(l),
        num(packed ? l.packs : l.remainingQty), packed ? String(l.packType || "packs") : text(l.baseUom), num(l.unitCost), num(l.value),
      ],
    };
  });
  if (shown.length > 0) rows.push({ kind: "total", cells: ["Total", null, null, null, null, null, null, null, num(total)] });
  const notes: string[] = [];
  if (shown.length !== searched.length) {
    notes.push(`Filtered view: ${shown.length} of ${searched.length} lots are listed. The total is for all ${searched.length} lots the search leaves.`);
  }
  return {
    title: "Stock Valuation",
    entity: info.entity,
    currency: info.currency,
    params: params(info, [{ label: "View", value: "Detail (by lot)" }]),
    sections: [{
      columns: [
        { key: "item", label: "Item", kind: "text" },
        { key: "sku", label: "SKU", kind: "text" },
        { key: "lot", label: "Lot #", kind: "text" },
        { key: "expiry", label: "Expiry", kind: "date" },
        { key: "where", label: "Where", kind: "text" },
        { key: "remaining", label: "Remaining", kind: "qty" },
        { key: "unit", label: "Unit", kind: "text" },
        { key: "unitCost", label: "Unit cost", kind: "money" },
        { key: "value", label: "Value", kind: "money" },
      ],
      rows,
    }],
    notes,
    fileBase: "Stock-Valuation-By-Lot",
  };
}

function statusOf(r: any): string {
  return r.out ? "Out of stock" : r.belowMin ? "Below minimum" : "OK";
}

function whereOf(r: any): string | null {
  const locs: any[] = r.byLocation ?? [];
  if (locs.length === 0) return null;
  if (locs.length === 1) return text(locs[0].code);
  return locs.map((l) => `${l.code} ${fmt.qty(l.qty)}`).join(" · ");
}

/** Stock Status: committed and allocated are shown negative (they reduce what is available), expected positive, blank when none, as on screen. */
export function buildStockStatusModel(all: any[], shown: any[], info: StockInfo): ReportExportModel {
  const pos = (v: unknown) => (Number(v) > 0 ? num(v) : null);
  const neg = (v: unknown) => (Number(v) > 0 ? num(-Number(v)) : null);
  const rows: ExportRow[] = shown.map((r): ExportRow => {
    const bad = !!(r.out || r.belowMin);
    const cells = [
      text(r.name), text(r.code), num(r.onHandQty), text(r.baseUom), whereOf(r),
      pos(r.expectedQty), neg(r.committedQty), neg(r.allocatedQty), num(r.availableQty), num(r.minOhQty), statusOf(r),
    ];
    return { kind: "line", cells, flags: cells.map((_, i) => bad && i === cells.length - 1) };
  });
  const notes: string[] = [];
  if (shown.length !== all.length) notes.push(`Filtered view: ${shown.length} of ${all.length} items are listed.`);
  return {
    title: "Stock Status",
    entity: info.entity,
    currency: info.currency,
    params: params(info),
    sections: [{
      columns: [
        { key: "item", label: "Item", kind: "text" },
        { key: "code", label: "Code", kind: "text" },
        { key: "onHand", label: "On hand", kind: "qty" },
        { key: "uom", label: "Unit", kind: "text" },
        { key: "where", label: "Where", kind: "text" },
        { key: "expected", label: "Expected (PO / MO)", kind: "qty" },
        { key: "committed", label: "Committed (SO)", kind: "qty" },
        { key: "allocated", label: "Allocated (MO)", kind: "qty" },
        { key: "available", label: "Available", kind: "qty" },
        { key: "min", label: "Min.", kind: "qty" },
        { key: "status", label: "Status", kind: "text" },
      ],
      rows,
    }],
    notes,
    fileBase: "Stock-Status",
  };
}
